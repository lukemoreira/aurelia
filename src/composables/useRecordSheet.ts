// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch } from 'vue'
import { RECORD_INFO } from '@/domain/record-types'
import type { Alias, Source, TextField } from '@/domain/schema/record'
import { wordsFor } from '@/storage/errors'
import { setDetails } from '@/storage/outline-actions'
import { aliasesPatch, sourcesPatch } from '@/storage/record-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { colourOf } from '@/domain/scene-details'
import { useOutlineEdits } from './useOutlineEdits'

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
    fields: {} as Partial<Record<TextField, string>>,
    aliases: [] as Alias[],
    sources: [] as Source[],
  })
  const sync = {
    summary: () => (draft.summary = record.value?.summary ?? ''),
    fields: () => {
      draft.fields = Object.fromEntries(
        (info.value?.fields ?? []).map((f) => [
          f.key,
          (record.value?.meta[f.key] as string | undefined) ?? '',
        ]),
      )
      seen.clear()
      for (const [k, v] of Object.entries(draft.fields)) seen.set(k, v)
    },
    sources: () => (draft.sources = (record.value?.meta.sources ?? []).map((x) => ({ ...x }))),
    aliases: () =>
      (draft.aliases = (record.value?.meta.aliases ?? []).map((a) => ({
        ...a,
        match: a.match ?? 'auto',
      }))),
  }
  /**
   * What this sheet itself wrote and is waiting to see land, per field, in order. When a file then
   * says one of those, the author may well have typed on into the next field since, so the draft
   * is left alone: only a change this sheet did not make (another device, a restore) is put into
   * the draft. Without it the save of one field would wipe the words already typed into the next.
   */
  const own = new Map<string, string[]>()
  /** What each field's file said when last looked at: only a field whose file changed is touched. */
  const seen = new Map<string, string>()
  const encoded = (v: unknown) => JSON.stringify(v ?? null)
  /** Whether the file's value is not one of this sheet's own saves (they land in order, so earlier ones are done too). */
  const fromElsewhere = (key: string, now: string) => {
    const waiting = own.get(key) ?? []
    const at = waiting.indexOf(now)
    if (at < 0) {
      own.delete(key)
      return true
    }
    waiting.splice(0, at + 1)
    return false
  }
  const wrote = (key: string, value: string) => own.set(key, [...(own.get(key) ?? []), value])
  // What is typed follows the files whenever they change under it (another device, a restore) —
  // each part on its own, so a name just added and not yet typed survives a save of the summary.
  const known = () => record.value?.meta
  const now = { immediate: true }
  watch(
    idOf,
    () => (own.clear(), sync.summary(), sync.aliases(), sync.fields(), sync.sources()),
    now,
  )
  watch(
    () => record.value?.summary ?? '',
    (value) => fromElsewhere('summary', value) && sync.summary(),
  )
  watch(
    () => encoded(known()?.aliases),
    (json) => fromElsewhere('aliases', json) && sync.aliases(),
  )
  watch(
    () => encoded(known()?.sources),
    (json) => fromElsewhere('sources', json) && sync.sources(),
  )
  watch(
    () => info.value?.fields.map((f) => known()?.[f.key] ?? '').join('\u0000'),
    () => {
      for (const f of info.value?.fields ?? []) {
        const value = (known()?.[f.key] as string | undefined) ?? ''
        if (seen.get(f.key) === value) continue
        seen.set(f.key, value)
        if (fromElsewhere(`field:${f.key}`, value) && (draft.fields[f.key] ?? '') !== value)
          draft.fields[f.key] = value
      }
    },
  )
  watch(idOf, () => (error.value = ''))

  async function save(patch: Record<string, unknown>) {
    const id = idOf()
    if (!ws.session || !id) return
    error.value = ''
    try {
      await setDetails(ws.session, id, patch)
    } catch (e) {
      // What was typed stays on screen, with the reason: the author may try again or copy it out.
      error.value = wordsFor(e)
      own.clear() // nothing this sheet wrote is waiting to land
    }
  }
  const text = (v: string) => (v.trim() ? v.trim() : undefined)
  const saveSummary = () => {
    wrote('summary', text(draft.summary) ?? '')
    return save({ summary: text(draft.summary) })
  }
  const saveField = (key: TextField) => {
    wrote(`field:${key}`, text(draft.fields[key] ?? '') ?? '')
    return save({ [key]: text(draft.fields[key] ?? '') })
  }
  const saveAliases = () => {
    const aliases = aliasesPatch(draft.aliases)
    wrote('aliases', encoded(aliases))
    return save({ aliases })
  }
  /** An arc's (or a character's) colour: one of the tokens, or none. */
  const saveColour = (colour: string | undefined) => save({ color: colour })
  const saveSources = () => {
    const sources = sourcesPatch(draft.sources)
    wrote('sources', encoded(sources))
    return save({ sources })
  }
  const addSource = () => draft.sources.push({ title: '' })
  const removeSource = (i: number) => {
    draft.sources.splice(i, 1)
    void saveSources()
  }
  /** The picture of this record: an imported image, or none. */
  const saveImage = (mediaId: string | undefined) => save({ image: mediaId })
  const addAlias = () => draft.aliases.push({ text: '', match: 'auto' })
  const removeAlias = (i: number) => {
    draft.aliases.splice(i, 1)
    void saveAliases()
  }
  /** Typing in the notes goes to the file as the scene's text does: now on screen, soon on disk. */
  function typeNotes(body: string) {
    const id = idOf()
    if (id) void ws.session?.editNotes(id, body).catch((e) => (error.value = wordsFor(e)))
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
    saveColour,
    saveSources,
    addSource,
    removeSource,
    saveImage,
    addAlias,
    removeAlias,
    typeNotes,
    flush: () => ws.flush(),
  }
}
