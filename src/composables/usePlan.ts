// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { arcsFor, arcsInUse, planParts, planRows, STATUS_COLOURS, type ArcRef } from '@/domain/plan'
import { STATUS_LABELS } from '@/domain/ui-names'
import { addChapter, setDetails } from '@/storage/outline-actions'
import { scenePath } from '@/router'
import { usePlanStore } from '@/stores/plan'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGuarded } from './useGuarded'
import { useOutlineEdits } from './useOutlineEdits'

/** The sentinel for "none" in a select. */
export const NO_VALUE = '__none'

/**
 * What the Plan view shows and does: the book as parts, chapters and scenes (for the outline table
 * and the corkboard), what each card is coloured by, the selection the side panel follows, and the
 * edits made inline (status, point of view, arcs). Reordering is the navigator's own: `useOutlineEdits`.
 */
export function usePlan() {
  const ws = useWorkspaceStore()
  const plan = usePlanStore()
  const edit = useOutlineEdits()
  const guarded = useGuarded()
  const router = useRouter()

  const parts = computed(() => (ws.data && ws.bookId ? planParts(ws.data, ws.bookId) : []))
  const rows = computed(() => planRows(parts.value))
  const chapters = computed(() => parts.value.flatMap((p) => p.chapters))
  const sceneCount = computed(() => chapters.value.reduce((n, c) => n + c.scenes.length, 0))
  const words = computed(() => chapters.value.reduce((n, c) => n + c.words, 0))
  const target = computed(() => (ws.book?.targets as { words?: number } | undefined)?.words)
  /** "8 chapters · 24 scenes · 31,220 of 36,000 words" */
  const summary = computed(() => {
    const n = chapters.value.filter((c) => c.id).length
    const of = target.value ? ` of ${target.value.toLocaleString('en-US')}` : ''
    return `${n} ${n === 1 ? 'chapter' : 'chapters'} · ${sceneCount.value} ${sceneCount.value === 1 ? 'scene' : 'scenes'} · ${words.value.toLocaleString('en-US')}${of} words`
  })

  const arcOptions = computed(() => (ws.data && ws.bookId ? arcsFor(ws.data, ws.bookId) : []))
  const povOptions = computed(() => {
    const data = ws.data
    if (!data) return []
    return [
      { value: NO_VALUE, label: '—', aria: 'None' },
      ...data.records
        .filter(
          (r) =>
            r.meta.type === 'character' &&
            (r.meta.scope === 'universe'
              ? r.universe === ws.universe?.id
              : r.meta.scope === `book:${ws.bookId}`),
        )
        .sort((a, b) => a.meta.title.localeCompare(b.meta.title))
        .map((r) => ({ value: r.meta.id, label: r.meta.title })),
    ]
  })
  const statusOptions = [
    { value: NO_VALUE, label: '—', aria: 'None' },
    ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
  ]

  /** What the cards' colour means: the arcs in use, or the statuses. */
  const legend = computed<{ id: string; name: string; colour: string }[]>(() =>
    plan.colourBy === 'arc'
      ? arcsInUse(parts.value).map((a: ArcRef) => ({
          id: a.id,
          name: a.name,
          colour: a.colour ?? 'var(--ink-3)',
        }))
      : Object.entries(STATUS_LABELS).map(([id, name]) => ({
          id,
          name,
          colour: STATUS_COLOURS[id as keyof typeof STATUS_COLOURS],
        })),
  )

  const write = (id: string, patch: Record<string, unknown>) =>
    guarded(async () => {
      if (ws.session) await setDetails(ws.session, id, patch)
    })
  const setStatus = (id: string, v: string) => write(id, { status: v === NO_VALUE ? undefined : v })
  const setPov = (id: string, v: string) => write(id, { pov: v === NO_VALUE ? undefined : v })
  const setArcs = (id: string, arcs: string[]) =>
    write(id, { arcs: arcs.length ? arcs : undefined })

  /**
   * A scene at the end of a chapter, and the side panel on it: the author stays in the plan. A book
   * with no chapter yet gets its first one, with its first scene, rather than nothing happening.
   */
  const addScene = (chapterId?: string) =>
    guarded(async () => {
      if (!ws.session || !ws.bookId) return
      const chapter =
        chapterId ||
        chapters.value.find((c) => c.scenes.some((s) => s.id === plan.selected))?.id ||
        chapters.value.filter((c) => c.id).at(-1)?.id
      const id = chapter
        ? await ws.addScene(chapter)
        : (await addChapter(ws.session, ws.bookId)).scene
      if (id) plan.selected = id
    })

  const select = (id: string | null) => (plan.selected = id)
  const open = (sceneId: string) => ws.bookId && router.push(scenePath(ws.bookId, sceneId))

  /** The colour of a card's top bar: its first arc, or its status. */
  const barColour = (s: { arcs: { colour?: string }[]; status?: keyof typeof STATUS_COLOURS }) =>
    plan.colourBy === 'arc'
      ? (s.arcs[0]?.colour ?? 'var(--line-2)')
      : s.status
        ? STATUS_COLOURS[s.status]
        : 'var(--line-2)'

  return {
    plan,
    edit,
    parts,
    rows,
    chapters,
    summary,
    arcOptions,
    povOptions,
    statusOptions,
    legend,
    setStatus,
    setPov,
    setArcs,
    select,
    addScene,
    open,
    barColour,
  }
}
