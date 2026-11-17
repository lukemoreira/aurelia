// SPDX-License-Identifier: AGPL-3.0-or-later
// An image of the media folder is not text, but it backs up, restores and syncs as the file it is.
import { afterEach, describe, expect, it } from 'vitest'
import { syncWorld, type SyncWorld } from '../../tests/helpers/sync-rig'
import { backupRig } from '../../tests/helpers/backup-rig'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { importMedia } from '@/storage/media-actions'
import { deleteItem } from '@/storage/outline-actions'
import { WebDavStore } from '@/storage/remote/webdav-store'
import { davFetch } from '../../tests/helpers/fake-dav'
import { loadWorkspace } from '@/storage/load'
import { fetchBackup, withNewId, writeRestored } from './restore'

const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x80, 0x00, 0xc3, 0x28, 0x0a])
let world: SyncWorld
afterEach(() => world?.dispose())

const mediaDir = (universe: string) => `universes/${universe}/media`

describe('sync', () => {
  it('an image added on A arrives on B byte for byte, with its caption, and B lists it', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const universe = a.session.data.universes[0]!.id
    const id = await importMedia(a.session, universe, { name: 'map.png', bytes: IMAGE })
    await a.session.flush()
    await a.round()
    const onServer = world.dav.bytes(`${world.folder}/current/${mediaDir(universe)}/${id}.png`)
    expect([...onServer!]).toEqual([...IMAGE])

    await b.round()
    expect([...(await b.adapter.readBytes(`${mediaDir(universe)}/${id}.png`))!]).toEqual([...IMAGE])
    expect(b.session.data.media?.map((m) => m.meta.id)).toEqual([id])
  })

  it('a caption typed on A reaches B, and the image is not sent again', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const universe = a.session.data.universes[0]!.id
    const id = await importMedia(a.session, universe, { name: 'map.png', bytes: IMAGE })
    await a.round()
    await b.round()
    await a.session.setFields(id, { caption: 'The harbour, 412' })
    await a.session.flush()
    world.trace.length = 0
    await a.round()
    await b.round()
    expect(b.session.data.media![0]!.meta.caption).toBe('The harbour, 412')
    expect(world.trace.filter((t) => /PUT.*\.png/.test(t))).toEqual([])
  })

  it('an image deleted on A (to the trash) leaves B’s media folder, and its copy waits in B’s trash', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const universe = a.session.data.universes[0]!.id
    const id = await importMedia(a.session, universe, { name: 'map.png', bytes: IMAGE })
    await a.round()
    await b.round()
    const gone = await deleteItem(a.session, id)
    await a.round()
    await b.round()
    expect(await b.adapter.readBytes(`${mediaDir(universe)}/${id}.png`)).toBeNull()
    expect(b.session.data.media ?? []).toEqual([])
    const kept = `.aurelia/trash/${gone.stamp}/${mediaDir(universe)}/${id}.png`
    await b.round()
    expect([...(await b.adapter.readBytes(kept))!]).toEqual([...IMAGE])
    // and a restore from the server does not call the image in the trash "unreadable"
    const store = new WebDavStore('/dav/', davFetch(world.dav))
    expect((await fetchBackup(store, world.folder, 'current')).problems).toEqual([])
  })
})

describe('backup and restore', () => {
  it('a backup holds the image, and restoring it writes the image back byte for byte (not "unreadable")', async () => {
    const rig = await backupRig({ workspaceName: 'My Book' })
    const universe = (await rig.adapter.list())
      .find((p) => p.endsWith('/universe.md'))!
      .split('/')[1]!
    const id = 'med_0123456789'
    await rig.adapter.writeBytes(`${mediaDir(universe)}/${id}.webp`, IMAGE)
    await rig.adapter.write(
      `${mediaDir(universe)}/${id}.json`,
      `${JSON.stringify({ schemaVersion: 1, id, file: `${id}.webp`, name: 'portrait.webp' })}\n`,
    )
    const engine = await rig.open()
    await engine.turnOn()
    engine.dispose()

    const store = new WebDavStore('/dav/', davFetch(rig.dav))
    const fetched = await fetchBackup(store, rig.folder, 'current')
    expect(fetched.problems).toEqual([])
    const restored = new MemoryAdapter()
    await writeRestored(restored, withNewId(fetched.files, 'wsp_zzzzzzzzzz'))
    expect([...(await restored.readBytes(`${mediaDir(universe)}/${id}.webp`))!]).toEqual([...IMAGE])
    const loaded = await loadWorkspace(restored)
    expect(loaded.problems).toEqual([])
    expect(loaded.data.media?.map((m) => m.meta.id)).toEqual([id])
  })
})
