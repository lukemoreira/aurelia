// SPDX-License-Identifier: AGPL-3.0-or-later
import type { StorageAdapter } from './adapter'
import { StorageError, toStorageError } from './errors'
import { hashText } from './hash'
import type { Journal, JournalEntry } from './journal'
import { copyPathFor } from './paths'

type FileStatus = 'idle' | 'queued' | 'saving' | 'failed' | 'conflict' | 'blocked'

/** What the status bar says, from the worst state any file is in. */
export type SaveKind = 'saved' | 'saving' | 'failed' | 'conflict' | 'blocked'
export interface SaveSummary {
  kind: SaveKind
  /** Why, for a failure. */
  message?: string
}

/** The author's text and the file's text, side by side. Nothing is written until the author chooses. */
export interface Conflict {
  path: string
  mine: string
  /** What is in the file now; null when the file was removed. */
  theirs: string | null
}

export interface RecoverReport {
  /** Edits left over from last time that are now saved. */
  saved: string[]
  /** Edits whose file changed meanwhile: both texts are kept for the author to choose. */
  conflicts: string[]
  /** Edits kept in the journal until a write is possible again (read-only, no permission, a failing disk). */
  waiting: string[]
}

interface FileState {
  status: FileStatus
  /** The newest unsaved text. */
  pending?: string
  theirs?: { text: string | null; hash: string | null }
  error?: string
  timer?: ReturnType<typeof setTimeout>
  firstQueuedAt?: number
  attempt: number
  /** One save at a time per file. */
  saving: Promise<unknown>
  /** Journal writes for this file, in the order they were asked for. */
  journal: Promise<unknown>
  putQueued: boolean
  journalFailed: boolean
}

export interface PipelineDeps {
  adapter: StorageAdapter
  journal: Journal
  workspaceId: string
  /** True for a workspace from a newer Aurelia: no write of any kind (ADR-0003 rule 5). */
  isReadOnly: () => boolean
  notify: () => void
  debounceMs?: number
  /** Typing without a pause still reaches the disk this often. */
  maxWaitMs?: number
  backoffMs?: number[]
}

/**
 * Every write to a workspace file goes through here. The rules, in order:
 *  1. The new text goes into the recovery journal BEFORE anything touches the file.
 *  2. Before writing, the file on disk is read and hashed. If it is not what we last read,
 *     nothing is written and the author is asked (compare-and-write).
 *  3. The journal entry is removed only after the write is confirmed.
 */
export class SavePipeline {
  /** The hash each file had when we last read or wrote it. Absent = the file did not exist. */
  readonly known = new Map<string, string>()
  /**
   * How many writes have been confirmed. A read of the whole workspace that started before
   * one finished is stale: the caller reads this before and after, and reads again if it moved.
   */
  writes = 0
  /** The journal could not even be listed (no IndexedDB): its old entries are untouched, unread. */
  private journalDown = false
  /** Files an action is moving away: words typed into them wait here, and are never written to the old place. */
  private held = new Set<string>()
  private files = new Map<string, FileState>()
  private debounceMs: number
  private maxWaitMs: number
  private backoffMs: number[]

  constructor(private deps: PipelineDeps) {
    this.debounceMs = deps.debounceMs ?? 1000
    this.maxWaitMs = deps.maxWaitMs ?? 5000
    this.backoffMs = deps.backoffMs ?? [2000, 5000, 10000, 30000]
  }

  private state(path: string): FileState {
    let s = this.files.get(path)
    if (!s) {
      s = {
        status: 'idle',
        attempt: 0,
        saving: Promise.resolve(),
        journal: Promise.resolve(),
        putQueued: false,
        journalFailed: false,
      }
      this.files.set(path, s)
    }
    return s
  }

  /** Take a new text for a file. Resolves once it is in the journal. */
  async edit(path: string, text: string): Promise<void> {
    if (this.deps.isReadOnly())
      throw new StorageError('read-only', 'This workspace is read-only, so nothing was changed.')
    const s = this.state(path)
    s.pending = text
    if (s.status === 'idle' || s.status === 'queued' || s.status === 'failed') {
      s.status = 'queued'
      this.schedule(path, s)
    }
    this.deps.notify()
    await this.journalPut(path, s)
  }

  /** Save now: one file, or every file with unsaved text (when a tab is hidden or the page closes). */
  async flush(path?: string): Promise<void> {
    if (path !== undefined) {
      const s = this.state(path)
      s.saving = s.saving.then(() => this.save(path, s))
      await s.saving
      return
    }
    const waiting = [...this.files].filter(
      ([, s]) => s.pending !== undefined && s.status !== 'conflict' && s.status !== 'blocked',
    )
    await Promise.all(waiting.map(([p]) => this.flush(p)))
  }

  private async save(path: string, s: FileState): Promise<void> {
    if (this.held.has(path)) return
    if (this.deps.isReadOnly() || s.pending === undefined || s.status === 'conflict') return
    clearTimeout(s.timer)
    const content = s.pending
    await s.journal // the journal has the text before the file is touched
    s.status = 'saving'
    this.deps.notify()
    try {
      const disk = await this.deps.adapter.read(path)
      const diskHash = disk?.hash ?? null
      if (diskHash !== (this.known.get(path) ?? null)) {
        s.status = 'conflict'
        s.theirs = { text: disk?.text ?? null, hash: diskHash }
        return
      }
      await this.deps.adapter.write(path, content)
      this.writes++
      this.known.set(path, await hashText(content))
      s.attempt = 0
      s.error = undefined
      s.firstQueuedAt = undefined
      if (s.pending === content) {
        s.pending = undefined
        s.status = 'idle'
        void this.journalClear(path, s)
      } else {
        // More was typed during the write: the journal's base is now this file.
        s.status = 'queued'
        void this.journalPut(path, s)
        this.schedule(path, s)
      }
    } catch (e) {
      this.fail(path, s, toStorageError(e, path))
    } finally {
      this.deps.notify()
    }
  }

  private fail(path: string, s: FileState, e: StorageError) {
    s.error = e.message
    if (e.code === 'permission' || e.code === 'read-only') {
      s.status = 'blocked'
      return
    }
    s.status = 'failed'
    const wait = this.backoffMs[Math.min(s.attempt, this.backoffMs.length - 1)]!
    s.attempt++
    clearTimeout(s.timer)
    s.timer = setTimeout(() => void this.flush(path), wait)
  }

  private schedule(path: string, s: FileState) {
    clearTimeout(s.timer)
    const now = Date.now()
    s.firstQueuedAt ??= now
    const wait = Math.max(0, Math.min(this.debounceMs, s.firstQueuedAt + this.maxWaitMs - now))
    s.timer = setTimeout(() => void this.flush(path), wait)
  }

  private enqueueJournal(s: FileState, op: () => Promise<void>) {
    return (s.journal = s.journal.then(op))
  }

  /** Write the newest text. Several asks while one is waiting become one write of the latest. */
  private journalPut(path: string, s: FileState) {
    if (s.putQueued) return s.journal
    s.putQueued = true
    return this.enqueueJournal(s, async () => {
      s.putQueued = false
      if (s.pending === undefined) return
      try {
        await this.deps.journal.put({
          workspaceId: this.deps.workspaceId,
          path,
          content: s.pending,
          baseHash: this.known.get(path) ?? null,
          time: Date.now(),
        })
        s.journalFailed = false
        this.journalDown = false
      } catch {
        // No journal (private window, full disk): the write below still happens.
        s.journalFailed = true
      }
    })
  }

  /** Drop the entry, unless more was typed since (that edit has its own entry coming). */
  private journalClear(path: string, s: FileState) {
    return this.enqueueJournal(s, async () => {
      if (s.pending !== undefined) return
      await this.deps.journal.remove(this.deps.workspaceId, path).catch(() => undefined)
    })
  }

  /** Whether the journal could not keep a copy of the newest text. */
  get journalFailed() {
    return this.journalDown || [...this.files.values()].some((s) => s.journalFailed)
  }

  summary(): SaveSummary {
    const all = [...this.files.values()]
    const find = (status: FileStatus) => all.find((s) => s.status === status)
    if (find('conflict')) return { kind: 'conflict' }
    if (find('blocked')) return { kind: 'blocked', message: find('blocked')!.error }
    if (find('failed')) return { kind: 'failed', message: find('failed')!.error }
    if (find('saving') || find('queued')) return { kind: 'saving' }
    return { kind: 'saved' }
  }

  conflicts(): Conflict[] {
    return [...this.files].flatMap(([path, s]) =>
      s.status === 'conflict' && s.pending !== undefined && s.theirs
        ? [{ path, mine: s.pending, theirs: s.theirs.text }]
        : [],
    )
  }

  /** From now on nothing is written to these paths (words typed meanwhile are kept) until `release`. */
  hold(paths: string[]) {
    for (const p of paths) this.held.add(p)
  }

  release(paths: string[]) {
    for (const p of paths) this.held.delete(p)
  }

  /** The words waiting for this file have been put somewhere safe: forget them, and the file. */
  discard(path: string) {
    const s = this.files.get(path)
    this.known.delete(path)
    if (!s) return
    clearTimeout(s.timer)
    s.pending = undefined
    s.status = 'idle'
    s.theirs = undefined
    s.error = undefined
    s.attempt = 0
    s.firstQueuedAt = undefined
    void this.journalClear(path, s)
    this.deps.notify()
  }

  /** The newest text a file has not saved yet, if any. */
  pendingText(path: string): string | undefined {
    return this.files.get(path)?.pending
  }

  /** Paths with text the file does not have yet, and that text. */
  pendingEntries(): Map<string, string> {
    return new Map(
      [...this.files].flatMap(([p, s]) =>
        s.pending !== undefined ? [[p, s.pending] as const] : [],
      ),
    )
  }

  /** The file changed under unsaved edits: ask the author. Never while a write is in flight. */
  markConflict(path: string, disk: { text: string; hash: string } | null) {
    const s = this.files.get(path)
    if (!s || s.pending === undefined || s.status === 'saving' || s.status === 'conflict') return
    clearTimeout(s.timer)
    s.status = 'conflict'
    s.theirs = { text: disk?.text ?? null, hash: disk?.hash ?? null }
    this.deps.notify()
  }

  /** Whether a file has text that is not saved yet, or is being saved. */
  isBusy(path: string): boolean {
    const s = this.files.get(path)
    return !!s && (s.pending !== undefined || s.status === 'saving')
  }

  /** The files on disk were read again: expect these hashes, except where edits are waiting. */
  adopt(hashes: Map<string, string>) {
    for (const path of [...this.known.keys()])
      if (!hashes.has(path) && !this.isBusy(path)) this.known.delete(path)
    for (const [path, hash] of hashes) if (!this.isBusy(path)) this.known.set(path, hash)
  }

  /** The caller just read this file: expect this hash (or none, for a file that is not there). */
  expect(path: string, hash: string | undefined) {
    if (hash) this.known.set(path, hash)
    else this.known.delete(path)
  }

  /**
   * Keep a text as a copy next to its file: `scn_x (Aurelia copy).md`. The text is in the
   * journal until the copy is written. Returns the copy's path.
   */
  async saveCopy(path: string, text: string): Promise<string> {
    let n = 1
    while (await this.deps.adapter.readBytes(copyPathFor(path, n))) n++
    const target = copyPathFor(path, n)
    const entry = {
      workspaceId: this.deps.workspaceId,
      path: target,
      content: text,
      baseHash: null,
    }
    await this.deps.journal.put({ ...entry, time: Date.now() }).catch(() => undefined)
    await this.deps.adapter.write(target, text)
    this.writes++
    await this.deps.journal.remove(this.deps.workspaceId, target).catch(() => undefined)
    return target
  }

  /**
   * The author's choice in a conflict. Neither side is lost: the version not chosen is first
   * written as a copy next to the file.
   *  - theirs: the file stays as it is; the author's text becomes the copy.
   *  - mine: the file's text becomes the copy; the author's text is written (compare-and-write
   *    again, so a file that changed once more is a new conflict).
   * Returns the copy's path.
   */
  async resolve(path: string, choice: 'theirs' | 'mine'): Promise<string | undefined> {
    const s = this.files.get(path)
    if (!s || s.status !== 'conflict' || s.pending === undefined) return undefined
    let copy: string | undefined
    if (choice === 'theirs') {
      const text = s.pending
      copy = await this.saveCopy(path, text)
      // More was typed while the copy was being written: that text is not in the copy, so the
      // conflict stands, now holding the newer text.
      if (s.pending !== text) return copy
      s.pending = undefined
      s.status = 'idle'
      s.firstQueuedAt = undefined
      this.expect(path, s.theirs?.hash ?? undefined)
      s.theirs = undefined
      void this.journalClear(path, s)
      this.deps.notify()
    } else {
      const disk = await this.deps.adapter.read(path)
      if (disk) copy = await this.saveCopy(path, disk.text)
      this.expect(path, disk?.hash)
      s.theirs = undefined
      s.status = 'queued'
      this.deps.notify()
      await this.flush(path)
    }
    return copy
  }

  /** Access is back: try the edits that were waiting for it. */
  async reconnect(): Promise<void> {
    const blocked = [...this.files].filter(([, s]) => s.status === 'blocked')
    for (const [, s] of blocked) s.status = s.pending === undefined ? 'idle' : 'queued'
    await Promise.all(blocked.map(([path]) => this.flush(path)))
  }

  /**
   * On startup: finish or surface every edit the journal still holds. An entry is only ever
   * removed once its text is on disk or the author has chosen.
   */
  async recover(): Promise<RecoverReport> {
    const report: RecoverReport = { saved: [], conflicts: [], waiting: [] }
    let entries: JournalEntry[] = []
    try {
      entries = await this.deps.journal.list(this.deps.workspaceId)
    } catch {
      // No IndexedDB (a private window, a blocked profile): open anyway. Nothing is dropped.
      this.journalDown = true
    }
    for (const entry of entries) {
      const { path } = entry
      const s = this.state(path)
      try {
        const disk = await this.deps.adapter.read(path)
        const diskHash = disk?.hash ?? null
        if (diskHash !== null && diskHash === (await hashText(entry.content))) {
          await this.deps.journal.remove(this.deps.workspaceId, path) // it did get written
          continue
        }
        s.pending = entry.content
        if (this.deps.isReadOnly()) {
          s.status = 'idle'
          report.waiting.push(path)
        } else if (diskHash === entry.baseHash) {
          this.expect(path, diskHash ?? undefined)
          s.status = 'queued'
          await this.flush(path)
          ;((s.status as FileStatus) === 'idle' ? report.saved : report.waiting).push(path)
        } else {
          s.status = 'conflict'
          s.theirs = { text: disk?.text ?? null, hash: diskHash }
          report.conflicts.push(path)
        }
      } catch (e) {
        s.pending = entry.content
        const err = toStorageError(e, path)
        s.status = err.code === 'permission' ? 'blocked' : 'failed'
        s.error = err.message
        report.waiting.push(path)
      }
    }
    this.deps.notify()
    return report
  }

  dispose() {
    for (const s of this.files.values()) clearTimeout(s.timer)
  }
}
