// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES } from '@/domain/media'
import { FakeLocks } from '../../tests/helpers/fake-locks'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { changes, outlineRig, snapshot } from '../../tests/helpers/outline-rig'
import { loadWorkspace } from './load'
import { importMedia } from './media-actions'
import { deleteItem, restoreDeleted, setDetails } from './outline-actions'
import { listTrash } from './set-aside'
import { WorkspaceSession } from './session'

/** Bytes no text decoder takes: a PNG signature, then 0xff and 0x80. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x80, 0x00, 0x01,
])
const universe = (s: WorkspaceSession) => s.data.universes[0]!.id

describe('importing an image', () => {
  it('keeps the file byte for byte, with its extension, beside a sidecar that holds what is said about it', async () => {
    const { session, adapter } = await outlineRig()
    const id = await importMedia(session, universe(session), {
      name: 'Elena (portrait).PNG',
      type: 'image/png',
      bytes: PNG,
    })
    const dir = `universes/${universe(session)}/media`
    expect([...(await adapter.readBytes(`${dir}/${id}.png`))!]).toEqual([...PNG])
    const sidecar = JSON.parse((await adapter.read(`${dir}/${id}.json`))!.text)
    expect(sidecar).toMatchObject({
      schemaVersion: 1,
      id,
      file: `${id}.png`,
      name: 'Elena (portrait).PNG', // what the author called it
      type: 'image/png',
      size: PNG.length,
    })
    expect(session.data.media).toEqual([
      { universe: universe(session), meta: expect.objectContaining({ id, file: `${id}.png` }) },
    ])
    // a fresh open reads the sidecar and finds nothing wrong with the image beside it
    const loaded = await loadWorkspace(adapter)
    expect(loaded.problems).toEqual([])
    expect(loaded.data.media?.map((m) => m.meta.id)).toEqual([id])
  })

  it('takes the extension from the file’s own name, or from its type when it has none', async () => {
    const { session, adapter } = await outlineRig()
    const a = await importMedia(session, universe(session), { name: 'photo.jpeg', bytes: PNG })
    const b = await importMedia(session, universe(session), {
      name: 'untitled',
      type: 'image/webp',
      bytes: PNG,
    })
    expect(session.data.media!.find((m) => m.meta.id === a)!.meta.file).toBe(`${a}.jpeg`)
    expect(session.data.media!.find((m) => m.meta.id === b)!.meta.file).toBe(`${b}.webp`)
    expect(await adapter.readBytes(`universes/${universe(session)}/media/${b}.webp`)).not.toBeNull()
  })

  it('writes only the two new files, and changes nothing the author wrote', async () => {
    const { session, adapter } = await outlineRig()
    const before = await snapshot(adapter)
    const id = await importMedia(session, universe(session), { name: 'a.png', bytes: PNG })
    const after = await adapter.list()
    const added = after
      .filter((p) => !before.has(p))
      .map((p) => p.replace(/^universes\/unv_\w+\//, ''))
    expect(added.sort()).toEqual([`media/${id}.json`, `media/${id}.png`])
  })

  it('refuses what is not an image, and what is too big, in words, before writing anything', async () => {
    const { session, adapter } = await outlineRig()
    const before = (await adapter.list()).length
    await expect(
      importMedia(session, universe(session), {
        name: 'notes.txt',
        type: 'text/plain',
        bytes: PNG,
      }),
    ).rejects.toThrow(/not an image/)
    await expect(
      importMedia(session, universe(session), { name: 'run.exe', bytes: PNG }),
    ).rejects.toThrow(/not an image/)
    await expect(
      importMedia(session, universe(session), { name: 'x.constructor', bytes: PNG }),
    ).rejects.toThrow(/not an image/)
    // a name that says it is not an image is refused whatever the type claims
    await expect(
      importMedia(session, universe(session), { name: 'photo.dat', type: 'image/png', bytes: PNG }),
    ).rejects.toThrow(/not an image/)
    const huge = { length: MAX_IMAGE_BYTES + 1 } as unknown as Uint8Array<ArrayBuffer>
    await expect(
      importMedia(session, universe(session), { name: 'big.png', bytes: huge }),
    ).rejects.toThrow(/bigger than 48 MB/)
    await expect(
      importMedia(session, 'unv_zzzzzzzzzz', { name: 'a.png', bytes: PNG }),
    ).rejects.toThrow(/no longer/)
    expect((await adapter.list()).length).toBe(before)
  })

  it('does not keep a file that did not read back the same (a disk that corrupts)', async () => {
    const { session, adapter } = await outlineRig()
    const write = adapter.writeBytes.bind(adapter)
    adapter.writeBytes = (path, bytes) => write(path, new Uint8Array([...bytes, 9]))
    const before = await adapter.list()
    await expect(
      importMedia(session, universe(session), { name: 'a.png', bytes: PNG }),
    ).rejects.toThrow(/did not read back the same/)
    expect(await adapter.list()).toEqual(before)
    expect(session.data.media ?? []).toEqual([])
  })

  it('a stop between the image and its sidecar leaves no listing without an image; the file left is harmless', async () => {
    const { session, adapter } = await outlineRig()
    adapter.beforeWrite = (path) => {
      if (path.endsWith('.json') && path.includes('/media/')) throw new Error('disk stopped')
    }
    adapter.beforeRemove = () => {
      throw new Error('disk stopped') // and the clean-up fails too: the worst case
    }
    await expect(
      importMedia(session, universe(session), { name: 'a.png', bytes: PNG }),
    ).rejects.toThrow()
    adapter.beforeWrite = undefined
    adapter.beforeRemove = undefined
    const stray = (await adapter.list()).filter((p) => p.includes('/media/'))
    expect(stray).toHaveLength(1) // the image, with no sidecar
    const again = await loadWorkspace(adapter)
    expect(again.problems).toEqual([])
    expect(again.data.media ?? []).toEqual([])
    expect(stray[0]!).toMatch(/\.png$/)
  })

  it('with the sidecar failing but the disk well, the new image is taken away again', async () => {
    const { session, adapter } = await outlineRig()
    adapter.beforeWrite = (path) => {
      if (path.endsWith('.json') && path.includes('/media/')) throw new Error('disk stopped')
    }
    await expect(
      importMedia(session, universe(session), { name: 'a.png', bytes: PNG }),
    ).rejects.toThrow()
    adapter.beforeWrite = undefined
    expect((await adapter.list()).filter((p) => p.includes('/media/'))).toEqual([])
  })
})

describe('what is said about an image', () => {
  it('a caption and a credit change the sidecar only, never the image', async () => {
    const { session, adapter } = await outlineRig()
    const id = await importMedia(session, universe(session), { name: 'a.png', bytes: PNG })
    const dir = `universes/${universe(session)}/media`
    await setDetails(session, id, { caption: 'Elena at the gate', credit: 'Igor Moreira' })
    expect(session.data.media![0]!.meta).toMatchObject({
      caption: 'Elena at the gate',
      credit: 'Igor Moreira',
    })
    expect([...(await adapter.readBytes(`${dir}/${id}.png`))!]).toEqual([...PNG])
    const sidecar = JSON.parse((await adapter.read(`${dir}/${id}.json`))!.text)
    expect(sidecar).toMatchObject({
      caption: 'Elena at the gate',
      credit: 'Igor Moreira',
      name: 'a.png',
    })
    await setDetails(session, id, { caption: undefined })
    expect(JSON.parse((await adapter.read(`${dir}/${id}.json`))!.text)).not.toHaveProperty(
      'caption',
    )
  })
})

describe('deleting an image', () => {
  it('moves the image and its sidecar to the trash byte for byte, and Undo brings both back', async () => {
    const { session, adapter } = await outlineRig()
    const id = await importMedia(session, universe(session), { name: 'a.png', bytes: PNG })
    await setDetails(session, id, { caption: 'The gate' })
    const dir = `universes/${universe(session)}/media`
    const sidecarText = (await adapter.read(`${dir}/${id}.json`))!.text

    const gone = await deleteItem(session, id)
    expect(gone).toMatchObject({ kind: 'media', label: 'The gate' })
    expect(await adapter.readBytes(`${dir}/${id}.png`)).toBeNull()
    expect(await adapter.readBytes(`${dir}/${id}.json`)).toBeNull()
    const trash = `.aurelia/trash/${gone.stamp}/${dir}`
    expect([...(await adapter.readBytes(`${trash}/${id}.png`))!]).toEqual([...PNG])
    expect((await adapter.read(`${trash}/${id}.json`))!.text).toBe(sidecarText)
    expect(session.data.media ?? []).toEqual([])
    expect((await listTrash(adapter)).map((e) => [e.kind, e.label])).toEqual([
      ['media', 'The gate'],
    ])

    expect(await restoreDeleted(session, gone.stamp)).toMatchObject({ skipped: [] })
    expect([...(await adapter.readBytes(`${dir}/${id}.png`))!]).toEqual([...PNG])
    expect(session.data.media!.map((m) => m.meta.id)).toEqual([id])
    expect(session.data.media![0]!.meta.caption).toBe('The gate')
  })
})

describe('refusals', () => {
  it('a newer version, another tab and a tab still settling import nothing and delete nothing', async () => {
    const { session, adapter, journal } = await outlineRig()
    const id = await importMedia(session, universe(session), { name: 'a.png', bytes: PNG })
    const before = await snapshot(adapter)
    const bytesBefore = [
      ...(await adapter.readBytes(`universes/${universe(session)}/media/${id}.png`))!,
    ]
    const refused = async (s: WorkspaceSession) => {
      await expect(importMedia(s, universe(s), { name: 'b.png', bytes: PNG })).rejects.toThrow()
      await expect(deleteItem(s, id)).rejects.toThrow()
      await expect(setDetails(s, id, { caption: 'x' })).rejects.toThrow()
    }
    const locks = new FakeLocks()
    const first = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    const second = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    await refused(second) // another tab
    ;(first as unknown as { settling: boolean }).settling = true
    await refused(first) // settling
    ;(first as unknown as { settling: boolean }).settling = false
    const newer = new MemoryAdapter()
    for (const [path, text] of before)
      newer.putBytes(
        path,
        new TextEncoder().encode(text.replace(/schemaVersion"?: 1/g, (m) => m.replace('1', '2'))),
      )
    newer.putBytes(`universes/${universe(session)}/media/${id}.png`, new Uint8Array(PNG))
    const readOnly = await WorkspaceSession.open(newer, { journal, debounceMs: 1e9 })
    expect(readOnly.view().newerVersion).toBe(true)
    await refused(readOnly) // a newer version
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
    expect([
      ...(await adapter.readBytes(`universes/${universe(session)}/media/${id}.png`))!,
    ]).toEqual(bytesBefore)
    first.dispose()
    second.dispose()
  })
})
