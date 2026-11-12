// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { saltmarchSample, SAMPLE_START } from '@/sample/saltmarch'
import { useWorkspaceStore } from './workspace'

const fresh = () => {
  setActivePinia(createPinia())
  return useWorkspaceStore()
}
beforeEach(() => localStorage.clear())

describe('workspace store', () => {
  it('has nothing loaded to begin with, and nothing to reopen', () => {
    const ws = fresh()
    expect(ws.loaded).toBe(false)
    expect(ws.ensureLoaded()).toBe(false)
  })

  it('opens the sample at Curfew Bells and selects it', () => {
    const ws = fresh()
    ws.loadSample()
    expect(ws.startPath()).toBe(`/w/${SAMPLE_START.book}/${SAMPLE_START.scene}`)
    ws.select(SAMPLE_START.book, SAMPLE_START.scene)
    expect(ws.scene?.meta.title).toBe('Curfew Bells')
    expect(ws.universe?.title).toBe('Saltmarch')
    expect(ws.words).toEqual({ scene: 1240, chapter: 3140, book: 12340 })
  })

  it('moves between books and brings back the last scene of each', () => {
    const ws = fresh()
    ws.loadSample()
    const [lantern, tidebound, saltash, winter] = ws.data!.books
    ws.select(lantern!.id, SAMPLE_START.scene)
    ws.select(saltash!.id)
    expect(ws.scene?.meta.title).toBe('Washed Ashore')
    expect(ws.context?.book.mode).toBe('branching')
    ws.select(lantern!.id)
    expect(ws.scene?.meta.title).toBe('Curfew Bells')
    ws.select(winter!.id)
    expect(ws.universe?.kind).toBe('standalone')
    expect(tidebound).toBeDefined()
  })

  it('falls back to the first scene when the asked-for one is not in the book', () => {
    const ws = fresh()
    ws.loadSample()
    const saltash = ws.data!.books[2]!
    expect(ws.sceneFor(saltash.id, SAMPLE_START.scene)).toBe(ws.sceneFor(saltash.id))
    ws.select('bok_nonexistent', 'x')
    expect(ws.bookId).toBeNull()
  })

  it('reopens the sample after a reload and returns to the same place', async () => {
    const first = fresh()
    first.loadSample()
    const tide = first.data!.scenes.find((s) => s.meta.title === 'Tide Bell')!.meta.id
    first.select(SAMPLE_START.book, tide)
    await nextTick()

    const second = fresh() // a new page load: empty memory, same device storage
    expect(second.loaded).toBe(false)
    expect(second.ensureLoaded()).toBe(true)
    expect(second.startPath()).toBe(`/w/${SAMPLE_START.book}/${tide}`)
  })

  it('keeps the open book and scene when a reloaded workspace still has them', () => {
    const ws = fresh()
    ws.loadSample()
    ws.select(SAMPLE_START.book, SAMPLE_START.scene)
    ws.load(saltmarchSample())
    expect([ws.bookId, ws.sceneId]).toEqual([SAMPLE_START.book, SAMPLE_START.scene])
  })

  it('lets go of the selection when its book or scene is gone, for the caller to start over', () => {
    const ws = fresh()
    ws.loadSample()
    ws.select(SAMPLE_START.book, SAMPLE_START.scene)
    const noScene = saltmarchSample()
    noScene.scenes = noScene.scenes.filter((s) => s.meta.id !== SAMPLE_START.scene)
    ws.load(noScene)
    expect([ws.bookId, ws.sceneId]).toEqual([null, null])

    ws.select(SAMPLE_START.book)
    const noBook = saltmarchSample()
    noBook.books = noBook.books.filter((b) => b.id !== SAMPLE_START.book)
    ws.load(noBook)
    expect([ws.bookId, ws.sceneId]).toEqual([null, null])
  })

  it('builds the palette entries once and says the workspace is not saved', () => {
    const ws = fresh()
    expect(ws.entries).toEqual([])
    ws.loadSample()
    expect(ws.entries).toBe(ws.entries)
    expect(ws.entryByKey.get(ws.entries[0]!.key)).toBe(ws.entries[0])
    expect(ws.saveState).toBe('Sample workspace · not saved')
  })

  it('refuses a workspace that does not parse', () => {
    const ws = fresh()
    const bad = saltmarchSample()
    bad.books[0] = { ...bad.books[0]!, id: 'scn_notabook001' }
    expect(() => ws.load(bad)).toThrow()
  })
})
