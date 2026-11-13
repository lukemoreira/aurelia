// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch } from 'vue'
import { STATUS_LABELS } from '@/domain/ui-names'
import { checkTitle } from '@/domain/titles'
import { wordsFor } from '@/storage/errors'
import { renameItem, setDetails } from '@/storage/outline-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { useOutlineEdits } from './useOutlineEdits'

export type DetailsKind = 'scene' | 'chapter' | 'part' | 'book'

/** The sentinel for "none" in a select, which cannot hold an empty value. */
export const NONE = '__none'

/**
 * The details an author sets on a scene, chapter, part or book: title, status, summary (and a
 * scene's point of view). Text is saved when the author leaves the field, a choice when it is made.
 * Each is one change to one file; a title goes through the same check as a rename.
 */
export function useItemDetails(kind: DetailsKind, idOf: () => string | undefined) {
  const ws = useWorkspaceStore()
  const edit = useOutlineEdits()
  const error = ref('')
  const draft = reactive({ title: '', summary: '' })

  /** The item as the files say now. */
  const item = computed(() => {
    const id = idOf()
    const data = ws.data
    if (!id || !data) return undefined
    if (kind === 'scene') {
      const m = data.scenes.find((s) => s.meta.id === id)?.meta
      return m && { title: m.title, status: m.status, summary: m.summary, pov: m.pov }
    }
    const list = { chapter: data.chapters, part: data.parts, book: data.books }[kind]
    const found = list.find((x) => x.id === id) as
      { title: string; status?: string; summary?: string } | undefined
    return (
      found && { title: found.title, status: found.status, summary: found.summary, pov: undefined }
    )
  })

  // What is typed follows the files whenever they change under it (another device, a restore).
  watch(
    [idOf, () => item.value?.title, () => item.value?.summary],
    () => {
      draft.title = item.value?.title ?? ''
      draft.summary = item.value?.summary ?? ''
      error.value = ''
    },
    { immediate: true },
  )

  const readOnly = computed(() => !edit.canEdit.value)

  async function run(work: () => Promise<void>) {
    error.value = ''
    try {
      await work()
    } catch (e) {
      error.value = wordsFor(e)
    }
  }

  const saveTitle = () =>
    run(async () => {
      const id = idOf()
      if (!ws.session || !id || draft.title.trim() === item.value?.title) return
      const checked = checkTitle(draft.title)
      if (!checked.ok) {
        draft.title = item.value?.title ?? ''
        error.value = checked.error || 'Give it a name.'
        return
      }
      await renameItem(ws.session, id, checked.title)
    })

  /** Set a detail; `undefined` takes it away. */
  const set = (key: 'status' | 'summary' | 'pov', value: string | undefined) =>
    run(async () => {
      const id = idOf()
      if (ws.session && id && value !== item.value?.[key])
        await setDetails(ws.session, id, { [key]: value })
    })
  const saveSummary = () => set('summary', draft.summary.trim() ? draft.summary : undefined)

  const status = computed({
    get: () => item.value?.status ?? NONE,
    set: (v: string) => void set('status', v === NONE ? undefined : v),
  })
  const statusOptions = [
    { value: NONE, label: 'No status' },
    ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
  ]

  /** Characters this item's book can name: shared by its universe, or private to the book. */
  const characters = computed(() => {
    const data = ws.data
    const book = ws.bookId
    if (!data) return []
    return data.records
      .filter(
        (r) =>
          r.meta.type === 'character' &&
          (r.meta.scope === 'universe'
            ? r.universe === ws.universe?.id
            : r.meta.scope === `book:${book}`),
      )
      .sort((a, b) => a.meta.title.localeCompare(b.meta.title))
  })
  const pov = computed({
    get: () => item.value?.pov ?? NONE,
    set: (v: string) => void set('pov', v === NONE ? undefined : v),
  })
  const povOptions = computed(() => {
    const known = characters.value.map((r) => ({ value: r.meta.id, label: r.meta.title }))
    const current = item.value?.pov
    return [
      { value: NONE, label: 'No point of view' },
      ...(current && !known.some((o) => o.value === current)
        ? [{ value: current, label: 'A character that is no longer here' }]
        : []),
      ...known,
    ]
  })

  return {
    item,
    draft,
    error,
    readOnly,
    saveTitle,
    saveSummary,
    status,
    statusOptions,
    pov,
    povOptions,
  }
}
