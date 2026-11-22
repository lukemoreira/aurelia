// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch } from 'vue'
import { arcsFor } from '@/domain/plan'
import { STATUS_LABELS } from '@/domain/ui-names'
import { checkTitle } from '@/domain/titles'
import { websiteLink } from '@/domain/website'
import { parseCount } from '@/domain/writing-log'
import { wordsFor } from '@/storage/errors'
import { renameItem, setDetails } from '@/storage/outline-actions'
import { setBookMode } from '@/storage/story-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { useOutlineEdits } from './useOutlineEdits'

export type DetailsKind = 'scene' | 'chapter' | 'part' | 'book'

/** The sentinel for "none" in a select, which cannot hold an empty value. */
export const NONE = '__none'

/** Which fields each kind has (PLANS M5, from the spec's table): the rest are the same for all. */
export const DETAIL_FIELDS: Record<DetailsKind, string[]> = {
  scene: ['pov', 'location', 'objective', 'conflict', 'outcome', 'target', 'arcs'],
  chapter: ['objective', 'target', 'arcs'],
  part: [],
  book: ['goal', 'website', 'art'],
}

type TextKey = 'summary' | 'objective' | 'conflict' | 'outcome'
const TEXT_KEYS: TextKey[] = ['summary', 'objective', 'conflict', 'outcome']

interface Bag {
  title: string
  status?: string
  summary?: string
  pov?: string
  location?: string
  objective?: string
  conflict?: string
  outcome?: string
  target?: number
  targets?: { words?: number }
  website?: string
  logo?: string
  cover?: string
  arcs: string[]
  mode?: string
  ending?: boolean
  choices?: unknown[]
}

/**
 * The details an author sets on a scene, chapter, part or book: title, status, summary, and the
 * fields each kind has (a scene's point of view, place, objective, conflict, outcome, word target
 * and arcs; a chapter's objective, target and arcs; a book's mode). Text is saved when the author
 * leaves the field, a choice when it is made. Each is one change to one file; a title goes
 * through the same check as a rename.
 */
export function useItemDetails(kind: DetailsKind, idOf: () => string | undefined) {
  const ws = useWorkspaceStore()
  const edit = useOutlineEdits()
  const error = ref('')
  const draft = reactive({
    title: '',
    summary: '',
    objective: '',
    conflict: '',
    outcome: '',
    target: '',
    goal: '',
    website: '',
  })

  /** The item as the files say now. */
  const item = computed((): Bag | undefined => {
    const id = idOf()
    const data = ws.data
    if (!id || !data) return undefined
    const scene = kind === 'scene' ? data.scenes.find((s) => s.meta.id === id)?.meta : undefined
    if (kind === 'scene') return scene && { arcs: [], ...scene }
    const list = { chapter: data.chapters, part: data.parts, book: data.books }[kind]
    const found = list.find((x) => x.id === id) as Omit<Bag, 'arcs'> & { arcs?: string[] }
    return found && { ...found, arcs: found.arcs ?? [] }
  })

  const FIELDS = ['title', ...TEXT_KEYS, 'target', 'goal', 'website'] as const
  const storedOf = (k: (typeof FIELDS)[number]) =>
    k === 'target'
      ? item.value?.target
        ? String(item.value.target)
        : ''
      : k === 'goal'
        ? item.value?.targets?.words
          ? String(item.value.targets.words)
          : ''
        : (item.value?.[k] ?? '')
  /** What each draft last matched in the files. */
  const seen = reactive<Record<string, string>>({})
  const reset = () => {
    for (const k of FIELDS) draft[k] = seen[k] = storedOf(k)
    error.value = ''
  }
  // Another item: everything starts from the files.
  watch(idOf, reset, { immediate: true })
  // The files change under what is typed (another device, a restore, a save of another field): only
  // a field whose own stored value changed follows, and only when the author has not changed it —
  // so a save landing in one field never takes the words out of another.
  watch(
    () => FIELDS.map(storedOf).join('\u0000'),
    () => {
      for (const k of FIELDS) {
        const now = storedOf(k)
        if (now === seen[k]) continue
        if (draft[k] === seen[k]) draft[k] = now
        seen[k] = now
      }
    },
  )

  const readOnly = computed(() => !edit.canEdit.value)

  async function run(work: () => Promise<void>) {
    error.value = ''
    try {
      await work()
    } catch (e) {
      error.value = wordsFor(e) // what was typed stays, to be tried again
    }
  }

  const saveTitle = () =>
    run(async () => {
      const id = idOf()
      if (!ws.session || !id || draft.title.trim() === item.value?.title) return
      const checked = checkTitle(draft.title)
      if (!checked.ok) {
        error.value = checked.error || 'Give it a name.'
        return
      }
      await renameItem(ws.session, id, checked.title)
    })

  /** Set a detail; `undefined` takes it away. */
  const set = (key: string, value: unknown) =>
    run(async () => {
      const id = idOf()
      const now = item.value ? (item.value as unknown as Record<string, unknown>)[key] : undefined
      if (ws.session && id && JSON.stringify(value) !== JSON.stringify(now))
        await setDetails(ws.session, id, { [key]: value })
    })
  const saveText = (key: TextKey) => set(key, draft[key].trim() ? draft[key] : undefined)
  const saveTarget = () => {
    const n = parseCount(draft.target)
    if (n === undefined) {
      error.value = 'The word target is a whole number, like 1800.'
      return Promise.resolve()
    }
    return set('target', n || undefined)
  }
  /** The book's word goal is `targets.words` in book.json; the other targets there stay as they are. */
  const saveGoal = () => {
    const n = parseCount(draft.goal)
    if (n === undefined) {
      error.value = 'The word goal is a whole number, like 90000.'
      return Promise.resolve()
    }
    const next = { ...item.value?.targets, words: n || undefined }
    if (!n) delete next.words
    return set('targets', Object.keys(next).length ? next : undefined)
  }

  /** The book's web address, as typed; empty takes it away. */
  const saveWebsite = () => set('website', draft.website.trim() || undefined)
  /** Where the saved address goes when followed: http(s) only (a bare domain gets https). */
  const websiteHref = computed(() => websiteLink(item.value?.website))
  /** The book's logo or cover art: an image of the gallery; `undefined` takes it away. */
  const setArt = (key: 'logo' | 'cover', id: string | undefined) => set(key, id)

  const status = computed({
    get: () => item.value?.status ?? NONE,
    set: (v: string) => void set('status', v === NONE ? undefined : v),
  })
  const statusOptions = [
    { value: NONE, label: 'No status' },
    ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
  ]

  /** Records this item's book can name: shared by its universe, or private to the book. */
  const recordsOf = (type: 'character' | 'place') => {
    const data = ws.data
    const book = ws.bookId
    if (!data) return []
    return data.records
      .filter(
        (r) =>
          r.meta.type === type &&
          (r.meta.scope === 'universe'
            ? r.universe === ws.universe?.id
            : r.meta.scope === `book:${book}`),
      )
      .sort((a, b) => a.meta.title.localeCompare(b.meta.title))
  }
  /** A select of records, with "none", and a line for one that is no longer there. */
  const recordSelect = (key: 'pov' | 'location', type: 'character' | 'place', none: string) => ({
    model: computed({
      get: () => item.value?.[key] ?? NONE,
      set: (v: string) => void set(key, v === NONE ? undefined : v),
    }),
    options: computed(() => {
      const known = recordsOf(type).map((r) => ({ value: r.meta.id, label: r.meta.title }))
      const current = item.value?.[key]
      return [
        { value: NONE, label: none },
        ...(current && !known.some((o) => o.value === current)
          ? [{ value: current, label: `A ${type} that is no longer here` }]
          : []),
        ...known,
      ]
    }),
  })
  const pov = recordSelect('pov', 'character', 'No point of view')
  const location = recordSelect('location', 'place', 'No place')

  const arcOptions = computed(() => (ws.data && ws.bookId ? arcsFor(ws.data, ws.bookId) : []))
  const arcs = computed({
    get: () => item.value?.arcs ?? [],
    set: (v: string[]) => void set('arcs', v.length ? v : undefined),
  })

  const branching = computed({
    get: () => item.value?.mode === 'branching',
    set: (v: boolean) =>
      void run(async () => {
        const id = idOf()
        if (ws.session && id) await setBookMode(ws.session, id, v ? 'branching' : 'linear')
      }),
  })

  return {
    item,
    draft,
    error,
    readOnly,
    saveTitle,
    saveText,
    saveTarget,
    saveGoal,
    saveWebsite,
    websiteHref,
    setArt,
    status,
    statusOptions,
    pov: pov.model,
    povOptions: pov.options,
    location: location.model,
    locationOptions: location.options,
    arcs,
    arcOptions,
    branching,
  }
}
