// SPDX-License-Identifier: AGPL-3.0-or-later
// Images and a server's limits: one file the server refuses never stops the rest, a version holds no
// images, and a version the server will not keep never blocks a pull for ever.
import { afterEach, describe, expect, it } from 'vitest'
import { backupRig } from '../../tests/helpers/backup-rig'
import { davFetch } from '../../tests/helpers/fake-dav'
import { readZip } from '../../tests/helpers/read-zip'
import { syncWorld, type SyncWorld } from '../../tests/helpers/sync-rig'
import { WebDavStore } from '@/storage/remote/webdav-store'
import { fetchBackup, listVersions } from './restore'

const IMAGE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x80, 0x00,
]) as Uint8Array<ArrayBuffer>
const BIG = new Uint8Array(30000).fill(7) as Uint8Array<ArrayBuffer>
let world: SyncWorld
afterEach(() => world?.dispose())

const mediaDir = (universe: string) => `universes/${universe}/media`
const sidecar = (id: string, file: string, name: string) =>
  `${JSON.stringify({ schemaVersion: 1, id, file, name })}\n`
const universeOf = async (adapter: { list(): Promise<string[]> }) =>
  (await adapter.list()).find((p) => p.endsWith('/universe.md'))!.split('/')[1]!

describe('an image the server refuses (413) is left out and named, and nothing else waits for it', () => {
  it('backup: the other files and the manifest still go up, and the screen is told which file', async () => {
    const rig = await backupRig({ workspaceName: 'My Book' })
    const dir = mediaDir(await universeOf(rig.adapter))
    await rig.adapter.writeBytes(`${dir}/med_0000000001.png`, BIG)
    await rig.adapter.write(
      `${dir}/med_0000000001.json`,
      sidecar('med_0000000001', 'med_0000000001.png', 'The big map.png'),
    )
    await rig.adapter.writeBytes(`${dir}/med_0000000002.png`, IMAGE)
    await rig.adapter.write(
      `${dir}/med_0000000002.json`,
      sidecar('med_0000000002', 'med_0000000002.png', 'small.png'),
    )
    rig.dav.limit = 20000
    const engine = await rig.open()
    await engine.turnOn()
    expect(engine.view().status).toBe('idle')
    expect(engine.view().skipped).toEqual(['The big map.png'])
    const on = rig.dav.paths(`${rig.folder}/current/`)
    expect(on.some((p) => p.endsWith('med_0000000002.png'))).toBe(true)
    expect(on.some((p) => p.endsWith('med_0000000001.json'))).toBe(true)
    expect(on.some((p) => p.endsWith('med_0000000001.png'))).toBe(false)
    const manifest = rig.dav.json<{ complete: boolean; files: Record<string, unknown> }>(
      `${rig.folder}/backup.json`,
    )
    expect(manifest.complete).toBe(true)
    expect(Object.keys(manifest.files).some((p) => p.endsWith('med_0000000001.png'))).toBe(false)
    // and a later change still goes up
    const scene = await rig.scenePath()
    await rig.adapter.write(scene, '---\ntitle: "x"\n---\nnew words\n')
    await engine.run(true)
    expect(rig.dav.text(`${rig.folder}/current/${scene}`)).toContain('new words')
    engine.dispose()
  })

  it('sync: the scene one device wrote still reaches the other, and the big image is named, not fatal', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    world.dav.limit = 20000
    const dir = mediaDir(a.session.data.universes[0]!.id)
    await a.adapter.writeBytes(`${dir}/med_0000000001.png`, BIG)
    await a.adapter.write(
      `${dir}/med_0000000001.json`,
      sidecar('med_0000000001', 'med_0000000001.png', 'The big map.png'),
    )
    await a.session.editScene(a.session.data.scenes[0]!.meta.id, 'Words that must arrive.')
    await a.session.flush()
    await a.round()
    expect(a.engine.view().status).toBe('idle')
    expect(a.engine.view().skipped).toEqual(['The big map.png'])
    await b.round()
    expect(b.session.data.scenes[0]!.body).toBe('Words that must arrive.')
    expect(await b.adapter.readBytes(`${dir}/med_0000000001.png`)).toBeNull()
  })
})

describe('versions hold no images', () => {
  it('the zip is the small files only, and restoring a version brings the images back from current/', async () => {
    const rig = await backupRig({ workspaceName: 'My Book' })
    const dir = mediaDir(await universeOf(rig.adapter))
    await rig.adapter.writeBytes(`${dir}/med_0000000001.png`, IMAGE)
    await rig.adapter.write(
      `${dir}/med_0000000001.json`,
      sidecar('med_0000000001', 'med_0000000001.png', 'map.png'),
    )
    const engine = await rig.open()
    await engine.turnOn()
    engine.dispose()
    const store = new WebDavStore('/dav/', davFetch(rig.dav))
    const [version] = await listVersions(store, rig.folder)
    const zip = readZip(rig.dav.bytes(`${rig.folder}/versions/${version!.name}`)!)
    expect(zip.some((e) => e.path.endsWith('med_0000000001.json'))).toBe(true)
    expect(zip.some((e) => e.path.endsWith('.png'))).toBe(false)

    const fetched = await fetchBackup(store, rig.folder, version!.name)
    expect(fetched.problems).toEqual([])
    expect([...fetched.files.get(`${dir}/med_0000000001.png`)!]).toEqual([...IMAGE])
    // an image no longer on the server (its trash was emptied) is left out; the rest still restores
    rig.dav.files.delete(`${rig.folder}/current/${dir}/med_0000000001.png`)
    const without = await fetchBackup(store, rig.folder, version!.name)
    expect(without.problems).toEqual([])
    expect(without.files.has(`${dir}/med_0000000001.png`)).toBe(false)
    expect(without.files.has(`${dir}/med_0000000001.json`)).toBe(true)
  })

  it('a version the server will not keep does not stop a pull for ever: what it replaces is copied aside on this device and the round goes on', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const id = a.session.data.scenes[0]!.meta.id
    await a.session.editScene(id, 'A, before.')
    await a.session.flush()
    await a.round()
    await b.round()
    await b.session.editScene(id, 'B, newer.')
    await b.session.flush()
    await b.round()
    world.dav.refuse = (path) => (path.includes('/versions/') ? 413 : null)
    const path = a.session.pathOf(id)!
    await a.round() // must not throw
    expect(a.engine.view().status).toBe('idle')
    expect(a.session.data.scenes[0]!.body).toBe('B, newer.')
    const kept = (await a.adapter.list()).filter(
      (p) => p.startsWith('.aurelia/safety/') && p.endsWith(path),
    )
    expect(kept).toHaveLength(1)
    expect((await a.adapter.read(kept[0]!))!.text).toContain('A, before.')
  })

  it('but a server that cannot be reached at all still stops the round: there is nothing to pull from', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const id = a.session.data.scenes[0]!.meta.id
    await b.session.editScene(id, 'B, newer.')
    await b.session.flush()
    await b.round()
    a.online = false
    await a.round()
    expect(a.engine.view().status).toBe('offline')
    expect(a.session.data.scenes[0]!.body).not.toBe('B, newer.')
  })
})

describe('two different images under one name', () => {
  it('are both kept, and the server’s is not fetched again every round', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const path = `${mediaDir(a.session.data.universes[0]!.id)}/med_0000000001.png`
    const mine = new Uint8Array([1, 2, 3, 0xff]) as Uint8Array<ArrayBuffer>
    const theirs = new Uint8Array([9, 8, 7, 0xfe]) as Uint8Array<ArrayBuffer>
    await a.adapter.writeBytes(path, mine)
    await b.adapter.writeBytes(path, theirs)
    await a.round()
    await b.round()
    await a.round()
    await b.round()
    const copies = (await b.adapter.list()).filter((p) => p.includes('(Aurelia copy'))
    expect(copies).toHaveLength(1)
    expect([...(await b.adapter.readBytes(copies[0]!))!]).toEqual([...mine])
    expect([...(await b.adapter.readBytes(path))!]).toEqual([...theirs])
    world.dav.log.length = 0
    await b.round()
    await a.round()
    expect(world.dav.log.filter((l) => l.startsWith('GET') && l.includes('.png'))).toEqual([])
  })
})
