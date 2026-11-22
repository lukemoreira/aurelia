// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch } from 'vue'
import { bookUnfiled } from '@/domain/outline'
import {
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_ID,
  PROFILES_PATH,
  isLanguage,
  newProfileId,
  readProfiles,
  withProfile,
  withoutProfile,
  type ExportProfile,
} from '@/export/profile'
import { wordsFor } from '@/storage/errors'
import { useEditsStore } from '@/stores/edits'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import { saveBlob } from './useDownloadCopy'

/** A copy the form can change without touching the saved profile. */
const copyOf = (p: ExportProfile): ExportProfile => ({ ...p })
const same = (a: object, b: object) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

/**
 * The Export dialog: the saved settings ("profiles") of the workspace (a file; in the sample, kept until the tab
 * closes), the ones being edited, and what Export does with them: a download, or the print view of a PDF.
 */
export function useExportDialog() {
  const ws = useWorkspaceStore()
  const layout = useLayoutStore()
  const edits = useEditsStore()

  const profiles = ref<ExportProfile[]>([DEFAULT_PROFILE])
  const selectedId = ref(DEFAULT_PROFILE_ID)
  const draft = reactive<ExportProfile>(copyOf(DEFAULT_PROFILE))
  const naming = ref(false)
  const newName = ref('')
  const busy = ref(false)
  const error = ref('')
  /** What was just done to a saved setting, said politely to a screen reader and shown. */
  const notice = ref('')
  /** Another saved setting was asked for while this one has changes that are not saved: asking what to do. */
  const pendingId = ref<string | null>(null)
  const confirmingDelete = ref(false)
  /** The sample has no files: its profiles live here. */
  let memory: ExportProfile[] = []

  const selected = computed(() => profiles.value.find((p) => p.id === selectedId.value))
  const dirty = computed(() => !!selected.value && !same(selected.value, draft))
  /** The built-in "Standard" is never written over: changes to it are saved as a new profile. */
  const saved = computed(() => selectedId.value !== DEFAULT_PROFILE_ID)
  const canSave = computed(() => !ws.view?.readOnly)
  const unfiled = computed(() =>
    ws.data && ws.bookId ? bookUnfiled(ws.data, ws.bookId).length : 0,
  )
  const languageError = computed(() =>
    draft.format === 'epub' && !isLanguage(draft.language)
      ? 'Use a language code, like en or fr-CA.'
      : '',
  )

  function select(id: string) {
    const next = profiles.value.find((p) => p.id === id) ?? DEFAULT_PROFILE
    // Settings of another profile must not carry over: keys this one does not have go.
    for (const key of Object.keys(draft))
      if (!(key in next)) delete (draft as Record<string, unknown>)[key]
    Object.assign(draft, copyOf(next))
    selectedId.value = next.id
    pendingId.value = null
    confirmingDelete.value = false
  }

  /** The author chose a saved setting: with unsaved changes, ask before they are dropped. */
  function choose(id: string) {
    if (id === selectedId.value) return
    if (dirty.value) pendingId.value = id
    else select(id)
    notice.value = ''
  }
  const confirmSwitch = () => pendingId.value && select(pendingId.value)
  const keepEditing = () => (pendingId.value = null)

  async function load() {
    error.value = ''
    notice.value = ''
    naming.value = false
    try {
      const file = ws.session ? await ws.session.adapter.read(PROFILES_PATH) : undefined
      const read = readProfiles(file?.text)
      profiles.value = ws.session
        ? read.profiles
        : [...read.profiles, ...memory.filter((m) => !read.profiles.some((p) => p.id === m.id))]
    } catch (e) {
      profiles.value = [DEFAULT_PROFILE]
      error.value = wordsFor(e, 'Your saved export settings could not be read.')
    }
    select(
      profiles.value.some((p) => p.id === selectedId.value) ? selectedId.value : DEFAULT_PROFILE_ID,
    )
  }
  watch(
    () => layout.exportOpen,
    (open) => {
      if (!open) return
      // Where focus was when this opened: what a print view gives it back to.
      layout.printReturn = document.activeElement
      void load()
    },
    { immediate: true, flush: 'sync' },
  )

  /** Write a profile to the settings file (the file as it is now, plus this one), then show the list again. */
  async function put(profile: ExportProfile) {
    if (!ws.session) {
      memory = [...memory.filter((m) => m.id !== profile.id), profile]
      profiles.value = [...profiles.value.filter((p) => p.id !== profile.id), profile]
    } else {
      await ws.session.writeDerived(PROFILES_PATH, (disk) => withProfile(disk, profile))
      await load()
    }
  }

  async function guarded(work: () => Promise<void>) {
    error.value = ''
    try {
      await work()
    } catch (e) {
      error.value = wordsFor(e, 'Aurelia could not save that. Nothing was lost.')
    }
  }

  const saveChanges = () =>
    guarded(async () => {
      if (!saved.value) return
      await put(copyOf(draft))
      select(draft.id)
      notice.value = `Saved “${draft.name}”.`
    })

  const saveAs = () =>
    guarded(async () => {
      const name = newName.value.trim()
      if (!name) return
      const profile = { ...copyOf(draft), id: newProfileId(), name }
      await put(profile)
      naming.value = false
      newName.value = ''
      select(profile.id)
      notice.value = `Saved as “${name}”.`
    })

  const remove = () =>
    guarded(async () => {
      const id = selectedId.value
      const name = selected.value?.name ?? ''
      if (id === DEFAULT_PROFILE_ID) return
      if (!ws.session) {
        memory = memory.filter((m) => m.id !== id)
        profiles.value = profiles.value.filter((p) => p.id !== id)
      } else {
        await ws.session.writeDerived(PROFILES_PATH, (disk) => withoutProfile(disk, id))
        await load()
      }
      select(DEFAULT_PROFILE_ID)
      notice.value = `Deleted “${name}”.`
    })

  /** Export: a file to download, or the print view for a PDF. */
  async function run() {
    const data = ws.data
    const bookId = ws.bookId
    if (!data || !bookId || busy.value || languageError.value) return
    busy.value = true
    error.value = ''
    try {
      const profile = copyOf(draft)
      // The writers load when they are first needed: most sessions never export.
      const { exportBook, printBook } = await import('@/export')
      const { readCover } = await import('@/export/cover')
      // The book's cover art, when it has one that can be read: an export without it is the same export.
      const adapter = ws.session?.adapter
      const cover =
        (profile.format === 'epub' || profile.format === 'pdf') && adapter
          ? await readCover(data, bookId, (path) => adapter.readBytes(path))
          : undefined
      if (profile.format === 'pdf') {
        layout.print = printBook(data, bookId, profile, cover)
        layout.exportOpen = false
      } else {
        const file = exportBook(data, bookId, profile, cover)
        saveBlob(file.blob, file.filename)
        layout.exportOpen = false
        edits.toast = {
          text: `Exported ${file.filename}. Your browser saved it to your downloads.`,
        }
      }
    } catch (e) {
      error.value = wordsFor(e, 'Aurelia could not make that file. Nothing was lost.')
    } finally {
      busy.value = false
    }
  }

  return {
    profiles,
    selectedId,
    draft,
    dirty,
    saved,
    canSave,
    unfiled,
    languageError,
    naming,
    newName,
    busy,
    error,
    notice,
    pendingId,
    confirmingDelete,
    choose,
    confirmSwitch,
    keepEditing,
    saveChanges,
    saveAs,
    remove,
    run,
  }
}
