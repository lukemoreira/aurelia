// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, shallowRef, watch } from 'vue'
import {
  splitFindings,
  storyFindings,
  storyGraph,
  storySummary,
  type StoryFinding,
  type StoryNode,
} from '@/domain/story-graph'
import { layoutStory, nodeInDirection, type Layout } from '@/domain/story-layout'
import { addChoice, setBookMode, setDismissed, setEnding } from '@/storage/story-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGuarded } from './useGuarded'
import { useNavigation } from './useNavigation'
import { useOutlineEdits } from './useOutlineEdits'
import { usePlay } from './usePlay'

const ZOOM_STEP = 0.1
const [ZOOM_MIN, ZOOM_MAX] = [0.4, 1.6]

/** How a node says what is wrong with it (the words under its title). */
const PROBLEM_WORDS: Record<StoryFinding['check'], (n: number) => string> = {
  'broken-choice': (n) => `${n} broken ${n === 1 ? 'choice' : 'choices'}`,
  'dead-end': () => 'dead end',
  unreachable: () => 'no way in',
  'no-ending': () => 'no way to an ending',
}

/**
 * The story map: the book's scenes and choices laid out, the scene selected, the checks with the
 * ones the author has marked as intended set aside, zoom, and Play mode. Reads the files as they
 * are; the only writes are the ones the problems list offers (an ending, an intended finding).
 */
export function useStoryMap() {
  const ws = useWorkspaceStore()
  const edit = useOutlineEdits()
  const edits = useEditsStore()
  const nav = useNavigation()
  const guarded = useGuarded()

  const branching = computed(() => ws.book?.mode === 'branching')
  const graph = computed(() =>
    ws.data && ws.bookId && ws.book ? storyGraph(ws.data, ws.bookId) : undefined,
  )
  // The layout depends on the shape of the story (scenes, choices, their words), not on the text of
  // the scenes: typing in a scene changes the data on every key and must not lay the map out again.
  const shape = computed(() => {
    const g = graph.value
    return g
      ? JSON.stringify([
          g.start,
          g.order,
          g.edges.map((e) => [e.id, e.from, e.target, e.label, e.broken]),
        ])
      : ''
  })
  const layout = shallowRef<Layout | undefined>()
  watch(shape, () => (layout.value = graph.value ? layoutStory(graph.value) : undefined), {
    immediate: true,
    flush: 'sync',
  })
  const summary = computed(() => (graph.value ? storySummary(graph.value) : undefined))
  const findings = computed(() => (graph.value ? storyFindings(graph.value) : []))
  const split = computed(() => splitFindings(findings.value, ws.book?.dismissedFindings))
  const play = usePlay(() => graph.value)

  const picked = ref<string | null>(null)
  /** The scene the details show: the one picked, else the start. A scene that has gone is not kept. */
  const selected = computed(() => {
    const g = graph.value
    return g && picked.value && g.nodes.has(picked.value) ? picked.value : g?.start
  })
  const node = computed<StoryNode | undefined>(() => graph.value?.nodes.get(selected.value ?? ''))
  watch(
    () => ws.bookId,
    () => {
      picked.value = null
      play.stop()
    },
  )

  /** Each scene's trouble in words, for its node: the worst open finding, then the rest of the story. */
  const trouble = computed(() => {
    const out = new Map<
      string,
      { words: string; severity: StoryFinding['severity']; check: StoryFinding['check'] }
    >()
    const counts = new Map<string, number>()
    for (const f of split.value.active) {
      const key = `${f.scene}:${f.check}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const f of split.value.active) {
      if (out.has(f.scene)) continue
      out.set(f.scene, {
        words: PROBLEM_WORDS[f.check](counts.get(`${f.scene}:${f.check}`) ?? 1),
        severity: f.severity,
        check: f.check,
      })
    }
    return out
  })
  /** "2 ways out", "2 ways in" or "the end": what a node says after its number when nothing is wrong. */
  function subtitle(id: string) {
    const g = graph.value
    const n = g?.nodes.get(id)
    if (!g || !n) return ''
    const ins = g.waysIn.get(id) ?? 0
    const way = (k: number, to: string) => `${k} ${k === 1 ? 'way' : 'ways'} ${to}`
    return ins > 1 ? way(ins, 'in') : n.choices.length ? way(n.choices.length, 'out') : 'the end'
  }

  const select = (id: string) => (picked.value = id)
  /** What the details should put the keyboard in, after a problem's button: a counter, so asking twice works. */
  const asked = ref<{ what: StoryFinding['fix']; choice?: string; n: number } | null>(null)
  /** "Show": leave Play, and the scene is selected and in view. */
  function show(f: StoryFinding) {
    play.stop()
    select(f.scene)
  }
  /** The button of a problem: one click mends a dead end; the others take the author to the place that mends them. */
  function fix(f: StoryFinding) {
    if (f.fix === 'mark-ending') return markEnding(f.scene)
    show(f)
    asked.value = {
      what: f.fix,
      ...(f.choice ? { choice: f.choice } : {}),
      n: (asked.value?.n ?? 0) + 1,
    }
  }
  /** Play from a scene (the selected one, from its details), not only from the start. */
  function playFrom(id: string) {
    select(id)
    play.start(id)
  }
  /** Arrow keys: to the nearest scene that way, and select it. */
  function step(from: string, dir: 'up' | 'down' | 'left' | 'right') {
    const next = layout.value ? nodeInDirection(layout.value, from, dir) : undefined
    if (next) {
      picked.value = next
      void edits.announce(`${graph.value?.nodes.get(next)?.title ?? ''} selected.`)
    }
    return next
  }
  const open = (id: string) => (ws.bookId ? nav.openScene(ws.bookId, id) : undefined)

  const zoom = ref(1)
  const setZoom = (z: number) =>
    (zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10)))
  const zoomBy = (by: -1 | 1) => setZoom(zoom.value + by * ZOOM_STEP)
  /** The zoom at which the whole map fits a window of this width. */
  const fit = (width: number) =>
    layout.value ? setZoom(Math.min(1, width / Math.max(1, layout.value.width))) : undefined

  const markEnding = (scene: string) =>
    guarded(async () => {
      if (ws.session) await setEnding(ws.session, scene, true)
    })
  /** "Mark intended" and its undo: the list is changed by the one fingerprint, where it is written. */
  const dismiss = (f: StoryFinding, on: boolean) =>
    guarded(async () => {
      if (ws.session && ws.bookId)
        await setDismissed(ws.session, ws.bookId, {
          ...(on ? { add: f.fingerprint } : { remove: f.fingerprint }),
          found: findings.value.map((x) => x.fingerprint),
        })
    })
  const makeBranching = () =>
    guarded(async () => {
      if (ws.session && ws.bookId) await setBookMode(ws.session, ws.bookId, 'branching')
    })
  /** A way in to a scene: a new choice on another scene that leads here. */
  const addWayIn = (to: string, from: string, label: string) =>
    guarded(async () => {
      if (ws.session) await addChoice(ws.session, from, { label, target: to })
    })

  return {
    branching,
    graph,
    layout,
    summary,
    findings,
    split,
    play,
    selected,
    node,
    trouble,
    subtitle,
    select,
    asked,
    show,
    fix,
    playFrom,
    step,
    open,
    zoom,
    zoomBy,
    fit,
    markEnding,
    dismiss,
    makeBranching,
    addWayIn,
    canEdit: edit.canEdit,
  }
}
