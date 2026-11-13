// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { isString, usePersisted } from '@/composables/usePersisted'
import { bookOutline, bookWords, outlineScenes, sceneContext } from '@/domain/outline'
import { validateWorkspaceData, type WorkspaceData } from '@/domain/workspace-data'
import { buildEntries } from '@/index/palette-entries'
import { saltmarchSample } from '@/sample/saltmarch'
import { openSession, recents, reopen, workspaceIdOf } from '@/storage/app'
import type { StorageAdapter } from '@/storage/adapter'
import type { SessionView, WorkspaceSession } from '@/storage/session'
import { StorageError } from '@/storage/errors'
import { WORKSPACE_FILE } from '@/storage/paths'
import { saveWords } from '@/storage/status'

const isRecordOfStrings = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && Object.values(v).every((x) => typeof x === 'string')

/**
 * The loaded workspace and what is selected in it. A real workspace comes from a storage
 * session (`attach`), which keeps `data` true to the files; the sample is in memory only.
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const data = shallowRef<WorkspaceData | null>(null)
  const bookId = ref<string | null>(null)
  const sceneId = ref<string | null>(null)
  // Per device: the last scene open in each book, and whether the sample was open.
  const lastScene = usePersisted<Record<string, string>>('last-scene', {}, isRecordOfStrings)
  const lastBook = usePersisted('last-book', '', isString)
  const source = usePersisted('workspace-source', '', isString)

  // The open storage session, and its plain-words state. Both null for the sample.
  const session = shallowRef<WorkspaceSession | null>(null)
  const view = shallowRef<SessionView | null>(null)
  let unsubscribe: (() => void) | undefined

  const loaded = computed(() => data.value !== null)
  const book = computed(() => data.value?.books.find((b) => b.id === bookId.value))
  const universe = computed(() =>
    data.value?.universes.find((u) => u.books.includes(bookId.value ?? '')),
  )
  const outline = computed(() =>
    data.value && book.value ? bookOutline(data.value, book.value.id) : [],
  )
  const context = computed(() =>
    data.value && sceneId.value ? sceneContext(data.value, sceneId.value) : undefined,
  )
  const scene = computed(() => context.value?.scene)
  /** Everything the palette, the pinned list and the search can open. Built once per load. */
  const entries = computed(() => (data.value ? buildEntries(data.value) : []))
  const entryByKey = computed(() => new Map(entries.value.map((e) => [e.key, e])))
  /** What the footer, the status bar and the phone header say about saving. */
  const saveLabel = computed(() => (view.value ? saveWords(view.value) : 'not saved'))
  const saveState = computed(
    () => `${data.value?.workspace.name ?? 'Workspace'} · ${saveLabel.value}`,
  )
  const words = computed(() => ({
    scene: scene.value?.words ?? 0,
    chapter: context.value?.chapter.words ?? 0,
    book: data.value && bookId.value ? bookWords(data.value, bookId.value) : 0,
  }))

  /** Replace the workspace. What is open stays open while it still exists; else the caller goes to `startPath()`. */
  function load(next: WorkspaceData) {
    data.value = validateWorkspaceData(next)
    const book = bookId.value
    const stillOpen =
      !!book && hasBook(book) && (!sceneId.value || sceneFor(book, sceneId.value) === sceneId.value)
    if (!stillOpen) bookId.value = sceneId.value = null
  }
  function loadSample() {
    detach()
    load(saltmarchSample())
    source.value = 'sample'
  }

  /** Make a storage session the open workspace. The one before it is saved and let go. */
  function attach(next: WorkspaceSession) {
    detach()
    // What is open stays open when the new workspace has it (a restored copy has the same IDs, and
    // opens on the same address, so the route would never say so again).
    const [book, scene] = [bookId.value, sceneId.value]
    session.value = next
    data.value = next.data
    view.value = next.view()
    bookId.value = sceneId.value = null
    if (book && hasBook(book)) {
      bookId.value = book
      sceneId.value = scene && sceneFor(book, scene) === scene ? scene : null
    }
    unsubscribe = next.subscribe(() => {
      data.value = next.data
      view.value = next.view()
    })
    source.value = `recent:${next.data.workspace.id}`
  }
  /** Let the open session go: its words are saved, then its lock is released. */
  function detach(): Promise<void> {
    const old = session.value
    unsubscribe?.()
    unsubscribe = undefined
    session.value = view.value = null
    return old ? old.flush().finally(() => old.dispose()) : Promise.resolve()
  }

  /**
   * Open a workspace and attach it. The same workspace in this tab lets go first, so the new
   * session finds its lock free instead of reading as "open in another tab".
   */
  async function open(adapter: StorageAdapter) {
    const old = session.value
    const same = !!old && (await workspaceIdOf(adapter)) === old.data.workspace.id
    if (same) await detach()
    try {
      attach(await openSession(adapter))
    } catch (e) {
      if (same) data.value = bookId.value = sceneId.value = null // nothing is left to type into
      throw e
    }
  }

  let reopening: Promise<boolean> | undefined
  /** After a reload: open the recent workspace that was open. False when it needs the author (permission). */
  function reopenLast(key: string): Promise<boolean> {
    return (reopening ??= (async () => {
      const recent = await recents.get(key)
      const found = recent && (await reopen(recent))
      if (!found || !('adapter' in found)) return false
      try {
        await open(found.adapter)
        return true
      } catch {
        return false
      }
    })().finally(() => (reopening = undefined)))
  }

  /** Reopen what was open before a reload. True when a workspace is loaded. */
  async function ensureLoaded(): Promise<boolean> {
    if (data.value) return true
    if (source.value === 'sample') loadSample()
    else if (source.value.startsWith('recent:')) await reopenLast(source.value.slice(7))
    return data.value !== null
  }

  /** Typing in a scene: the screen updates now, the file follows through the save pipeline. */
  function editScene(id: string, body: string) {
    void session.value?.editScene(id, body)
  }
  /** A new scene at the end of a chapter; returns its ID. */
  async function addScene(chapterId: string): Promise<string | undefined> {
    return session.value?.createScene(chapterId)
  }
  const flush = () => session.value?.flush()

  /** Rename the open workspace; once the file says so, this device's recent list does too. */
  async function renameWorkspace(name: string) {
    const open = session.value
    if (!open)
      throw new StorageError(
        'read-only',
        'The sample workspace cannot be renamed. It is only a tour.',
      )
    await open.renameWorkspace(name)
    // Unsaved (a conflict, a failing disk): the list catches up the next time it is opened.
    if (!open.pipeline.isBusy(WORKSPACE_FILE))
      await recents.rename(open.data.workspace.id, open.data.workspace.name).catch(() => undefined)
  }

  const hasBook = (id: string) => data.value?.books.some((b) => b.id === id) ?? false

  /** The scene to show for a book: the one asked for, else the last one open here, else `fallback`, else the first. */
  function sceneFor(book: string, wanted?: string, fallback?: string): string | undefined {
    if (!data.value) return undefined
    const scenes = outlineScenes(bookOutline(data.value, book)).map((s) => s.meta.id)
    return [wanted, lastScene.value[book], fallback, scenes[0]].find(
      (id) => id && scenes.includes(id),
    )
  }

  function select(book: string, scene?: string) {
    if (!hasBook(book)) return
    bookId.value = book
    sceneId.value = sceneFor(book, scene) ?? null
    lastBook.value = book
    if (sceneId.value) lastScene.value = { ...lastScene.value, [book]: sceneId.value }
  }

  /** Where to land when a workspace has just been opened. */
  function startPath(): string {
    const start = data.value?.startAt
    const book = hasBook(lastBook.value)
      ? lastBook.value
      : (start?.book ?? data.value?.books[0]?.id)
    const scene = book
      ? sceneFor(book, undefined, book === start?.book ? start.scene : undefined)
      : undefined
    return book && scene ? `/w/${book}/${scene}` : '/'
  }

  return {
    data,
    bookId,
    sceneId,
    loaded,
    book,
    universe,
    outline,
    context,
    scene,
    entries,
    entryByKey,
    session,
    view,
    saveLabel,
    saveState,
    words,
    load,
    loadSample,
    attach,
    open,
    ensureLoaded,
    editScene,
    addScene,
    flush,
    renameWorkspace,
    hasBook,
    sceneFor,
    select,
    startPath,
  }
})
