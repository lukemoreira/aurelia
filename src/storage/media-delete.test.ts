// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { loadWorkspace } from './load'
import { importMedia } from './media-actions'
import { changeNotNames } from './names-actions'
import { deleteItem, restoreDeleted } from './outline-actions'
import { listTrash } from './set-aside'
import type { WorkspaceSession } from './session'

const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x80]) as Uint8Array<ArrayBuffer>
const universe = (s: WorkspaceSession) => s.data.universes[0]!.id

async function withImage() {
  const rig = await outlineRig()
  const id = await importMedia(rig.session, universe(rig.session), { name: 'a.png', bytes: IMAGE })
  const dir = `universes/${universe(rig.session)}/media`
  return { ...rig, id, dir }
}

describe('deleting an image: a stop between the two moves', () => {
  it('leaves no listing without its image, and what waits in the trash comes back whole', async () => {
    const probe = await withImage()
    let steps = 0
    probe.adapter.beforeWrite = () => void steps++
    probe.adapter.beforeRemove = () => void steps++
    await deleteItem(probe.session, probe.id)
    expect(steps).toBeGreaterThanOrEqual(4) // the manifest, then each file copied and removed

    for (let stopAt = 1; stopAt <= steps; stopAt++) {
      const rig = await withImage()
      let n = 0
      const tick = () => {
        if (++n === stopAt) throw new Error('disk stopped')
      }
      rig.adapter.beforeWrite = tick
      rig.adapter.beforeRemove = tick
      await deleteItem(rig.session, rig.id).catch(() => undefined)
      rig.adapter.beforeWrite = rig.adapter.beforeRemove = undefined

      const again = await loadWorkspace(rig.adapter)
      expect(again.problems).toEqual([])
      // every image the app lists has its file
      for (const m of again.data.media ?? [])
        expect(await rig.adapter.readBytes(`${rig.dir}/${m.meta.file}`)).not.toBeNull()
      // and whatever the delete moved comes back, byte for byte
      const session = await rig.open()
      for (const entry of await listTrash(rig.adapter)) await restoreDeleted(session, entry.stamp)
      expect([...(await rig.adapter.readBytes(`${rig.dir}/${rig.id}.png`))!]).toEqual([...IMAGE])
      expect(await rig.adapter.readBytes(`${rig.dir}/${rig.id}.json`)).not.toBeNull()
      expect(session.data.media?.map((m) => m.meta.id)).toEqual([rig.id])
      session.dispose()
    }
  })

  it('a sidecar that names another image does not take that image to the trash', async () => {
    const { session, adapter, id, dir } = await withImage()
    const other = await importMedia(session, universe(session), { name: 'b.png', bytes: IMAGE })
    // a hand-edited (or damaged) sidecar: its `file` is the other image's
    await session.setFields(id, { file: `${other}.png` })
    await deleteItem(session, id)
    expect(await adapter.readBytes(`${dir}/${other}.png`)).not.toBeNull() // still where it was
    expect(await adapter.readBytes(`${dir}/${other}.json`)).not.toBeNull()
    expect(await adapter.readBytes(`${dir}/${id}.json`)).toBeNull() // only its own went
    expect(await adapter.readBytes(`${dir}/${id}.png`)).not.toBeNull()
  })
})

describe('"Not a name" answers', () => {
  async function book() {
    const rig = await outlineRig()
    return { ...rig, bookId: rig.session.data.books[0]!.id }
  }

  it('two answered at once both stay: the list is read inside the write, not before it', async () => {
    const { session, bookId } = await book()
    await Promise.all([
      changeNotNames(session, bookId, { add: 'Greywater' }),
      changeNotNames(session, bookId, { add: 'Ashcombe' }),
    ])
    expect(session.data.books[0]!.notNames?.sort()).toEqual(['Ashcombe', 'Greywater'])
  })

  it('giving a word back takes only that word out, and the last one takes the key away', async () => {
    const { session, adapter, bookId } = await book()
    await changeNotNames(session, bookId, { add: 'Greywater' })
    await changeNotNames(session, bookId, { add: 'Ashcombe' })
    await changeNotNames(session, bookId, { remove: 'Greywater' })
    expect(session.data.books[0]!.notNames).toEqual(['Ashcombe'])
    await changeNotNames(session, bookId, { remove: 'Ashcombe' })
    expect((await adapter.read(session.pathOf(bookId)!))!.text).not.toContain('notNames')
  })

  it('a word already there, or never there, writes nothing; a book that is gone is told', async () => {
    const { session, adapter, bookId } = await book()
    await changeNotNames(session, bookId, { add: 'Greywater' })
    const before = (await adapter.read(session.pathOf(bookId)!))!.text
    await changeNotNames(session, bookId, { add: 'Greywater' })
    await changeNotNames(session, bookId, { remove: 'Nowhere' })
    expect((await adapter.read(session.pathOf(bookId)!))!.text).toBe(before)
    await expect(changeNotNames(session, 'bok_zzzzzzzzzz', { add: 'x' })).rejects.toThrow(
      /no longer/,
    )
  })
})
