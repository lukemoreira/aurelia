// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, toRaw, watch } from 'vue'
import type { ContinuityFinding, FindingGroup } from '@/domain/continuity-checks'
import {
  arcLanes,
  continuityStats,
  pacing,
  povBalance,
  presenceMap,
  setupTally,
  timeChart,
} from '@/domain/continuity-views'
import { setDismissed } from '@/storage/story-actions'
import { useEditsStore } from '@/stores/edits'
import { useReviewStore } from '@/stores/review'
import { useWorkspaceStore } from '@/stores/workspace'
import { useContinuityModel } from './useContinuityModel'
import { useGuarded } from './useGuarded'
import { useNavigation } from './useNavigation'
import { useOutlineEdits } from './useOutlineEdits'

/** How many chapters the map shows at a time: a book of 120 chapters is read a stretch at a time. */
export const RANGE = 24

export type FindingFilter = 'all' | FindingGroup
export const FILTERS: { value: FindingFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'characters', label: 'Characters' },
  { value: 'time', label: 'Time' },
  { value: 'threads', label: 'Threads' },
  { value: 'story', label: 'Story' },
]

/**
 * The Continuity view: the presence map, arc lanes, story time against reading order, POV
 * balance and pacing, and the findings list with its filter, "Mark intended" and going to the
 * scene. Reads the one model of the open book; the only writes are the marks in `book.json`.
 */
export function useContinuity() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const review = useReviewStore()
  const { model, all, split } = useContinuityModel()
  const nav = useNavigation()
  const edit = useOutlineEdits()
  const guarded = useGuarded()

  const open = computed(() => split.value.active)
  const rows = computed(() => (model.value ? presenceMap(model.value, open.value) : []))
  const lanes = computed(() => (model.value ? arcLanes(model.value) : []))
  const chart = computed(() => (model.value ? timeChart(model.value, open.value) : undefined))
  const pov = computed(() => (model.value ? povBalance(model.value) : []))
  const setups = computed(() => (model.value ? setupTally(model.value) : { total: 0, paid: 0 }))
  const pace = computed(() => (model.value ? pacing(model.value) : []))
  const stats = computed(() =>
    model.value ? continuityStats(model.value, rows.value, open.value) : [],
  )
  const chapters = computed(() => model.value?.chapters ?? [])

  // Who is shown: everyone on the page, or only the people who carry the story.
  const who = ref<'everyone' | 'main'>('everyone')
  const shown = computed(() =>
    who.value === 'main' ? rows.value.filter((r) => r.main) : rows.value,
  )

  // The stretch of chapters in view.
  const from = ref(0)
  const range = computed(() => {
    const start = Math.min(from.value, Math.max(0, chapters.value.length - 1))
    return { start, end: Math.min(chapters.value.length, start + RANGE) }
  })
  const columns = computed(() => chapters.value.slice(range.value.start, range.value.end))
  /** "Chapters 5–8", and where that is among a long book's chapters: "· 25–48 of 120". */
  const rangeWords = computed(() => {
    const real = columns.value.filter((c) => c.id)
    if (!columns.value.length) return 'No chapters yet'
    const label = !real.length
      ? 'Unfiled scenes'
      : real.length === 1
        ? `Chapter ${real[0]!.number}`
        : `Chapters ${real[0]!.number}–${real.at(-1)!.number}`
    const total = chapters.value.length
    return total > RANGE
      ? `${label} · ${range.value.start + 1}–${range.value.end} of ${total}`
      : label
  })
  const page = (by: -1 | 1) => (from.value = Math.max(0, from.value + by * RANGE))
  const canPage = (by: -1 | 1) =>
    by < 0 ? range.value.start > 0 : range.value.end < chapters.value.length
  watch(
    () => ws.bookId,
    () => {
      from.value = 0
      edits.findingsScene = null
    },
  )

  // The findings list: by group, and (from the inspector's "Review") for one scene alone.
  const filter = ref<FindingFilter>('all')
  const only = computed(() => edits.findingsScene)
  const onlyTitle = computed(() => {
    const s = model.value?.byId.get(only.value ?? '')
    return s ? `${s.ref} · ${s.title}` : ''
  })
  const showAll = () => (edits.findingsScene = null)
  const inScope = (f: ContinuityFinding) =>
    !only.value || f.scene === only.value || f.related.includes(only.value)
  const counts = computed(() => {
    const n: Record<string, number> = { all: 0 }
    for (const f of open.value.filter((x) => !x.possible && inScope(x))) {
      n.all = (n.all ?? 0) + 1
      n[f.group] = (n[f.group] ?? 0) + 1
    }
    return n
  })
  const inFilter = (f: ContinuityFinding) =>
    inScope(f) && (filter.value === 'all' || f.group === filter.value)
  const certain = computed(() => open.value.filter((f) => !f.possible && inFilter(f)))
  /** Times that only overlap: shown apart, collapsed (ADR-0006 §4). */
  const possible = computed(() => open.value.filter((f) => f.possible && inFilter(f)))
  const marked = computed(() => split.value.dismissed.filter(inFilter))

  // A cell of the map that holds a finding leads to it: the list scrolls to it and takes the keyboard.
  const focusRequest = ref<{ fingerprint: string; n: number } | null>(null)
  const findingAt = (who: string, chapter: number) =>
    open.value.find(
      (f) =>
        !f.possible &&
        f.group !== 'threads' &&
        f.subject === who &&
        model.value?.byId.get(f.scene)?.chapter === chapter,
    )
  /** What a cell says, in a sentence: for a keyboard or a finger, where there is no hover. */
  const detail = ref('')
  function describeCell(row: { id: string; name: string }, chapter: number, text: string) {
    const f = findingAt(row.id, chapter)
    const number = chapters.value[chapter]?.number
    detail.value = `${row.name}, chapter ${number}: ${text}.${f ? ` ${f.body}` : ''}`
    if (f) {
      filter.value = 'all'
      focusRequest.value = { fingerprint: f.fingerprint, n: (focusRequest.value?.n ?? 0) + 1 }
    }
  }

  const canEdit = edit.canEdit
  /** "Mark intended" and its undo: the list changes by the one fingerprint, where it is written. */
  const dismiss = (f: ContinuityFinding, on: boolean) =>
    guarded(async () => {
      if (ws.session && ws.bookId)
        await setDismissed(ws.session, ws.bookId, {
          ...(on ? { add: f.fingerprint } : { remove: f.fingerprint }),
          found: all.value.map((x) => x.fingerprint),
        })
    })
  /** The words in the text where a finding is, if they are known: a person as they are written there, or a broken link. */
  const placeOf = (f: ContinuityFinding) =>
    f.at ??
    (f.subject
      ? toRaw(ws.index)
          .foundNames(f.scene)
          .find((n) => n.target.id === f.subject)?.forms[0]?.text
      : undefined)
  /** "Go to": the scene opens with the place selected, and the keyboard in the text. */
  async function show(f: ContinuityFinding) {
    if (!ws.bookId) return
    const term = placeOf(f)
    await nav.openScene(ws.bookId, f.scene)
    // Once the scene is on screen: the editor takes the words and the keyboard.
    if (term) review.found = { id: f.scene, term }
  }

  return {
    model,
    rows,
    shown,
    lanes,
    chart,
    pov,
    pace,
    setups,
    stats,
    chapters,
    who,
    range,
    columns,
    rangeWords,
    page,
    canPage,
    filter,
    counts,
    certain,
    possible,
    marked,
    only,
    onlyTitle,
    showAll,
    focusRequest,
    findingAt,
    detail,
    describeCell,
    canEdit,
    dismiss,
    show,
  }
}
