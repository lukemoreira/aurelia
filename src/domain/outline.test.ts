// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { saltmarchSample } from '@/sample/saltmarch'
import { bookOutline, outlineScenes, sceneContext } from './outline'

describe('bookOutline', () => {
  it('keeps a chapter whose part is missing, among the loose ones, with its scenes', () => {
    const data = saltmarchSample()
    const book = data.books[0]!
    const lostPart = data.parts.find((p) => p.book === book.id)!
    const before = outlineScenes(bookOutline(data, book.id)).length
    const orphaned = data.chapters.filter((c) => c.part === lostPart.id).map((c) => c.id)
    expect(orphaned.length).toBeGreaterThan(0)

    // The part's file is gone (deleted, or not yet synced); its chapters still name it.
    data.parts = data.parts.filter((p) => p.id !== lostPart.id)
    const outline = bookOutline(data, book.id)

    expect(outline.some((g) => g.part?.id === lostPart.id)).toBe(false)
    const loose = outline.find((g) => !g.part)!
    expect(orphaned.every((id) => loose.chapters.some((c) => c.chapter.id === id))).toBe(true)
    expect(outlineScenes(outline)).toHaveLength(before)
  })

  it('still finds the context of a scene in a chapter whose part is missing', () => {
    const data = saltmarchSample()
    const scene = data.scenes[0]!
    const chapter = data.chapters.find((c) => c.id === scene.meta.chapter)!
    data.parts = data.parts.filter((p) => p.id !== chapter.part)
    expect(sceneContext(data, scene.meta.id)?.part).toBeUndefined()
    expect(sceneContext(data, scene.meta.id)?.chapter.chapter.id).toBe(chapter.id)
  })
})
