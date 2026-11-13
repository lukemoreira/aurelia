// SPDX-License-Identifier: AGPL-3.0-or-later
import type { StorageAdapter } from '@/storage/adapter'
import { SYSTEM_FILES } from '@/storage/create'
import { RemoteError, wordsFor } from '@/storage/errors'
import { hashBytes } from '@/storage/hash'
import type { RemoteStore } from '@/storage/remote/remote-store'
import { zipFiles } from '@/storage/zip'
import {
  currentPath,
  folderFor,
  manifestPath,
  parseVersion,
  safeName,
  versionName,
  versionsDir,
} from './layout'
import { manifestBytes, readManifest, type Manifest } from './manifest'
import { versionsToDelete } from './retention'
import type { BackupState, BackupStore, Device } from './state'

/** What the engine needs of an open workspace: its saved files, and when it may not be touched. */
export interface BackupSource {
  id: string
  name: () => string
  /** The saved files. The engine never sees text that has not reached its file. */
  adapter: StorageAdapter
  /** Resolves once every pending save has reached its file: a file is never read half-written. */
  flush: () => Promise<void>
  /** Read-only, or still settling after a tab took over: nothing may be uploaded. */
  blocked: () => boolean
  subscribe: (fn: () => void) => () => void
}

export type BackupStatus = 'off' | 'idle' | 'working' | 'paused' | 'failed' | 'ask' | 'blocked'

export interface BackupView {
  enabled: boolean
  status: BackupStatus
  lastBackup: number | null
  folder: string | null
  /** The name `backup.json` carries now; the folder's own name is the first one the workspace had. */
  name?: string
  /** Plain words for what went wrong, while it has. */
  error: string | null
  /** Another device owns the backup folder: the author chooses (Keep both / Use the backup here). */
  ask: { deviceName: string; at: string } | null
}

export interface EngineDeps {
  source: BackupSource
  store: RemoteStore
  state: BackupStore
  now?: () => number
  debounceMs?: number
  retryMs?: number[]
}

/** About a minute after typing stops. The end-to-end build is quicker so a test need not wait. */
export const BACKUP_DEBOUNCE_MS = import.meta.env.MODE === 'e2e' ? 400 : 60_000
const RETRY_MS = [10_000, 30_000, 120_000, 300_000, 900_000]
const HOUR = 3_600_000

const hashesOf = (files: Manifest['files']) =>
  Object.fromEntries(Object.entries(files).map(([path, f]) => [path, f.hash]))

/** A round that ended without failing: someone else owns the folder, and the author was asked. */
class Stopped extends Error {}

/**
 * Backs one open workspace up to the author's server (ADR-0009 §2). Plain TypeScript: the
 * screens subscribe to it and call it. What still has to go is whatever differs between the
 * saved files and what was last uploaded, kept in the device database — so nothing is
 * dropped by a reload, a failure or a sign-in that ran out. The server's `backup.json` is
 * written with compare-and-write, and claimed before any file goes up, so two devices can
 * never write into one folder.
 */
export class BackupEngine {
  private status: BackupStatus
  private error: string | null = null
  private ask: BackupView['ask'] = null
  private attempt = 0
  private timer?: ReturnType<typeof setTimeout>
  private retryTimer?: ReturnType<typeof setTimeout>
  private running?: Promise<void>
  private listeners = new Set<() => void>()
  private unsubscribe?: () => void
  private disposed = false
  private now: () => number

  private constructor(
    private deps: EngineDeps,
    private s: BackupState,
    private device: Device,
  ) {
    this.now = deps.now ?? Date.now
    this.status = s.enabled ? 'idle' : 'off'
  }

  /** Load what this device remembers; if backup is on, catch up on whatever is outstanding. */
  static async open(deps: EngineDeps): Promise<BackupEngine> {
    const [state, device] = await Promise.all([
      deps.state.load(deps.source.id),
      deps.state.device(),
    ])
    const engine = new BackupEngine(deps, state, device)
    engine.unsubscribe = deps.source.subscribe(() => engine.touch())
    if (state.enabled) engine.touch()
    return engine
  }

  // ---- what the screens read -------------------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  view(): BackupView {
    return {
      enabled: this.s.enabled,
      status: this.status,
      lastBackup: this.s.lastBackup,
      folder: this.s.folder,
      ...(this.s.name ? { name: this.s.name } : {}),
      error: this.error,
      ask: this.ask,
    }
  }

  private set(status: BackupStatus, error: string | null = null) {
    this.status = status
    this.error = error
    if (status !== 'ask') this.ask = null
    if (!this.disposed) for (const fn of this.listeners) fn()
  }

  private persist = () => this.deps.state.save(this.s).catch(() => undefined)

  // ---- when it runs ----------------------------------------------------------------------

  /** The workspace changed: back up about a minute after the last change. */
  touch() {
    if (!this.s.enabled || this.disposed || this.status === 'paused' || this.status === 'ask')
      return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.run(), this.deps.debounceMs ?? BACKUP_DEBOUNCE_MS)
  }

  /** The tab was hidden: go now, as far as the browser lets a hidden tab. */
  onHidden() {
    if (!this.s.enabled || this.status === 'paused' || this.status === 'ask') return
    clearTimeout(this.timer)
    void this.run()
  }

  /** Try again after a sign-in or a failure. */
  resume() {
    if (!this.s.enabled || (this.status !== 'paused' && this.status !== 'failed')) return
    this.attempt = 0
    clearTimeout(this.retryTimer)
    void this.run(true)
  }

  /** One round at a time; a caller that comes while one is under way waits for it, then goes. */
  async run(force = false): Promise<void> {
    while (this.running) await this.running
    this.running = this.round(force)
    try {
      await this.running
    } finally {
      this.running = undefined
    }
  }

  private async round(force: boolean): Promise<void> {
    // Another tab's engine may have written since this one last looked (a tab that took over).
    this.s = await this.deps.state.load(this.deps.source.id).catch(() => this.s)
    if (!this.s.enabled || !this.s.folder || this.disposed) return
    clearTimeout(this.timer)
    // A change that came in while the last round was failing its sign-in, or asking, set a timer: it waits for the author.
    if (!force && (this.status === 'paused' || this.status === 'ask')) return
    if (this.deps.source.blocked()) return this.set('blocked')
    try {
      await this.sync(force)
      this.attempt = 0
      this.set('idle')
    } catch (e) {
      if (!(e instanceof Stopped)) this.fail(e)
    } finally {
      await this.persist()
    }
  }

  private fail(e: unknown) {
    const words = wordsFor(e, 'The backup did not work. Nothing was lost.')
    if (e instanceof RemoteError && e.code === 'unauthorized') return this.set('paused', words)
    this.set('failed', words)
    const delays = this.deps.retryMs ?? RETRY_MS
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(
      () => void this.run(),
      delays[Math.min(this.attempt++, delays.length - 1)],
    )
  }

  // ---- one round -------------------------------------------------------------------------

  /** Every saved file with its hash, read from the disk once pending saves have landed. */
  private async scan() {
    await this.flushed()
    const out = new Map<string, { hash: string; size: number }>()
    for (const path of await this.deps.source.adapter.list()) {
      if (SYSTEM_FILES.has(path.slice(path.lastIndexOf('/') + 1))) continue
      const bytes = await this.deps.source.adapter.readBytes(path)
      if (bytes) out.set(path, { hash: await hashBytes(bytes), size: bytes.length })
    }
    return out
  }

  /** A save that fails is the save pipeline's to report: what is on the disk is still worth a backup. */
  private flushed = () => this.deps.source.flush().catch(() => undefined)

  private async sync(force: boolean): Promise<void> {
    const { source, store } = this.deps
    const s = this.s
    const folder = s.folder!
    const local = await this.scan()
    const same =
      Object.keys(s.uploaded).length === local.size &&
      [...local].every(([path, f]) => s.uploaded[path] === f.hash)
    if (same && !force && !s.versionDue && !s.claimOpen) return // nothing to say, nothing to ask the server
    this.set('working')

    // Read the manifest before anything goes up: another device's folder is never written into.
    const found = await readManifest(store, folder)
    let base: Record<string, string> = {}
    let revision = 0
    let etag: string | null = null
    if (found) {
      if (found.manifest.deviceId !== this.device.id) return this.askAbout(found.manifest)
      // A round that did not finish lists what it meant to upload, not what got there.
      base = found.manifest.complete ? hashesOf(found.manifest.files) : { ...s.uploaded }
      revision = found.manifest.revision
      etag = found.etag
    }
    const put = [...local].filter(([path, f]) => base[path] !== f.hash).map(([path]) => path)
    const gone = Object.keys(base).filter((path) => !local.has(path))
    // A claim of ours that never closed (the final write failed) is closed now, change or not.
    const unclosed = !!found && !found.manifest.complete
    const changes = put.length + gone.length > 0 || unclosed
    const at = this.now()

    if (changes) {
      const files: Manifest['files'] = Object.fromEntries(
        [...local].map(([path, f]) => [path, { hash: f.hash, size: f.size }]),
      )
      const head = {
        schemaVersion: 1 as const,
        workspaceId: source.id,
        name: source.name(),
        deviceId: this.device.id,
        deviceName: this.device.name,
        lastBackup: new Date(at).toISOString(),
      }
      // Claim the folder first: a second device's claim now fails, instead of both uploading.
      const tag = await this.writeManifest(
        folder,
        { ...head, revision: revision + 1, complete: false, files },
        etag,
      )
      s.claimOpen = true // until the closing write lands, so a failure there is found again
      await this.persist() // …even if the tab dies mid-upload
      s.uploaded = { ...base }
      for (const path of put) {
        const bytes = await source.adapter.readBytes(path)
        if (!bytes) {
          delete files[path] // removed since the scan
          continue
        }
        const hash = await hashBytes(bytes)
        files[path] = { hash, size: bytes.length }
        await store.write(currentPath(folder, path), bytes)
        s.uploaded[path] = hash
      }
      for (const path of gone) {
        await store.remove(currentPath(folder, path))
        delete s.uploaded[path]
      }
      await this.writeManifest(
        folder,
        { ...head, revision: revision + 1, complete: true, files },
        tag,
      )
      s.claimOpen = false
      s.name = head.name
      s.revision = revision + 1
      s.uploaded = hashesOf(files)
    } else {
      s.claimOpen = false
      s.revision = revision
      if (found?.manifest.name) s.name = found.manifest.name
      s.uploaded = { ...base }
    }
    s.lastBackup = at

    const due =
      this.owed?.reason ?? // a version asked for meanwhile comes before the hourly one
      s.versionDue ??
      (changes && (s.lastVersion === null || at - s.lastVersion >= HOUR) ? 'hourly' : null)
    if (due) {
      s.versionDue = due // kept until it is saved, so a failure is retried
      await this.makeVersion(due)
    }
  }

  /** Write `backup.json` against the tag we read. A 412 means someone else wrote: look, then ask. */
  private async writeManifest(folder: string, m: Manifest, etag: string | null) {
    const path = manifestPath(folder)
    try {
      const tag = await this.deps.store.write(
        path,
        manifestBytes(m),
        etag ? { ifMatch: etag } : { ifNoneMatch: '*' },
      )
      return tag ?? (await this.deps.store.read(path))?.etag ?? null
    } catch (e) {
      if (!(e instanceof RemoteError) || e.code !== 'precondition') throw e
      const now = await readManifest(this.deps.store, folder).catch(() => null)
      if (now && now.manifest.deviceId !== this.device.id) return this.askAbout(now.manifest)
      throw e
    }
  }

  private askAbout(m: Manifest): never {
    this.ask = { deviceName: m.deviceName, at: m.lastBackup }
    this.set('ask')
    throw new Stopped()
  }

  // ---- versions --------------------------------------------------------------------------

  /** A zip of every saved file as it is right now (local, so quick). */
  private async buildZip(): Promise<{ zip: Uint8Array<ArrayBuffer>; at: Date }> {
    const { source } = this.deps
    await this.flushed()
    const at = new Date(this.now())
    const root = safeName(source.name())
    const files = []
    for (const path of await source.adapter.list()) {
      if (SYSTEM_FILES.has(path.slice(path.lastIndexOf('/') + 1))) continue
      const data = await source.adapter.readBytes(path)
      if (data) files.push({ path: `${root}/${path}`, data })
    }
    return { zip: new Uint8Array(await zipFiles(files, at).arrayBuffer()), at }
  }

  /** A version already zipped, waiting for its upload: it holds the text as it was when asked for. */
  private owed?: { reason: string; zip: Uint8Array<ArrayBuffer>; at: Date }

  /** A zip of every saved file, kept in `versions/`; then the old ones are thinned out (unless the folder is another device's). */
  private async makeVersion(reason: string, prune = true): Promise<void> {
    const { store } = this.deps
    const folder = this.s.folder!
    const ready = this.owed?.reason === reason ? this.owed : undefined
    const { zip, at } = ready ?? (await this.buildZip())
    await store
      .write(`${versionsDir(folder)}/${versionName(at, reason)}`, zip, { ifNoneMatch: '*' })
      .catch((e) => {
        // Two in the same second: the first one is the version.
        if (!(e instanceof RemoteError) || e.code !== 'precondition') throw e
      })
    if (ready && this.owed === ready) this.owed = undefined // kept until it is on the server
    this.s.lastVersion = at.getTime()
    if (this.s.versionDue === reason) this.s.versionDue = null // a newer ask stays due
    if (prune) await this.prune(folder, at)
  }

  /** Space only: a failure here never fails a backup. */
  private async prune(folder: string, now: Date) {
    try {
      const entries = await this.deps.store.list(versionsDir(folder))
      const stamps = entries.flatMap((e) => {
        const v = parseVersion(e.name)
        return v ? [{ name: e.name, at: v.at, protectedFor30Days: !!v.reason }] : []
      })
      for (const name of versionsToDelete(stamps, now))
        await this.deps.store.remove(`${versionsDir(folder)}/${name}`)
    } catch {
      // The next version tries again.
    }
  }

  /**
   * A version before a big change (the conflict choices). The zip is built first (local, quick),
   * so it holds the text as it is NOW; `uploaded` waits for the upload, which the caller may stop
   * waiting for. Never blocks the author: a failure only means no version.
   */
  async saveVersion(reason: string): Promise<{ uploaded: Promise<void> }> {
    if (!this.s.enabled || this.status === 'paused' || this.status === 'ask')
      return { uploaded: Promise.resolve() }
    this.owed = { reason, ...(await this.buildZip()) }
    this.s.versionDue = reason
    await this.persist()
    return { uploaded: this.run(true) }
  }

  // ---- the author's choices --------------------------------------------------------------

  async turnOn(): Promise<void> {
    this.s.enabled = true
    this.s.folder ??= folderFor(this.deps.source.id, this.deps.source.name())
    this.set('idle')
    await this.persist()
    await this.run(true)
  }

  async turnOff(): Promise<void> {
    this.s.enabled = false
    clearTimeout(this.timer)
    clearTimeout(this.retryTimer)
    this.set('off')
    await this.persist()
  }

  backUpNow = () => this.run(true)

  /** "Keep both": this device backs up to a folder of its own, beside the other device's. */
  async keepBoth(): Promise<void> {
    const { source } = this.deps
    this.s.folder = folderFor(source.id, source.name(), this.device)
    this.s.revision = 0
    this.s.uploaded = {}
    this.s.claimOpen = false
    this.set('idle')
    await this.persist()
    await this.run(true)
  }

  /**
   * "Use the backup here": this browser's copy goes into `versions/` first, so it is not lost,
   * and backing up from here stops. Returns the folder to restore (always as a new local copy).
   */
  async useBackupHere(): Promise<string> {
    const folder = this.s.folder!
    await this.makeVersion('before-use-backup', false) // the other device's versions are its own to thin out
    this.s.enabled = false
    clearTimeout(this.timer)
    this.set('off')
    await this.persist()
    return folder
  }

  dispose() {
    this.disposed = true
    this.unsubscribe?.()
    clearTimeout(this.timer)
    clearTimeout(this.retryTimer)
    this.listeners.clear()
  }
}
