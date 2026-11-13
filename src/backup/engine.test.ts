// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupRig } from '../../tests/helpers/backup-rig'
import { openDeviceDb } from '@/storage/device-db'
import { BackupStore } from './state'
import { hashText } from '@/storage/hash'
import { IdbJournal } from '@/storage/journal'
import { WorkspaceSession } from '@/storage/session'
import { readZip } from '@/storage/zip'
import type { BackupEngine } from './engine'
import { manifestSchema, type Manifest } from './manifest'

/** A version's name without the short hash of its content: the tests ask when, and why. */
const plain = (name: string | undefined) => name?.replace(/~[0-9a-f]{8}/, '')

const engines: BackupEngine[] = []
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose()
  vi.useRealTimers()
})
const track = (e: BackupEngine) => (engines.push(e), e)

const current = (paths: string[], folder: string) =>
  paths.filter((p) => p.startsWith(`${folder}/current/`)).map((p) => p.slice(folder.length + 9))
const manifestOf = (rig: Awaited<ReturnType<typeof backupRig>>) =>
  manifestSchema.parse(rig.dav.json(`${rig.folder}/backup.json`))

/** The `backup.json` another device would have written. */
const foreign = (revision = 5, workspaceId = 'wsp_x'): Manifest => ({
  schemaVersion: 1,
  workspaceId,
  name: 'My Book',
  deviceId: 'dev_other',
  deviceName: 'Firefox on Windows',
  revision,
  complete: true,
  lastBackup: '2026-11-12T10:00:00.000Z',
  files: {},
})

describe('turning backup on', () => {
  it('backs up the trash too: a deleted chapter is still on the server, and comes back with a restore', async () => {
    const rig = await backupRig()
    await rig.adapter.write('.aurelia/trash/2026-11-12T18-00-00-000Z/manifest.json', '{"files":[]}')
    await rig.adapter.write(
      '.aurelia/trash/2026-11-12T18-00-00-000Z/universes/unv_a/books/bok_a/chapters/chp_a.md',
      'deleted words',
    )
    const engine = track(await rig.open())
    await engine.turnOn()
    expect(current(rig.dav.paths(), rig.folder)).toEqual(
      expect.arrayContaining([
        '.aurelia/trash/2026-11-12T18-00-00-000Z/manifest.json',
        '.aurelia/trash/2026-11-12T18-00-00-000Z/universes/unv_a/books/bok_a/chapters/chp_a.md',
      ]),
    )
  })

  it('copies every file to current/, writes a backup.json that matches, and saves a first version', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()

    const local = await rig.adapter.list()
    expect(current(rig.dav.paths(), rig.folder).sort()).toEqual([...local].sort())
    for (const path of local)
      expect(rig.dav.text(`${rig.folder}/current/${path}`)).toBe(
        (await rig.adapter.read(path))!.text,
      )

    const m = manifestOf(rig)
    expect([m.workspaceId, m.name, m.revision, m.complete, m.deviceName]).toEqual([
      rig.id,
      'My Book',
      1,
      true,
      'Chrome on macOS',
    ])
    expect(Object.keys(m.files).sort()).toEqual([...local].sort())
    for (const [path, f] of Object.entries(m.files)) {
      const file = (await rig.adapter.read(path))!
      expect([f.hash, f.size]).toEqual([file.hash, new TextEncoder().encode(file.text).length])
    }

    const versions = rig.dav.paths(`${rig.folder}/versions/`)
    expect(versions.map(plain)).toEqual([`${rig.folder}/versions/2026-11-12T18-30-00.zip`])
    const zip = readZip(new Uint8Array(rig.dav.files.get(versions[0]!)!.bytes))
    expect(zip.map((z) => z.path).sort()).toEqual(local.map((p) => `My Book/${p}`).sort())
    expect(zip.every((z) => z.crcOk)).toBe(true)

    expect(engine.view()).toMatchObject({
      enabled: true,
      status: 'idle',
      lastBackup: expect.any(Number),
    })
  })

  it('leaves system files out', async () => {
    const rig = await backupRig()
    await rig.adapter.write('.DS_Store', 'junk')
    const engine = track(await rig.open())
    await engine.turnOn()
    expect(rig.dav.paths(`${rig.folder}/current/`).some((p) => p.endsWith('.DS_Store'))).toBe(false)
  })
})

describe('a renamed workspace', () => {
  /** What the workspace's own rename writes: only the name in aurelia.json changes. */
  async function rename(rig: Awaited<ReturnType<typeof backupRig>>, name: string) {
    const main = (await rig.adapter.read('aurelia.json'))!.text
    await rig.adapter.write('aurelia.json', main.replace('"My Book"', JSON.stringify(name)))
    rig.setName(name)
  }

  it('keeps its server folder, uploads the changed aurelia.json and says the new name in backup.json', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()
    expect(engine.view().name).toBe('My Book')
    await rename(rig, 'Renamed Book')
    await engine.run()

    expect(rig.dav.paths().filter((p) => p.endsWith('backup.json'))).toEqual([
      `${rig.folder}/backup.json`,
    ])
    expect(manifestOf(rig)).toMatchObject({ name: 'Renamed Book', revision: 2, complete: true })
    expect(JSON.parse(rig.dav.text(`${rig.folder}/current/aurelia.json`)!).name).toBe(
      'Renamed Book',
    )
    expect(engine.view()).toMatchObject({ name: 'Renamed Book', folder: rig.folder })
  })

  it('remembers the name across a reload (the device database holds it)', async () => {
    const rig = await backupRig()
    const first = track(await rig.open())
    await first.turnOn()
    await rename(rig, 'Renamed Book')
    await first.run()
    first.dispose()
    expect((await rig.open()).view().name).toBe('Renamed Book')
  })
})

describe('what goes up', () => {
  it('only the files whose hash changed — and nothing at all when nothing changed', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()
    rig.dav.log.length = 0

    await engine.backUpNow() // forced: looks at the server, finds nothing to send
    expect(rig.dav.log.filter((l) => l.startsWith('PUT'))).toEqual([])

    rig.dav.log.length = 0
    const path = await rig.scenePath()
    await rig.adapter.write(path, 'A new first line.\n')
    await engine.run()
    expect(rig.dav.log.filter((l) => l.startsWith('PUT') && l.includes('/current/'))).toEqual([
      `PUT ${rig.folder}/current/${path}`,
    ])
    expect(rig.dav.text(`${rig.folder}/current/${path}`)).toBe('A new first line.\n')
    expect(manifestOf(rig).revision).toBe(2)

    rig.dav.log.length = 0
    await engine.run() // a round with no change touches no network
    expect(rig.dav.log).toEqual([])
  })

  it('a file removed locally is removed from current/ and from the manifest', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()
    const path = await rig.scenePath()
    await rig.adapter.remove(path)
    await engine.run()
    expect(rig.dav.text(`${rig.folder}/current/${path}`)).toBeNull()
    expect(Object.keys(manifestOf(rig).files)).not.toContain(path)
  })

  it('lets a pending save reach its file first, then uploads the whole file', async () => {
    const rig = await backupRig()
    const db = openDeviceDb(new IDBFactory())
    const session = await WorkspaceSession.open(rig.adapter, {
      journal: new IdbJournal(() => db),
      debounceMs: 1e9, // the save is held back: the text is typed but not in its file
    })
    const source = { ...rig.source, adapter: session.adapter, flush: () => session.flush() }
    const { BackupEngine } = await import('./engine')
    const engine = track(
      await BackupEngine.open({
        source,
        store: rig.store,
        state: rig.state,
        debounceMs: 5,
        now: () => 1e12,
      }),
    )
    await engine.turnOn()
    const path = await rig.scenePath()
    const sceneId = session.data.scenes[0]!.meta.id
    void session.editScene(sceneId, 'Typed, but not saved yet.')
    expect(session.pipeline.pendingEntries().size).toBe(1)
    await engine.backUpNow()
    expect(session.pipeline.pendingEntries().size).toBe(0)
    expect(rig.dav.text(`${rig.folder}/current/${path}`)).toBe((await rig.adapter.read(path))!.text)
    expect(rig.dav.text(`${rig.folder}/current/${path}`)).toContain('Typed, but not saved yet.')
    session.dispose()
  })

  it('reads no file while a save is still being written (a half-written file is never backed up)', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()
    const hold = () => {
      let land!: () => void
      const gate = new Promise<void>((resolve) => (land = resolve))
      rig.onFlush(() => gate)
      return land
    }
    let land = hold()
    const reads = vi.spyOn(rig.adapter, 'readBytes')
    const path = await rig.scenePath()
    const done = engine.backUpNow()
    await new Promise((r) => setTimeout(r, 20))
    expect(reads).not.toHaveBeenCalled() // waiting for the save
    await rig.adapter.write(path, 'whole file')
    land()
    await done
    expect(rig.dav.text(`${rig.folder}/current/${path}`)).toBe('whole file')
    // …and a version waits for it too.
    reads.mockClear()
    land = hold()
    const version = engine.saveVersion('manual')
    await new Promise((r) => setTimeout(r, 20))
    expect(reads).not.toHaveBeenCalled()
    land()
    await await version
  })

  it('waits while the workspace is read-only or settling, and goes when it is not', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    rig.setBlocked(true)
    await engine.turnOn()
    expect(engine.view().status).toBe('blocked')
    expect(rig.dav.log).toEqual([])
    rig.setBlocked(false)
    rig.notify() // the session lets go: it tells the engine, which backs up after the debounce
    await vi.waitFor(() => expect(engine.view().status).toBe('idle'))
    expect(manifestOf(rig).revision).toBe(1)
  })

  it('backs up about a minute after the last change, and the clock restarts on each change', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const rig = await backupRig()
    const engine = track(await rig.open({ debounceMs: 60_000 }))
    await engine.turnOn()
    const path = `${rig.folder}/current/${await rig.scenePath()}`
    await rig.adapter.write(await rig.scenePath(), 'one')
    rig.notify()
    await vi.advanceTimersByTimeAsync(50_000)
    rig.notify() // still typing
    await vi.advanceTimersByTimeAsync(50_000)
    expect(rig.dav.text(path)).not.toBe('one') // 100 s in, but only 50 s since the last change
    await vi.advanceTimersByTimeAsync(11_000)
    await vi.waitFor(() => expect(rig.dav.text(path)).toBe('one'))
  })

  it('the tab being hidden backs up at once', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open({ debounceMs: 1e9 }))
    await engine.turnOn()
    await rig.adapter.write(await rig.scenePath(), 'last words')
    engine.onHidden()
    const path = `${rig.folder}/current/${await rig.scenePath()}`
    await vi.waitFor(() => expect(rig.dav.text(path)).toBe('last words'))
  })
})

describe('never overwriting another device', () => {
  it('stops and asks when another device owns the folder; nothing is written', async () => {
    const rig = await backupRig()
    rig.dav.seed(`${rig.folder}/backup.json`, JSON.stringify(foreign()))
    rig.dav.seed(`${rig.folder}/current/aurelia.json`, 'THEIRS')
    const before = JSON.stringify([...rig.dav.files].map(([p, f]) => [p, f.etag]))
    const engine = track(await rig.open())
    await engine.turnOn()
    expect(engine.view().status).toBe('ask')
    expect(engine.view().ask).toEqual({
      deviceName: 'Firefox on Windows',
      at: '2026-11-12T10:00:00.000Z',
    })
    expect(JSON.stringify([...rig.dav.files].map(([p, f]) => [p, f.etag]))).toBe(before)
    expect(rig.dav.log.filter((l) => /^(PUT|DELETE|MKCOL)/.test(l))).toEqual([])
  })

  it('a 412 on backup.json means someone wrote meanwhile: re-read, ask, upload nothing', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn() // revision 1 is ours
    await rig.adapter.write(await rig.scenePath(), 'changed here')
    // Between our read of backup.json and our claim, another device writes its own.
    rig.interceptRequests((method, path) => {
      if (method === 'PUT' && path.endsWith('/backup.json')) {
        rig.interceptRequests(undefined)
        rig.dav.tamper(`${rig.folder}/backup.json`, JSON.stringify(foreign(2)))
      }
    })
    await engine.run()
    expect(engine.view().status).toBe('ask')
    expect(rig.dav.json<Manifest>(`${rig.folder}/backup.json`).deviceId).toBe('dev_other')
    expect(rig.dav.text(`${rig.folder}/current/${await rig.scenePath()}`)).not.toBe('changed here')
  })

  it('does not retry blindly while it waits for the author', async () => {
    const rig = await backupRig()
    rig.dav.seed(`${rig.folder}/backup.json`, JSON.stringify(foreign()))
    const engine = track(await rig.open())
    await engine.turnOn()
    rig.dav.log.length = 0
    engine.touch()
    await new Promise((r) => setTimeout(r, 30))
    expect(rig.dav.log).toEqual([])
  })

  it('"Keep both": this device backs up to a folder of its own and the other one is untouched', async () => {
    const rig = await backupRig()
    rig.dav.seed(`${rig.folder}/backup.json`, JSON.stringify(foreign()))
    const theirs = rig.dav.text(`${rig.folder}/backup.json`)
    const engine = track(await rig.open())
    await engine.turnOn()
    await engine.keepBoth()
    const own = `${rig.folder} – Chrome on macOS ${(await rig.state.device()).id.slice(0, 6)}`
    expect(engine.view()).toMatchObject({ status: 'idle', folder: own })
    expect(rig.dav.json<Manifest>(`${own}/backup.json`).deviceId).not.toBe('dev_other')
    expect(current(rig.dav.paths(), own).length).toBeGreaterThan(3)
    expect(rig.dav.text(`${rig.folder}/backup.json`)).toBe(theirs)
    expect(rig.dav.paths(`${rig.folder}/current/`)).toEqual([])
  })

  it('"Use the backup here": saves a version of this copy first, writes nothing else, and stops backing up from here', async () => {
    const rig = await backupRig()
    rig.dav.seed(`${rig.folder}/backup.json`, JSON.stringify(foreign()))
    rig.dav.seed(`${rig.folder}/current/aurelia.json`, '{"theirs":true}')
    const engine = track(await rig.open())
    await engine.turnOn()
    const folder = await engine.useBackupHere()
    expect(folder).toBe(rig.folder)
    const versions = rig.dav.paths(`${rig.folder}/versions/`)
    expect(versions.map(plain)).toEqual([
      `${rig.folder}/versions/2026-11-12T18-30-00_before-use-backup.zip`,
    ])
    const zip = readZip(new Uint8Array(rig.dav.files.get(versions[0]!)!.bytes))
    expect(zip.find((z) => z.path === 'My Book/aurelia.json')?.crcOk).toBe(true) // this browser's copy
    expect(rig.dav.text(`${rig.folder}/current/aurelia.json`)).toBe('{"theirs":true}')
    expect(rig.dav.json<Manifest>(`${rig.folder}/backup.json`).deviceId).toBe('dev_other')
    expect(engine.view().enabled).toBe(false)
  })

  it('"Use the backup here" does not thin out the other device’s versions with this clock', async () => {
    const rig = await backupRig()
    rig.dav.seed(`${rig.folder}/backup.json`, JSON.stringify(foreign()))
    // Three versions in one hour, a month ago: a prune would keep only the newest.
    for (const t of ['10-00-00', '10-20-00', '10-40-00'])
      rig.dav.seed(`${rig.folder}/versions/2026-10-01T${t}.zip`, 'zip')
    const engine = track(await rig.open())
    await engine.turnOn()
    await engine.useBackupHere()
    const names = rig.dav.paths(`${rig.folder}/versions/`).map((p) => plain(p.split('/').at(-1)))
    expect(names).toEqual([
      '2026-10-01T10-00-00.zip',
      '2026-10-01T10-20-00.zip',
      '2026-10-01T10-40-00.zip',
      '2026-11-12T18-30-00_before-use-backup.zip',
    ])
  })

  it('a backup.json it cannot read is never replaced', async () => {
    const rig = await backupRig()
    rig.dav.seed(`${rig.folder}/backup.json`, '{"schemaVersion":99}')
    const engine = track(await rig.open({ retryMs: [1e9] }))
    await engine.turnOn()
    expect(engine.view().status).toBe('failed')
    expect(engine.view().error).toMatch(/newer Aurelia|damaged/)
    expect(rig.dav.text(`${rig.folder}/backup.json`)).toBe('{"schemaVersion":99}')
  })
})

describe('when the server is not there', () => {
  it('a login that ran out pauses the backup, keeps everything, and resumes after signing in', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()
    await rig.adapter.write(await rig.scenePath(), 'written while signed out')
    rig.dav.authorized = false
    await engine.run()
    expect(engine.view()).toMatchObject({ status: 'paused', enabled: true })
    expect(engine.view().error).toMatch(/sign in/i)

    rig.dav.log.length = 0
    rig.notify()
    await new Promise((r) => setTimeout(r, 30))
    expect(rig.dav.log).toEqual([]) // no hammering a server that says no

    rig.dav.authorized = true
    engine.resume()
    await vi.waitFor(() => expect(engine.view().status).toBe('idle'))
    expect(rig.dav.text(`${rig.folder}/current/${await rig.scenePath()}`)).toBe(
      'written while signed out',
    )
  })

  it('a change that arrives while a round is being refused does not set it off again: it waits for the sign-in', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()
    await rig.adapter.write(await rig.scenePath(), 'written while signed out')
    rig.dav.authorized = false
    rig.interceptRequests(() => {
      rig.interceptRequests(undefined)
      rig.notify() // typing goes on during the round: a debounce timer is set
    })
    await engine.run()
    expect(engine.view().status).toBe('paused')
    rig.dav.log.length = 0
    await new Promise((r) => setTimeout(r, 40)) // the timer fires, into a paused engine
    expect(rig.dav.log).toEqual([])
  })

  it('a server that fails is retried with a wait, and nothing is dropped', async () => {
    const rig = await backupRig()
    rig.dav.down = true
    const engine = track(await rig.open({ retryMs: [10, 10, 10] }))
    await engine.turnOn()
    expect(engine.view()).toMatchObject({ status: 'failed' })
    expect(engine.view().error).toMatch(/try again|will try/i)
    rig.dav.down = false
    await vi.waitFor(() => expect(engine.view().status).toBe('idle'), { timeout: 2000 })
    expect(current(rig.dav.paths(), rig.folder).length).toBe((await rig.adapter.list()).length)
  })

  it('what still has to go survives a reload: a new engine finishes the job', async () => {
    const rig = await backupRig()
    rig.dav.down = true
    const first = track(await rig.open({ retryMs: [1e9] }))
    await first.turnOn() // fails: nothing is on the server
    first.dispose() // the tab is closed
    expect(rig.dav.paths()).toEqual([])

    rig.dav.down = false
    track(await rig.open()) // opens with backup on: it catches up on its own
    const all = (await rig.adapter.list()).length
    await vi.waitFor(() => expect(current(rig.dav.paths(), rig.folder)).toHaveLength(all), {
      timeout: 2000,
    })
    await vi.waitFor(() => expect(manifestOf(rig).complete).toBe(true))
  })

  it('a round that died half way is finished by the next one: the manifest is whole only once every file is there', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open({ retryMs: [10] }))
    let puts = 0
    rig.interceptRequests((method, path) => {
      if (method === 'PUT' && path.includes('/current/') && ++puts === 3) rig.dav.down = true
    })
    await engine.turnOn()
    expect(engine.view().status).toBe('failed')
    expect(manifestOf(rig)).toMatchObject({ complete: false, revision: 1 })
    rig.interceptRequests(undefined)
    rig.dav.down = false
    await vi.waitFor(() => expect(engine.view().status).toBe('idle'), { timeout: 2000 })
    const m = manifestOf(rig)
    expect(m.complete).toBe(true)
    for (const [path, f] of Object.entries(m.files))
      expect(await hashText(rig.dav.text(`${rig.folder}/current/${path}`)!)).toBe(f.hash)
  })

  it('the claim is remembered before the first file goes up: a tab killed mid-upload looks again', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    let seen: Promise<{ claimOpen?: boolean }> | undefined
    rig.interceptRequests((method, path) => {
      if (method !== 'PUT' || !path.includes('/current/') || seen) return
      seen = rig.state.load(rig.id) // what a reloaded tab would read, the moment the first file is on its way
      engine.dispose() // the tab dies
    })
    await engine.turnOn()
    expect((await seen)?.claimOpen).toBe(true)
  })

  it('a failure on the very last write of backup.json is closed by the next round, and the owed version is made', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open({ retryMs: [10] }))
    let manifestPuts = 0
    rig.interceptRequests((method, path) => {
      // 1: the claim (its first try, before the folder exists), 2: the claim again, 3: the final write.
      if (method === 'PUT' && path.endsWith('backup.json') && ++manifestPuts === 3)
        rig.dav.down = true
    })
    await engine.turnOn()
    expect(engine.view().status).toBe('failed')
    expect(manifestOf(rig).complete).toBe(false)
    expect(rig.dav.paths(`${rig.folder}/versions/`)).toEqual([])
    rig.interceptRequests(undefined)
    rig.dav.down = false
    await vi.waitFor(() => expect(engine.view().status).toBe('idle'), { timeout: 2000 })
    expect(manifestOf(rig).complete).toBe(true)
    expect(rig.dav.paths(`${rig.folder}/versions/`)).toHaveLength(1)
    // a restart finds nothing owed and nothing open
    expect(await rig.state.load(rig.id)).toMatchObject({ versionDue: null })
  })

  it('a workspace that was wiped from the server is uploaded again in full', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()
    rig.dav.files.clear()
    rig.dav.folders.clear()
    rig.dav.folders.add('')
    await engine.backUpNow()
    expect(current(rig.dav.paths(), rig.folder).length).toBe((await rig.adapter.list()).length)
  })
})

describe('versions', () => {
  it('one an hour while writing, none while idle, one before a big change, and old ones thinned', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    const names = () =>
      rig.dav.paths(`${rig.folder}/versions/`).map((p) => plain(p.split('/').at(-1)))
    await engine.turnOn()
    expect(names()).toEqual(['2026-11-12T18-30-00.zip'])

    rig.advance(20 * 60_000)
    await rig.adapter.write(await rig.scenePath(), 'twenty minutes later')
    await engine.run()
    expect(names()).toHaveLength(1) // under an hour

    rig.advance(60 * 60_000)
    await rig.adapter.write(await rig.scenePath(), 'an hour later')
    await engine.run()
    expect(names()).toEqual(['2026-11-12T18-30-00.zip', '2026-11-12T19-50-00.zip'])

    rig.advance(3 * 60 * 60_000)
    await engine.run() // an idle workspace makes no version
    expect(names()).toHaveLength(2)

    await (
      await engine.saveVersion('before-keep-mine')
    ).uploaded
    expect(names()).toContain('2026-11-12T22-50-00_before-keep-mine.zip')
  })

  it('thins old versions to the retention rhythm after saving one', async () => {
    const rig = await backupRig()
    // Three versions in one hour, a month ago: only the newest of them stays.
    for (const t of ['10-00-00', '10-20-00', '10-40-00'])
      rig.dav.seed(`${rig.folder}/versions/2026-10-01T${t}.zip`, 'zip')
    const engine = track(await rig.open())
    await engine.turnOn()
    const left = rig.dav.paths(`${rig.folder}/versions/`).map((p) => plain(p.split('/').at(-1)))
    expect(left).toEqual(['2026-10-01T10-40-00.zip', '2026-11-12T18-30-00.zip'])
  })

  it('a version before a big change holds the text as it was when asked for, however late it uploads', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()
    const path = await rig.scenePath()
    await rig.adapter.write(path, 'BEFORE the change')
    rig.advance(1000)
    // The server is slow: the change is made while the version is still on its way.
    rig.interceptRequests((method) => {
      if (method !== 'GET') return
      rig.interceptRequests(undefined)
      void rig.adapter.write(path, 'AFTER the change')
    })
    const { uploaded } = await engine.saveVersion('before-keep-mine') // the zip exists now
    await uploaded
    const name = rig.dav
      .paths(`${rig.folder}/versions/`)
      .find((p) => p.includes('before-keep-mine'))!
    const zip = readZip(new Uint8Array(rig.dav.files.get(name)!.bytes))
    const text = new TextDecoder().decode(zip.find((z) => z.path.endsWith(path))!.data)
    expect(text).toBe('BEFORE the change')
  })

  it('a version before a big change asked for while an hourly one is being made is still made, and its upload is waited for', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()
    await rig.adapter.write(await rig.scenePath(), 'edited')
    rig.advance(2 * 60 * 60_000) // an hourly version is due
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let flushes = 0
    rig.onFlush(() => (++flushes === 2 ? gate : Promise.resolve())) // the hourly zip's flush is held
    const hourly = engine.backUpNow()
    await vi.waitFor(() => expect(flushes).toBe(2))
    const { uploaded } = await engine.saveVersion('before-keep-mine') // lands in the middle of it
    release()
    await hourly
    await uploaded
    const names = rig.dav.paths(`${rig.folder}/versions/`).map((p) => p.split('/').at(-1)!)
    expect(names.filter((n) => n.includes('before-keep-mine'))).toHaveLength(1)
    expect(names.some((n) => !n.includes('_') && n > '2026-11-12T20')).toBe(true) // the hourly one too
  })

  it('a version before a big change is not made when backup is off', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.saveVersion('before-use-file')
    expect(rig.dav.log).toEqual([])
  })
})

describe('a second tab and a second device', () => {
  it('a tab that took over reads what the first tab stored, not what it loaded', async () => {
    const rig = await backupRig()
    await rig.state.save({
      ...(await rig.state.load(rig.id)),
      enabled: true,
      folder: rig.folder,
    })
    const first = track(await rig.open({ debounceMs: 1e9 }))
    const second = track(await rig.open({ debounceMs: 1e9 })) // loaded the same blank state
    await first.backUpNow() // everything up, and a version
    expect(rig.dav.paths(`${rig.folder}/versions/`)).toHaveLength(1)
    first.dispose()
    rig.advance(35 * 60_000) // another clock hour, but under an hour since the last version
    await rig.adapter.write(await rig.scenePath(), 'written after the takeover')
    await second.backUpNow() // none owed
    expect(rig.dav.paths(`${rig.folder}/versions/`)).toHaveLength(1)
    expect(rig.dav.text(`${rig.folder}/current/${await rig.scenePath()}`)).toBe(
      'written after the takeover',
    )
  })

  it('two devices with the same name keep their own folders when each keeps both', async () => {
    const rig = await backupRig()
    rig.dav.seed(`${rig.folder}/backup.json`, JSON.stringify(foreign()))
    const otherDb = openDeviceDb(new IDBFactory())
    const other = new BackupStore(
      () => otherDb,
      () => 'Chrome/130 Macintosh; Mac OS X',
    )
    const { BackupEngine } = await import('./engine')
    const a = track(await rig.open())
    const b = track(
      await BackupEngine.open({
        source: rig.source,
        store: rig.store,
        state: other,
        now: () => 1e12,
      }),
    )
    await a.turnOn()
    await b.turnOn()
    await a.keepBoth()
    await b.keepBoth()
    expect(a.view().folder).not.toBe(b.view().folder)
    const owners = [a, b].map(
      (e) => rig.dav.json<Manifest>(`${e.view().folder}/backup.json`).deviceId,
    )
    expect(new Set(owners).size).toBe(2)
    expect(a.view().status).toBe('idle')
    expect(b.view().status).toBe('idle')
  })
})

describe('turning it off', () => {
  it('stops everything, and remembers where it was when turned on again', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    await engine.turnOn()
    await engine.turnOff()
    expect(engine.view().status).toBe('off')
    rig.dav.log.length = 0
    await rig.adapter.write(await rig.scenePath(), 'while off')
    rig.notify()
    await new Promise((r) => setTimeout(r, 30))
    expect(rig.dav.log).toEqual([])
    await engine.turnOn()
    expect(rig.dav.text(`${rig.folder}/current/${await rig.scenePath()}`)).toBe('while off')
  })

  it('opens off for a workspace that never had it on, and talks to no server', async () => {
    const rig = await backupRig()
    const engine = track(await rig.open())
    expect(engine.view()).toMatchObject({ enabled: false, status: 'off', lastBackup: null })
    rig.notify()
    await new Promise((r) => setTimeout(r, 30))
    expect(rig.dav.log).toEqual([])
  })
})
