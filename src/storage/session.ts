// SPDX-License-Identifier: AGPL-3.0-or-later
import { newId } from '@/domain/ids'
import { keyAfter } from '@/domain/order'
import { countWords } from '@/domain/prose'
import { CURRENT_SCHEMA_VERSION } from '@/domain/schema/common'
import type { Scene } from '@/domain/schema/scene'
import type { WorkspaceData } from '@/domain/workspace-data'
import { moveFile, type AdapterKind, type StorageAdapter } from './adapter'
import { OpenError, StorageError, isPermissionError, wordsFor } from './errors'
import { encode } from './hash'
import { guardWrites } from './guard-writes'
import { withBody, newHead } from './frontmatter'
import type { Journal } from './journal'
import { loadWorkspace, type ConflictedCopy, type LoadedWorkspace, type Problem } from './load'
import { classify, conflictedCopyOf, conflictsPathFor, scenePath } from './paths'
import { SavePipeline, type SaveSummary } from './save-pipeline'
import { parseSceneFile } from './scene-file'
import { zipFiles } from './zip'

export interface Note {
  id: string
  title: string
  text: string
}

export interface ConflictView {
  path: string
  title: string
  mine: string
  theirs: string | null
}

/** A plain snapshot of everything the screens say about the workspace. */
export interface SessionView {
  workspaceId: string
  name: string
  kind: AdapterKind
  label: string
  /** Nothing can be written: a newer version made the files, or another tab has them open. */
  readOnly: boolean
  /** A file is from a newer Aurelia. */
  newerVersion: boolean
  /** Another tab of this browser has the workspace open and is the one that writes. */
  otherTab: boolean
  /** This tab just took over: it is re-reading the files and finishing the dead tab's journal. */
  settling: boolean
  save: SaveSummary
  /** The browser no longer lets Aurelia use the folder. Edits wait in the journal. */
  permissionLost: boolean
  conflicts: ConflictView[]
  /** Each with the title of the scene it was made from (the path when it is not a scene). */
  copies: (ConflictedCopy & { title: string })[]
  problems: Problem[]
  notes: Note[]
  /** Browser storage only: true/false once the browser answered, null before. */
  persisted: boolean | null
  /** The first save has happened (the moment to suggest installing the app). */
  saved: boolean
  /** The recovery journal could not keep a copy: a crash now could cost the last words. */
  journalFailed: boolean
}

export interface SessionDeps {
  journal: Journal
  /** Ask the browser to keep this site's storage (`navigator.storage.persist`). */
  persist?: () => Promise<boolean | null>
  /** Whether it already does. */
  isPersisted?: () => Promise<boolean | null>
  debounceMs?: number
  /** `navigator.locks`: one tab at a time writes a workspace. Missing: every tab may (as before). */
  locks?: LockManager
}

const key = (items: object[]) => JSON.stringify(items)

/**
 * An open workspace: the data on screen, and everything that keeps it true to the files —
 * saving (one pipeline), conflicts, external changes, conflicted copies, lost permission.
 * Plain TypeScript: the screens subscribe to it and call it.
 */
export class WorkspaceSession {
  data: WorkspaceData
  /** A file said it is from a newer Aurelia. */
  private newer: boolean
  /** Another tab holds the workspace's lock: this one only reads. */
  private otherTab = false
  /**
   * This tab just got the lock and is re-reading the files and finishing the dead tab's journal.
   * Nothing may be typed meanwhile (it would replace the journal's words), but the pipeline
   * itself may still write: this is not part of `readOnly`.
   */
  private settling = false
  private releaseLock?: () => void
  private stopWaiting = new AbortController()
  private heads: Map<string, string>
  private scenePaths: Map<string, string>
  private problems: Problem[]
  private copies: ConflictedCopy[]
  private notes: Note[] = []
  private permissionLost = false
  private persisted: boolean | null = null
  private persistAsked = false
  private saved = false
  /** The author has typed or added something this session. */
  private wrote = false
  private checking = false
  private listeners = new Set<() => void>()
  /** Reads and writes go through this: it refuses every write in a read-only workspace. */
  readonly adapter: StorageAdapter
  readonly pipeline: SavePipeline

  private constructor(
    raw: StorageAdapter,
    loaded: LoadedWorkspace,
    private deps: SessionDeps,
  ) {
    this.data = loaded.data
    this.newer = loaded.readOnly
    this.heads = loaded.heads
    this.scenePaths = loaded.scenePaths
    this.problems = loaded.problems
    this.copies = loaded.copies
    this.adapter = guardWrites(raw, () => this.readOnly)
    this.pipeline = new SavePipeline({
      adapter: this.adapter,
      journal: deps.journal,
      workspaceId: loaded.data.workspace.id,
      isReadOnly: () => this.readOnly,
      notify: () => this.changed(),
      debounceMs: deps.debounceMs,
    })
    this.pipeline.adopt(loaded.hashes)
  }

  /** Nothing may be written: a newer version made the files, or another tab writes them. */
  get readOnly() {
    return this.newer || this.otherTab
  }

  /**
   * Read the workspace, then finish or surface anything the last session left in the journal.
   * Another tab that already has it open keeps the write lock: this one opens read-only, and
   * takes over (re-reads the files, finishes the journal) when that tab lets go.
   */
  static async open(raw: StorageAdapter, deps: SessionDeps): Promise<WorkspaceSession> {
    const session = new WorkspaceSession(raw, await loadWorkspace(raw), deps)
    if (raw.kind === 'browser') session.persisted = (await deps.isPersisted?.()) ?? null
    if (await session.takeLock()) await session.recover()
    return session
  }

  /** True when this tab may write. Otherwise a request waits for the other tab to let go. */
  private async takeLock(): Promise<boolean> {
    const locks = this.deps.locks
    if (!locks) return true
    const name = `aurelia-workspace:${this.data.workspace.id}`
    const hold = () => new Promise<void>((release) => (this.releaseLock = release))
    const got = await new Promise<boolean>((resolve) =>
      locks
        .request(name, { ifAvailable: true }, (lock) => {
          resolve(!!lock)
          return lock ? hold() : undefined
        })
        .catch(() => resolve(true)),
    )
    if (got) return true
    this.otherTab = true
    void locks
      .request(name, { signal: this.stopWaiting.signal }, () => {
        if (this.stopWaiting.signal.aborted) return // closed as the lock was granted: let it go
        const held = hold()
        void this.takeOver()
        return held
      })
      .catch(() => undefined) // aborted when the session is closed
    return false
  }

  /**
   * The other tab let go. Writing is allowed (the journal must finish), typing is not until the
   * files are read again and the dead tab's words are settled: `settling` says so on screen.
   */
  private async takeOver() {
    this.otherTab = false
    this.settling = true
    this.changed()
    try {
      // A failed re-read must not skip the journal: typing would replace the dead tab's words.
      await this.refresh().catch((e) => {
        this.onError(e)
        if (!isPermissionError(e))
          this.addNote('refresh-failed', 'Aurelia could not re-read your files', wordsFor(e))
      })
      if (this.stopWaiting.signal.aborted) return // closed while settling: no lock, no writes
      await this.recover()
    } catch (e) {
      this.onError(e)
    } finally {
      this.settling = false
      this.changed()
    }
  }

  // ---- what the screens read -------------------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed() {
    for (const fn of this.listeners) fn()
    void this.afterSave()
  }

  private titleOf(path: string): string {
    for (const [id, p] of this.scenePaths)
      if (p === path) return this.data.scenes.find((s) => s.meta.id === id)?.meta.title ?? path
    return path
  }

  view(): SessionView {
    const save = this.pipeline.summary()
    return {
      workspaceId: this.data.workspace.id,
      name: this.data.workspace.name,
      kind: this.adapter.kind,
      label: this.adapter.label,
      readOnly: this.readOnly || this.settling,
      newerVersion: this.newer,
      otherTab: this.otherTab,
      settling: this.settling,
      save,
      permissionLost: this.permissionLost || save.kind === 'blocked',
      conflicts: this.pipeline.conflicts().map((c) => ({ ...c, title: this.titleOf(c.path) })),
      copies: this.copies.map((c) => ({ ...c, title: this.titleOf(c.original) })),
      problems: this.problems,
      notes: this.notes,
      persisted: this.persisted,
      saved: this.saved,
      journalFailed: this.pipeline.journalFailed,
    }
  }

  addNote(id: string, title: string, text: string) {
    this.notes = [...this.notes.filter((n) => n.id !== id), { id, title, text }]
    this.changed()
  }

  dismissNote(id: string) {
    this.notes = this.notes.filter((n) => n.id !== id)
    this.changed()
  }

  /** The first save of a browser-storage workspace: ask the browser to keep it, and show the answer. */
  private async afterSave() {
    if (this.persistAsked || this.adapter.kind !== 'browser') return
    if (!this.wrote || this.pipeline.summary().kind !== 'saved') return
    this.persistAsked = true
    this.saved = true
    this.persisted = (await this.deps.persist?.()) ?? this.persisted
    this.changed()
  }

  // ---- editing ---------------------------------------------------------------------------

  /** Replace a scene's text. The screen updates now; the file follows through the save pipeline. */
  editScene(sceneId: string, body: string): Promise<void> {
    const path = this.scenePaths.get(sceneId)
    const head = path ? this.heads.get(path) : undefined
    const scene = this.data.scenes.find((s) => s.meta.id === sceneId)
    if (
      this.readOnly ||
      this.settling ||
      !path ||
      head === undefined ||
      !scene ||
      scene.body === body
    )
      return Promise.resolve()
    this.wrote = true
    this.data = {
      ...this.data,
      scenes: this.data.scenes.map((s) =>
        s === scene ? { ...s, body, words: countWords(body) } : s,
      ),
    }
    const written = this.pipeline.edit(path, withBody(head, body))
    this.changed()
    return written
  }

  /** A new, empty scene after the last one in a chapter. Returns its ID once the file is written. */
  async createScene(chapterId: string): Promise<string> {
    const chapter = this.data.chapters.find((c) => c.id === chapterId)
    const universe = this.data.universes.find((u) => u.books.includes(chapter?.book ?? ''))
    if (this.readOnly || this.settling || !chapter || !universe)
      throw new StorageError('other', 'There is nowhere to add a scene.')
    const siblings = this.data.scenes.filter((s) => s.meta.chapter === chapterId)
    const last = siblings
      .map((s) => s.meta.order)
      .sort()
      .at(-1)
    // An ID that is already a scene's would overwrite that scene.
    let id = newId('scn')
    for (let tries = 0; this.scenePaths.has(id) && tries < 10; tries++) id = newId('scn')
    if (this.scenePaths.has(id))
      throw new StorageError('other', 'Aurelia could not make a new scene.')
    const meta: Scene = {
      title: siblings.length ? `Untitled scene ${siblings.length + 1}` : 'Untitled scene',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id,
      chapter: chapterId,
      order: keyAfter(last),
    }
    const head = newHead(meta)
    const path = scenePath(universe.id, chapter.book, meta.id)
    this.wrote = true
    this.heads.set(path, head)
    this.scenePaths.set(meta.id, path)
    this.data = { ...this.data, scenes: [...this.data.scenes, { meta, body: '', words: 0 }] }
    this.changed()
    await this.pipeline.edit(path, head)
    await this.pipeline.flush(path)
    return meta.id
  }

  flush(): Promise<void> {
    return this.pipeline.flush()
  }

  // ---- what happens on disk behind our back ----------------------------------------------

  /** Whether the browser still lets us use the files. */
  private async access(): Promise<boolean> {
    const granted = (await this.adapter.access()) === 'granted'
    if (this.permissionLost === granted) {
      this.permissionLost = !granted
      this.changed()
    }
    return granted
  }

  private onError(e: unknown) {
    if (isPermissionError(e) && !this.permissionLost) {
      this.permissionLost = true
      this.changed()
    }
  }

  /** The open scene's file, checked on a timer. Cheap: one file. */
  async checkScene(sceneId: string): Promise<void> {
    const path = this.scenePaths.get(sceneId)
    if (!path || this.checking) return
    try {
      if (!(await this.access())) return
      const disk = await this.adapter.read(path)
      if ((disk?.hash ?? null) === (this.pipeline.known.get(path) ?? null)) return
      if (this.pipeline.isBusy(path)) this.pipeline.markConflict(path, disk)
      else await this.checkAll()
    } catch (e) {
      this.onError(e)
    }
  }

  /** Every file, when the window is focused again. Reloads what changed outside, never what is being typed. */
  async checkAll(): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      if (!(await this.access())) return
      const loaded = await this.loadStable()
      if (!loaded) return // saves kept landing; the next check will see the settled files
      const changed: string[] = []
      const known = this.pipeline.known
      for (const [path, hash] of loaded.hashes)
        if ((known.get(path) ?? null) !== hash) changed.push(path)
      for (const path of known.keys()) if (!loaded.hashes.has(path)) changed.push(path)
      for (const path of changed) {
        if (!this.pipeline.isBusy(path)) continue
        const disk = await this.adapter.read(path).catch(() => null)
        this.pipeline.markConflict(path, disk)
      }
      const others = changed.filter((p) => !this.pipeline.isBusy(p))
      const sameLists =
        key(loaded.copies) === key(this.copies) && key(loaded.problems) === key(this.problems)
      if (!others.length && sameLists) return
      const titles = others.filter((p) => classify(p).kind === 'scene').map((p) => this.titleOf(p))
      this.apply(loaded)
      if (others.length)
        this.addNote(
          'external',
          'Reloaded after a change outside Aurelia',
          titles.length === 1
            ? `“${titles[0]}” was changed by another app or device and had no unsaved edits here.`
            : 'Some files were changed by another app or device and had no unsaved edits here.',
        )
    } catch (e) {
      if (e instanceof OpenError)
        this.addNote('missing', 'The workspace file is missing', wordsFor(e))
      else this.onError(e)
    } finally {
      this.checking = false
    }
  }

  /** Read the files again and show them, keeping every unsaved edit on screen. */
  async refresh(): Promise<void> {
    const loaded = await this.loadStable()
    if (loaded) this.apply(loaded)
  }

  /**
   * Read the workspace, but never hand back a read that a save finished during: it holds the
   * bytes from before the save, and showing it would undo the author's last words. Null after
   * a few tries in a row that were all overtaken by a save.
   */
  private async loadStable(): Promise<LoadedWorkspace | null> {
    for (let tries = 0; tries < 5; tries++) {
      const before = this.pipeline.writes
      const loaded = await loadWorkspace(this.adapter)
      if (this.pipeline.writes === before) return loaded
    }
    return null
  }

  private apply(loaded: LoadedWorkspace) {
    this.pipeline.adopt(loaded.hashes)
    this.newer = loaded.readOnly
    this.heads = loaded.heads
    this.scenePaths = loaded.scenePaths
    this.problems = loaded.problems
    this.copies = loaded.copies
    this.data = this.overlayPending(loaded.data)
    this.changed()
  }

  /** Text that has not reached its file stays on screen, whatever the file now says. */
  private overlayPending(data: WorkspaceData): WorkspaceData {
    for (const [path, text] of this.pipeline.pendingEntries())
      data = this.showText(data, path, text)
    return data
  }

  /** `data` with a scene file's text shown as the scene (and its head kept for the next edit). */
  private showText(data: WorkspaceData, path: string, text: string): WorkspaceData {
    // A copy of a scene carries the scene's ID: shown as the scene, it would replace it.
    if (classify(path).kind !== 'scene' || conflictedCopyOf(path)) return data
    try {
      const { doc, head } = parseSceneFile(text)
      const id = doc.meta.id
      this.heads.set(path, head)
      this.scenePaths.set(id, path)
      return {
        ...data,
        scenes: data.scenes.some((s) => s.meta.id === id)
          ? data.scenes.map((s) => (s.meta.id === id ? doc : s))
          : [...data.scenes, doc],
      }
    } catch {
      // Unreadable text stays in the journal. Typing waits for a re-read of the file, or it
      // would replace the file with the old head's text.
      this.heads.delete(path)
      return data
    }
  }

  /** On startup: tell the author once what was waiting in the journal, and show it. */
  private async recover() {
    const report = await this.pipeline.recover()
    // Words that failed to write are pending: show them, or a keystroke would replace them.
    this.data = this.overlayPending(this.data)
    this.changed()
    if (report.saved.length || report.conflicts.length)
      await this.refresh().catch((e: unknown) => {
        // The files now hold words the screen does not: a key must meet a conflict, not replace them.
        for (const p of report.saved) this.pipeline.expect(p, undefined)
        throw e
      })
    if (report.saved.length)
      this.addNote(
        'recovered',
        'Saved what was still waiting',
        `Aurelia finished saving changes that had not reached their files before it last closed: ${report.saved
          .map((p) => `“${this.titleOf(p)}”`)
          .join(', ')}.`,
      )
    if (report.waiting.length && this.readOnly)
      this.addNote(
        'waiting',
        'Unsaved changes are kept safe',
        'They are stored on this device and will be saved once you can edit this workspace again.',
      )
  }

  /** The author clicked Reconnect: ask the browser again, then save what was waiting. */
  async reconnect(): Promise<boolean> {
    if (!(await this.adapter.requestAccess())) return false
    this.permissionLost = false
    await this.pipeline.reconnect()
    await this.checkAll()
    this.changed()
    return true
  }

  // ---- the author's choices --------------------------------------------------------------

  async resolveConflict(path: string, choice: 'theirs' | 'mine'): Promise<void> {
    const theirs = this.pipeline.conflicts().find((c) => c.path === path)?.theirs
    const copy = await this.pipeline.resolve(path, choice)
    // The conflict is gone from the view now: show the file's text at once, so a key typed
    // before the files are read again is typed on it, not on the text just set aside.
    if (choice === 'theirs' && typeof theirs === 'string' && !this.pipeline.isBusy(path)) {
      this.data = this.showText(this.data, path, theirs)
      this.changed()
    }
    // The choice is made; a failed re-read is not a failed choice.
    await this.refresh().catch((e) => {
      this.onError(e)
      if (!isPermissionError(e))
        this.addNote('refresh-failed', 'Aurelia could not re-read your files', wordsFor(e))
    })
    if (copy)
      this.addNote(
        'conflict-copy',
        'The other version was kept as a copy',
        choice === 'theirs'
          ? `Your version of “${this.titleOf(path)}” is saved as “${copy}”.`
          : `The file’s version of “${this.titleOf(path)}” is saved as “${copy}”.`,
      )
  }

  /**
   * Two versions of one file met. The author picks one; the other goes to `.aurelia/conflicts/`
   * — never deleted. Choosing the copy puts its text in the original's place.
   */
  async reconcileCopy(copyPath: string, keep: 'original' | 'copy'): Promise<void> {
    const copy = this.copies.find((c) => c.path === copyPath)
    if (!copy) return
    const { original } = copy
    if (keep === 'copy') {
      await this.pipeline.flush(original)
      if (this.pipeline.isBusy(original))
        throw new StorageError('other', 'Finish saving the scene first, then try again.')
      const text = await this.adapter.read(copyPath)
      if (!text) return
      const current = await this.adapter.read(original)
      if (current) await this.adapter.write(conflictsPathFor(original), current.text)
      this.pipeline.expect(original, current?.hash)
      await this.pipeline.edit(original, text.text)
      await this.pipeline.flush(original)
      if (this.pipeline.isBusy(original)) return // a new conflict or a failing disk: the copy stays
    }
    await moveFile(this.adapter, copyPath, conflictsPathFor(copyPath))
    await this.refresh()
  }

  // ---- download a copy -------------------------------------------------------------------

  /** Every file in the workspace as a zip, including text not yet saved. */
  async exportZip(): Promise<Blob> {
    await this.flush()
    const pending = this.pipeline.pendingEntries()
    const paths = new Set([...(await this.adapter.list()), ...pending.keys()])
    const root = this.data.workspace.name.replace(/[\\/:*?"<>|]+/g, '-')
    const files = []
    for (const path of paths) {
      const text = pending.get(path)
      const data = text !== undefined ? encode(text) : await this.adapter.readBytes(path)
      if (data) files.push({ path: `${root}/${path}`, data })
    }
    return zipFiles(files)
  }

  dispose() {
    this.stopWaiting.abort()
    this.releaseLock?.()
    this.pipeline.dispose()
    this.listeners.clear()
  }
}
