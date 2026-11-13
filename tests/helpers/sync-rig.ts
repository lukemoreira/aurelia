// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { newId } from '@/domain/ids'
import { BackupEngine, type BackupSource } from '@/backup/engine'
import { fetchBackup, joinSync } from '@/backup/restore'
import { BackupStore } from '@/backup/state'
import { createWorkspace } from '@/storage/create'
import { openDeviceDb } from '@/storage/device-db'
import { IdbJournal } from '@/storage/journal'
import { WebDavStore } from '@/storage/remote/webdav-store'
import { regenerateOutlines } from '@/storage/outline-actions'
import { WorkspaceSession } from '@/storage/session'
import { FakeDav, davFetch } from './fake-dav'
import { MemoryAdapter } from './memory-adapter'

/** One device: its own files, session, device database and sync engine, talking to a shared fake server. */
export class SimDevice {
  online = true
  /** The session is read-only (another tab holds it): no round may run. */
  blocked = false
  /** Called before each request this device sends: a test can step in, as another device would. */
  beforeRequest?: (method: string, path: string) => void | Promise<void>
  constructor(
    readonly name: string,
    readonly adapter: MemoryAdapter,
    readonly session: WorkspaceSession,
    readonly engine: BackupEngine,
    readonly state: BackupStore,
  ) {}

  /** The scene files this device has, by path. */
  scenePaths = async () =>
    (await this.adapter.list()).filter((p) => /\/scenes\/scn_\w+\.md$/.test(p)).sort()

  /** One sync round, as the engine runs it (flush first, then compare, push, pull). */
  round = () => this.engine.run(true)

  /** Everything on disk: path → text. */
  async files(): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (const p of (await this.adapter.list()).sort())
      out.set(p, (await this.adapter.read(p))!.text)
    return out
  }
}

export interface SyncWorld {
  dav: FakeDav
  id: string
  folder: string
  devices: SimDevice[]
  /** What each device sent and applied, in order: for the message of a failing test. */
  trace: string[]
  /** A new device that restores the latest copy from the server and keeps it in sync. */
  join: (name?: string) => Promise<SimDevice>
  advance: (ms: number) => void
  dispose: () => void
}

/**
 * A workspace synced between devices: the first creates it and turns sync on; each `join` restores the latest
 * copy from the server (the same steps as "Restore … and keep it in sync") and starts syncing.
 */
export async function syncWorld(
  first = 'Chrome on macOS',
  opts: {
    sync?: boolean
    /** Milliseconds each request of any device waits first, so rounds on different devices overlap. */
    jitter?: () => number
  } = {},
): Promise<SyncWorld> {
  const dav = new FakeDav()
  const id = newId('wsp')
  const folder = `Aurelia/My Book (${id})`
  let clock = Date.UTC(2026, 10, 12, 18, 30, 0)
  const devices: SimDevice[] = []
  const trace: string[] = []

  const deviceDb = (name: string) => {
    const db = openDeviceDb(new IDBFactory())
    const agent = /Safari/.test(name)
      ? 'Safari/17 iPhone'
      : /Firefox/.test(name)
        ? 'Firefox/130 Windows'
        : 'Chrome/130 Mac OS X'
    return {
      db,
      state: new BackupStore(
        () => db,
        () => agent,
      ),
    }
  }

  async function start(
    name: string,
    adapter: MemoryAdapter,
    own = deviceDb(name),
  ): Promise<SimDevice> {
    const { db, state } = own
    const journal = new IdbJournal(() => db)
    const session = await WorkspaceSession.open(adapter, { journal, debounceMs: 1e9 })
    const fetchImpl = davFetch(dav)
    const store = new WebDavStore('/dav/', async (input, init) => {
      if (!device.online) throw new TypeError('offline')
      const wait = opts.jitter?.() ?? 0
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      else if (opts.jitter) await Promise.resolve()
      await device.beforeRequest?.(
        init?.method ?? 'GET',
        decodeURIComponent(new URL(input, 'http://app.test').pathname).replace(/^\/dav\//, ''),
      )
      const res = await fetchImpl(input, init)
      trace.push(
        `${name} ${init?.method ?? 'GET'} ${new URL(input, 'http://app.test').pathname.slice(5)} -> ${res.status}`,
      )
      return res
    })
    const source: BackupSource = {
      id,
      name: () => session.data.workspace.name,
      adapter: session.adapter,
      flush: () => session.flush(),
      blocked: () => device.blocked || session.view().readOnly,
      subscribe: (fn) => session.subscribe(fn),
      regenerate: () => regenerateOutlines(session),
      apply: async (changes) => {
        const done = await session.applyRemote(changes)
        for (const c of changes)
          trace.push(
            `${name} apply ${c.text === null ? 'REMOVE' : 'WRITE'} ${c.path} -> ${done.get(c.path)}`,
          )
        return done
      },
    }
    const engine = await BackupEngine.open({
      source,
      store,
      state,
      now: () => clock,
      debounceMs: 1e9, // rounds are asked for by the test, never by a timer
      retryMs: [1e9],
    })
    const device: SimDevice = new SimDevice(name, adapter, session, engine, state)
    devices.push(device)
    return device
  }

  const adapter = new MemoryAdapter()
  await createWorkspace(adapter, 'My Book', id)
  const founder = await start(first, adapter)
  if (opts.sync !== false) await founder.engine.turnOnSync()

  return {
    dav,
    id,
    folder,
    devices,
    trace,
    advance: (ms) => (clock += ms),
    async join(name = `Device ${devices.length + 1}`) {
      const fetched = await fetchBackup(new WebDavStore('/dav/', davFetch(dav)), folder, 'current')
      if (fetched.problems.length)
        throw new Error(`restore problems: ${JSON.stringify(fetched.problems)}`)
      const adapter = new MemoryAdapter()
      for (const [path, bytes] of fetched.files) adapter.putBytes(path, bytes)
      const own = deviceDb(name)
      await joinSync(own.state, id, folder, fetched)
      const device = await start(name, adapter, own)
      await device.round() // the first round: it joins the folder's list
      return device
    },
    dispose: () => devices.forEach((d) => (d.session.dispose(), d.engine.dispose())),
  }
}
