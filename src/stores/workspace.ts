// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { isString, usePersisted } from '@/composables/usePersisted'
import { bookOutline, bookWords, outlineScenes, sceneContext } from '@/domain/outline'
import { validateWorkspaceData, type WorkspaceData } from '@/domain/workspace-data'
import { buildEntries } from '@/index/palette-entries'
import { saltmarchSample } from '@/sample/saltmarch'

const isRecordOfStrings = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && Object.values(v).every((x) => typeof x === 'string')

/**
 * The loaded workspace and what is selected in it. In memory only: the storage layer (M2)
 * will call `load()` with what it reads from a folder or the browser.
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const data = shallowRef<WorkspaceData | null>(null)
  const bookId = ref<string | null>(null)
  const sceneId = ref<string | null>(null)
  // Per device: the last scene open in each book, and whether the sample was open.
  const lastScene = usePersisted<Record<string, string>>('last-scene', {}, isRecordOfStrings)
  const lastBook = usePersisted('last-book', '', isString)
  const source = usePersisted('workspace-source', '', isString)

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
  const saveState = computed(() => `${data.value?.workspace.name ?? 'Workspace'} · not saved`)
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
    load(saltmarchSample())
    source.value = 'sample'
  }
  /** Reopen what was open before a reload. True when a workspace is loaded. */
  function ensureLoaded(): boolean {
    if (!data.value && source.value === 'sample') loadSample()
    return data.value !== null
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
    const book = hasBook(lastBook.value) ? lastBook.value : start?.book
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
    saveState,
    words,
    load,
    loadSample,
    ensureLoaded,
    hasBook,
    sceneFor,
    select,
    startPath,
  }
})
