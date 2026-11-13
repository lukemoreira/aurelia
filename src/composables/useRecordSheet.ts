// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch } from 'vue'
import { RECORD_INFO } from '@/domain/record-types'
import type { Alias } from '@/domain/schema/record'
import { wordsFor } from '@/storage/errors'
import { setDetails } from '@/storage/outline-actions'
import { aliasesPatch } from '@/storage/record-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { colourOf } from '@/domain/scene-details'
import { useOutlineEdits } from './useOutlineEdits'

type BasicKey = 'role' | 'kind' | 'when' | 'purpose'

/**
 * The sheet of one record: its name, summary, other names, the type's basic fields and its notes.
 * Text is saved as the author leaves a field (the notes as they type, through the save pipeline);
 * every change is one change to the record's own file.
 */
export function useRecordSheet(idOf: () => string | undefined) {
  const ws = useWorkspaceStore()
  const edit = useOutlineEdits()
  const error = ref('')
  const record = computed(() => ws.data?.records.find((r) => r.meta.id === idOf()))
  const info = computed(() => (record.value ? RECORD_INFO[record.value.meta.type] : undefined))
  const readOnly = computed(() => !edit.canEdit.value)

  const draft = reactive({
    summary: '',
    notes: '',
    fields: {} as Partial<Record<BasicKey, string>>,
    aliases: [] as Alias[],
  })
  const sync = {
    summary: () => (draft.summary = record.value?.summary ?? ''),
    notes: () => (draft.notes = record.value?.body ?? ''),
    fields: () =>
      (draft.fields = Object.fromEntries(
        (info.value?.fields ?? []).map((f) => [
          f.key,
          (record.value?.meta[f.key] as string | undefined) ?? '',
        ]),
      )),
    aliases: () =>
      (draft.aliases = (record.value?.meta.aliases ?? []).map((a) => ({
        ...a,
        match: a.match ?? 'auto',
      }))),
  }
  const fromFiles = () => Object.values(sync).forEach((f) => f())
  // What is typed follows the files whenever they change under it (another device, a restore) —
  // each part on its own, so a name just added and not yet typed survives a save of the summary.
  const known = () => record.value?.meta
  const now = { immediate: true }
  watch([idOf, () => record.value?.summary], sync.summary, now)
  watch([idOf, () => record.value?.body], sync.notes, now)
  watch([idOf, () => JSON.stringify(known()?.aliases)], sync.aliases, now)
  watch(
    [idOf, () => info.value?.fields.map((f) => known()?.[f.key]).join('\u0000')],
    sync.fields,
    now,
  )
  watch(idOf, () => (error.value = ''))

  async function save(patch: Record<string, unknown>) {
    const id = idOf()
    if (!ws.session || !id) return
    error.value = ''
    try {
      await setDetails(ws.session, id, patch)
    } catch (e) {
      error.value = wordsFor(e)
      fromFiles()
    }
  }
  const text = (v: string) => (v.trim() ? v.trim() : undefined)
  const saveSummary = () => save({ summary: text(draft.summary) })
  const saveField = (key: BasicKey) => save({ [key]: text(draft.fields[key] ?? '') })
  const saveAliases = () => save({ aliases: aliasesPatch(draft.aliases) })
  const addAlias = () => draft.aliases.push({ text: '', match: 'auto' })
  const removeAlias = (i: number) => {
    draft.aliases.splice(i, 1)
    void saveAliases()
  }
  /** Typing in the notes goes to the file as the scene's text does: now on screen, soon on disk. */
  function typeNotes() {
    const id = idOf()
    if (id) void ws.session?.editNotes(id, draft.notes).catch((e) => (error.value = wordsFor(e)))
  }

  const scope = computed(() => {
    const r = record.value
    if (!r) return ''
    const book = r.meta.scope.startsWith('book:')
      ? ws.data?.books.find((b) => `book:${b.id}` === r.meta.scope)?.title
      : undefined
    if (book) return `Only in ${book}`
    const universe = ws.data?.universes.find((u) => u.id === r.universe)
    // A standalone book has nothing to share with: "Shared" would be a claim about nothing.
    return universe?.kind === 'shared' ? `Shared · ${universe.title}` : 'In this book'
  })

  return {
    record,
    info,
    readOnly,
    error,
    draft,
    scope,
    colour: computed(() => colourOf(record.value)),
    saveSummary,
    saveField,
    saveAliases,
    addAlias,
    removeAlias,
    typeNotes,
    flush: () => ws.flush(),
  }
}
