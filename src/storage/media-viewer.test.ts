// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest'
import type { MediaDoc } from '@/domain/workspace-data'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { MediaViewer } from './media-viewer'
import type { ThumbStore } from './thumbnails'

const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x80]) as Uint8Array<ArrayBuffer>
const doc = (n: number, ext = 'png'): MediaDoc => ({
  universe: 'unv_0000000001',
  meta: {
    schemaVersion: 1,
    id: `med_${String(n).padStart(10, '0')}`,
    file: `med_${String(n).padStart(10, '0')}.${ext}`,
  },
})
const place = (adapter: MemoryAdapter, d: MediaDoc) =>
  adapter.putBytes(`universes/${d.universe}/media/${d.meta.file}`, IMAGE)

function memoryThumbs() {
  const kept = new Map<string, Blob>()
  const store: ThumbStore = {
    get: async (w, id) => kept.get(`${w}/${id}`) ?? null,
    put: async (w, id, blob) => void kept.set(`${w}/${id}`, blob),
    remove: async (w, id) => void kept.delete(`${w}/${id}`),
  }
  return { kept, store }
}

function viewerWith(
  adapter: MemoryAdapter,
  thumbs: ThumbStore | null,
  small: Blob | null = new Blob(['t']),
) {
  let n = 0
  const urls = new Map<string, Blob>()
  const revoked: string[] = []
  const viewer = new MediaViewer({
    readBytes: (p) => adapter.readBytes(p),
    workspaceId: 'wsp_0000000001',
    thumbs,
    makeThumb: async () => small,
    createUrl: (blob) => {
      const url = `blob:${++n}`
      urls.set(url, blob)
      return url
    },
    revokeUrl: (url) => void revoked.push(url),
  })
  return { viewer, urls, revoked }
}

describe('thumbnails are a device-side cache', () => {
  it('a thumbnail is made once, kept in the device cache, and never written into the workspace', async () => {
    const adapter = new MemoryAdapter()
    const d = doc(1)
    place(adapter, d)
    const { kept, store } = memoryThumbs()
    const before = await adapter.list()
    const { viewer, urls } = viewerWith(adapter, store)
    const url = await viewer.thumb(d)
    expect(urls.get(url!)!.size).toBe(1) // the small picture, not the image
    expect([...kept.keys()]).toEqual([`wsp_0000000001/${d.meta.id}`])
    expect(await adapter.list()).toEqual(before) // not one new file in the folder
  })

  it('a later visit draws it from the cache without reading the image again', async () => {
    const adapter = new MemoryAdapter()
    const d = doc(1)
    place(adapter, d)
    const { store } = memoryThumbs()
    await viewerWith(adapter, store).viewer.thumb(d)
    const read = vi.spyOn(adapter, 'readBytes')
    const second = viewerWith(adapter, store)
    expect(await second.viewer.thumb(d)).toBeTruthy()
    expect(read).not.toHaveBeenCalled()
  })

  it('shows the image itself when no thumbnail can be made, and keeps nothing', async () => {
    const adapter = new MemoryAdapter()
    const d = doc(1)
    place(adapter, d)
    const { kept, store } = memoryThumbs()
    const { viewer, urls } = viewerWith(adapter, store, null)
    const url = await viewer.thumb(d)
    expect(urls.get(url!)!.size).toBe(IMAGE.length)
    expect(kept.size).toBe(0)
  })

  it('draws a drawing (SVG) and a moving picture (GIF) as they are, never cut down', async () => {
    const adapter = new MemoryAdapter()
    const { kept, store } = memoryThumbs()
    for (const [n, ext] of [
      [1, 'svg'],
      [2, 'gif'],
    ] as const) {
      const d = doc(n, ext)
      place(adapter, d)
      const { viewer, urls } = viewerWith(adapter, store)
      expect(urls.get((await viewer.thumb(d))!)!.size).toBe(IMAGE.length)
    }
    expect(kept.size).toBe(0)
  })

  it('works with no cache at all (a browser without private storage)', async () => {
    const adapter = new MemoryAdapter()
    const d = doc(1)
    place(adapter, d)
    expect(await viewerWith(adapter, null).viewer.thumb(d)).toBeTruthy()
  })

  it('a cache that cannot be written costs a redraw, not the picture', async () => {
    const adapter = new MemoryAdapter()
    const d = doc(1)
    place(adapter, d)
    const broken: ThumbStore = {
      get: async () => null,
      put: async () => Promise.reject(new Error('quota')),
      remove: async () => undefined,
    }
    expect(await viewerWith(adapter, broken).viewer.thumb(d)).toBeTruthy()
  })

  it('an image whose file is missing answers null, and is asked again next time', async () => {
    const adapter = new MemoryAdapter()
    const d = doc(1)
    const { viewer } = viewerWith(adapter, null)
    expect(await viewer.full(d)).toBeNull()
    place(adapter, d)
    expect(await viewer.full(d)).toBeTruthy()
  })

  it('reads and shrinks two pictures at once at most, so a big gallery does not freeze the page', async () => {
    const adapter = new MemoryAdapter()
    const docs = Array.from({ length: 8 }, (_, i) => doc(i + 1))
    for (const d of docs) place(adapter, d)
    let live = 0
    let most = 0
    const viewer = new MediaViewer({
      readBytes: async (p) => {
        live++
        most = Math.max(most, live)
        await new Promise((r) => setTimeout(r, 2))
        live--
        return adapter.readBytes(p)
      },
      workspaceId: 'wsp_0000000001',
      thumbs: null,
      makeThumb: async () => new Blob(['t']),
      createUrl: () => 'blob:x',
    })
    await Promise.all(docs.map((d) => viewer.thumb(d)))
    expect(most).toBe(2)
  })

  it('forgetting an image frees its pictures and its cached thumbnail', async () => {
    const adapter = new MemoryAdapter()
    const d = doc(1)
    place(adapter, d)
    const { kept, store } = memoryThumbs()
    const { viewer, revoked } = viewerWith(adapter, store)
    const thumb = await viewer.thumb(d)
    const full = await viewer.full(d)
    await viewer.forget(d.meta.id)
    expect(revoked.sort()).toEqual([full, thumb].sort())
    expect(kept.size).toBe(0)
  })
})
