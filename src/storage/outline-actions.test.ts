// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { bookOutline, bookUnfiled } from '@/domain/outline'
import { planMove, planStep } from '@/domain/outline-moves'
import { changes, outlineRig, snapshot } from '../../tests/helpers/outline-rig'
import { loadWorkspace } from './load'
import {
  addBook,
  addChapter,
  addPart,
  applyMove,
  chooseDuplicate,
  deleteItem,
  renameItem,
  restoreDeleted,
  setDetails,
} from './outline-actions'
import { chapterPath, outlinePath, scenePath, universePath } from './paths'
import { describeEntry, listTrash } from './set-aside'
import type { WorkspaceSession } from './session'

type Rig = Awaited<ReturnType<typeof outlineRig>>

const ids = (s: WorkspaceSession) => ({
  book: s.data.books[0]!.id,
  universe: s.data.universes[0]!.id,
  chapter: s.data.chapters[0]!.id,
  scene: s.data.scenes[0]!.meta.id,
})
/** The titles of a book's outline, chapter by chapter, as the files say. */
const shape = (s: WorkspaceSession, book = s.data.books[0]!.id) =>
  bookOutline(s.data, book).flatMap((g) =>
    g.chapters.map((c) => `${c.chapter.title}: ${c.scenes.map((x) => x.meta.title).join(', ')}`),
  )

/** A book with three chapters of two scenes each, named by letter and number. */
async function threeChapters() {
  const rig = await outlineRig()
  const { session } = rig
  const { book, chapter } = ids(session)
  await renameItem(session, chapter, 'A')
  await renameItem(session, session.data.scenes[0]!.meta.id, 'A1')
  await session.renameWorkspace('My Book')
  const a2 = await session.createScene(chapter)
  await renameItem(session, a2, 'A2')
  for (const letter of ['B', 'C']) {
    const made = await addChapter(session, book, { title: letter })
    await renameItem(session, made.scene, `${letter}1`)
    await renameItem(session, await session.createScene(made.chapter), `${letter}2`)
  }
  await session.flush()
  return rig
}

describe('adding to the outline', () => {
  it('a new chapter writes the chapter, its first scene, and only the derived files after them', async () => {
    const { session, adapter } = await outlineRig()
    const before = await snapshot(adapter)
    const { book } = ids(session)
    const made = await addChapter(session, book, { title: 'The Gate' })
    const diff = changes(before, await snapshot(adapter))
    expect(diff.added).toEqual(
      [`books/${book}/chapters/${made.chapter}.md`, `books/${book}/scenes/${made.scene}.md`].sort(),
    )
    expect(diff.changed).toEqual([`books/${book}/OUTLINE.md`, `books/${book}/book.json`]) // derived
    expect(diff.removed).toEqual([])
    const reloaded = await loadWorkspace(adapter)
    expect(shape(session)).toEqual(['Chapter one: Untitled scene', 'The Gate: Untitled scene'])
    expect(reloaded.data.chapters.map((c) => c.title).sort()).toEqual(['Chapter one', 'The Gate'])
    expect(reloaded.problems).toEqual([])
  })

  it('writes the content files first and the cache last', async () => {
    const { session, adapter } = await outlineRig()
    const order: string[] = []
    adapter.beforeWrite = (path) => void order.push(path.split('/').slice(-2).join('/'))
    const made = await addChapter(session, ids(session).book, { title: 'Two' })
    const names = order.map((p) =>
      p
        .split('/')
        .at(-1)!
        .replace(/^(chp|scn)_\w+/, '$1'),
    )
    expect(names.slice(0, 2)).toEqual(['chp.md', 'scn.md']) // the new files first…
    expect(names.slice(2).sort()).toEqual(['OUTLINE.md', 'book.json']) // …the cache and the outline after
    expect(made.chapter).toMatch(/^chp_/)
  })

  it('a part is its own file; a chapter can join it', async () => {
    const { session, adapter } = await outlineRig()
    const { book } = ids(session)
    const part = await addPart(session, book, 'Part One')
    const made = await addChapter(session, book, { title: 'In the part', partId: part })
    const reloaded = (await loadWorkspace(adapter)).data
    expect(reloaded.parts.map((p) => p.title)).toEqual(['Part One'])
    expect(reloaded.chapters.find((c) => c.id === made.chapter)?.part).toBe(part)
    expect(bookOutline(reloaded, book).map((g) => g.part?.title ?? 'loose')).toEqual([
      'loose',
      'Part One',
    ])
  })

  it('a book of its own is a universe, a book, a chapter and a scene, listed last', async () => {
    const { session, adapter } = await outlineRig()
    const before = await snapshot(adapter)
    const made = await addBook(session, { title: 'The Long Winter' })
    const diff = changes(before, await snapshot(adapter))
    expect(diff.changed).toEqual(['aurelia.json'])
    expect(diff.added).toHaveLength(5) // chapter, scene, book.json, OUTLINE.md, universe.md
    const reloaded = await loadWorkspace(adapter)
    expect(reloaded.problems).toEqual([])
    const universe = reloaded.data.universes.find((u) => u.books.includes(made.book))!
    expect(universe.kind).toBe('standalone')
    expect(reloaded.data.workspace.universes).toContain(universe.id)
    expect(reloaded.data.books.find((b) => b.id === made.book)?.title).toBe('The Long Winter')
    expect(
      JSON.parse(
        (await adapter.read(`universes/${universe.id}/books/${made.book}/book.json`))!.text,
      ).outline,
    ).toHaveLength(1)
  })

  it('a book in a shared universe is listed in that universe', async () => {
    const { session, adapter } = await outlineRig()
    const { universe } = ids(session)
    await session.setFields(universe, { kind: 'shared' })
    await session.flush()
    const made = await addBook(session, { title: 'Book two', universeId: universe })
    const reloaded = (await loadWorkspace(adapter)).data
    expect(reloaded.universes.find((u) => u.id === universe)?.books).toEqual([
      ids(session).book,
      made.book,
    ])
    expect(reloaded.workspace.universes).toEqual([universe])
  })

  it('refuses a book in a standalone universe, and an empty or hidden-character title', async () => {
    const { session } = await outlineRig()
    await expect(
      addBook(session, { title: 'X', universeId: ids(session).universe }),
    ).rejects.toThrow(/shared universe/)
    await expect(addBook(session, { title: '   ' })).rejects.toThrow()
    await expect(addChapter(session, ids(session).book, { title: 'a\nb' })).rejects.toThrow()
  })
})

describe('renaming', () => {
  it('a scene rename changes one line of its file, then the derived outline text', async () => {
    const { session, adapter } = await outlineRig()
    const { scene, book } = ids(session)
    const before = await snapshot(adapter)
    await renameItem(session, scene, '  The Lantern Gate ')
    const diff = changes(before, await snapshot(adapter))
    expect(diff.changed).toEqual(
      [`books/${book}/OUTLINE.md`, `books/${book}/scenes/${scene}.md`].sort(),
    )
    expect(diff.added).toEqual([])
    const path = session.pathOf(scene)!
    expect((await adapter.read(path))!.text).toBe(
      before.get(path)!.replace('title: "Untitled scene"', 'title: "The Lantern Gate"'),
    )
  })

  it('a book rename changes only the title in book.json, byte for byte', async () => {
    const { session, adapter } = await outlineRig()
    const { book } = ids(session)
    const path = session.pathOf(book)!
    const before = (await adapter.read(path))!.text
    await renameItem(session, book, 'Saltmarch')
    expect((await adapter.read(path))!.text).toBe(before.replace('"My Book"', '"Saltmarch"'))
  })

  it('refuses a title that is empty, too long or has hidden characters, and writes nothing', async () => {
    const { session, adapter } = await outlineRig()
    const before = await snapshot(adapter)
    for (const bad of ['', '   ', 'x'.repeat(201), 'two\nlines', 'bell\u0007'])
      await expect(renameItem(session, ids(session).scene, bad)).rejects.toThrow()
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('a rename survives a reload', async () => {
    const { session, open } = await outlineRig()
    await renameItem(session, ids(session).chapter, 'The Gate')
    const again = await open()
    expect(again.data.chapters[0]?.title).toBe('The Gate')
  })
})

describe('details of an item', () => {
  it('sets and takes away a status and a summary: only that file changes, keys and comments stay', async () => {
    const { session, adapter } = await outlineRig()
    const { scene } = ids(session)
    const path = session.pathOf(scene)!
    const before = await snapshot(adapter)
    await setDetails(session, scene, { status: 'draft', summary: 'She gets in.' })
    expect(changes(before, await snapshot(adapter)).changed).toEqual([
      path.replace(/^universes\/unv_\w+\//, ''),
    ])
    expect(session.data.scenes[0]?.meta).toMatchObject({ status: 'draft', summary: 'She gets in.' })
    await setDetails(session, scene, { status: undefined, summary: undefined })
    expect((await adapter.read(path))!.text).toBe(before.get(path))
  })

  it('refuses a value the schema does not allow, and writes nothing', async () => {
    const { session, adapter } = await outlineRig()
    const before = await snapshot(adapter)
    await expect(setDetails(session, ids(session).scene, { status: 'wonderful' })).rejects.toThrow()
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
    expect(session.data.scenes[0]?.meta.status).toBeUndefined()
  })
})

describe('reordering', () => {
  it('moving a scene up writes ONE content file (its own), then the derived files', async () => {
    const { session, adapter } = await threeChapters()
    const b = session.data.chapters.find((c) => c.title === 'B')!.id
    const [b1, b2] = session.data.scenes.filter((s) => s.meta.chapter === b)
    const move = planStep(session.data, b2!.meta.id, -1)!
    const before = await snapshot(adapter)
    await applyMove(session, move)
    const diff = changes(before, await snapshot(adapter))
    const book = ids(session).book
    expect(diff.changed).toEqual(
      [
        `books/${book}/book.json`,
        `books/${book}/OUTLINE.md`,
        `books/${book}/scenes/${b2!.meta.id}.md`,
      ].sort(),
    )
    expect(shape(session)).toEqual(['A: A1, A2', 'B: B2, B1', 'C: C1, C2'])
    expect(b1).toBeDefined()
    // the moved file differs from before in its order line only
    const path = session.pathOf(b2!.meta.id)!
    expect(
      (await adapter.read(path))!.text
        .split('\n')
        .filter((l, i) => l !== before.get(path)!.split('\n')[i]),
    ).toHaveLength(1)
  })

  it('moving to another chapter changes its chapter and order, and still one content file', async () => {
    const { session, adapter } = await threeChapters()
    const c = session.data.chapters.find((x) => x.title === 'C')!.id
    const a1 = session.data.scenes.find((s) => s.meta.title === 'A1')!.meta.id
    const before = await snapshot(adapter)
    await applyMove(session, planMove(session.data, a1, { id: c, where: 'inside' })!)
    const diff = changes(before, await snapshot(adapter))
    expect(diff.changed.filter((p) => p.includes('/scenes/') || p.startsWith('scenes/'))).toEqual([
      `books/${ids(session).book}/scenes/${a1}.md`,
    ])
    expect(shape(session)).toEqual(['A: A2', 'B: B1, B2', 'C: C1, C2, A1'])
    expect(
      (await loadWorkspace(adapter)).data.scenes.find((s) => s.meta.id === a1)?.meta.chapter,
    ).toBe(c)
  })

  it('moving a chapter and a part reorders them, and a chapter into a part sets its part', async () => {
    const { session, adapter } = await threeChapters()
    const { book } = ids(session)
    const chapterId = (t: string) => session.data.chapters.find((c) => c.title === t)!.id
    await applyMove(session, planStep(session.data, chapterId('C'), -1)!)
    expect(shape(session).map((l) => l[0])).toEqual(['A', 'C', 'B'])
    const part = await addPart(session, book, 'Part One')
    await applyMove(session, planMove(session.data, chapterId('B'), { id: part, where: 'inside' })!)
    const reloaded = (await loadWorkspace(adapter)).data
    expect(
      bookOutline(reloaded, book).map((g) => [
        g.part?.title,
        g.chapters.map((c) => c.chapter.title),
      ]),
    ).toEqual([
      [undefined, ['A', 'C']],
      ['Part One', ['B']],
    ])
    await applyMove(
      session,
      planMove(session.data, chapterId('B'), { id: chapterId('A'), where: 'before' })!,
    )
    expect(
      (await loadWorkspace(adapter)).data.chapters.find((c) => c.title === 'B')?.part,
    ).toBeUndefined()
  })

  it('a move to where it already is writes nothing', async () => {
    const { session } = await threeChapters()
    const a1 = session.data.scenes.find((s) => s.meta.title === 'A1')!.meta.id
    expect(planStep(session.data, a1, -1)).toBeNull()
    expect(planMove(session.data, a1, { id: a1, where: 'after' })).toBeNull()
    const a2 = session.data.scenes.find((s) => s.meta.title === 'A2')!.meta.id
    expect(planMove(session.data, a1, { id: a2, where: 'before' })).toBeNull()
  })

  it('a scene never moves to a chapter of another book (its file stays in its folder)', async () => {
    const { session } = await threeChapters()
    const other = await addBook(session, { title: 'Other' })
    const chapter = session.data.chapters.find((c) => c.book === other.book)!.id
    const a1 = session.data.scenes.find((s) => s.meta.title === 'A1')!.meta.id
    expect(planMove(session.data, a1, { id: chapter, where: 'inside' })).toBeNull()
  })

  it('survives a reload in the same order', async () => {
    const { session, open } = await threeChapters()
    const b2 = session.data.scenes.find((s) => s.meta.title === 'B2')!.meta.id
    await applyMove(session, planStep(session.data, b2, -1)!)
    expect(shape(await open())).toEqual(['A: A1, A2', 'B: B2, B1', 'C: C1, C2'])
  })
})

describe('the cache and the derived outline', () => {
  it('scene frontmatter wins over a stale book.json outline, and the next change repairs the cache', async () => {
    const { session, adapter, open } = await threeChapters()
    const { book, universe } = ids(session)
    const path = session.pathOf(book)!
    const stale = JSON.parse((await adapter.read(path))!.text)
    stale.outline = [
      { chapter: session.data.chapters[2]!.id, scenes: [session.data.scenes[0]!.meta.id] },
    ]
    await adapter.write(path, `${JSON.stringify(stale, null, 2)}\n`)
    const again = await open()
    expect(shape(again)).toEqual(['A: A1, A2', 'B: B1, B2', 'C: C1, C2']) // not what the cache says
    const b2 = again.data.scenes.find((s) => s.meta.title === 'B2')!.meta.id
    await applyMove(again, planStep(again.data, b2, -1)!)
    expect(JSON.parse((await adapter.read(path))!.text).outline).toEqual(
      bookOutline(again.data, book).flatMap((g) =>
        g.chapters.map((c) => ({ chapter: c.chapter.id, scenes: c.scenes.map((s) => s.meta.id) })),
      ),
    )
    expect(universe).toBeDefined()
  })

  it('OUTLINE.md lists titles with the files they are in, and says it is derived', async () => {
    const { session, adapter } = await threeChapters()
    const { book, universe } = ids(session)
    const text = (await adapter.read(outlinePath(universe, book)))!.text
    expect(text).toMatch(/^# My Book\n/)
    expect(text).toContain('Derived by Aurelia')
    expect(text).toContain(`### 1. A (chapters/${session.data.chapters[0]!.id}.md)`)
    expect(text).toContain(
      `- A2 (scenes/${session.data.scenes.find((s) => s.meta.title === 'A2')!.meta.id}.md)`,
    )
  })

  it('a stale or hand-edited OUTLINE.md is rewritten by the next change, never read as the truth', async () => {
    const { session, adapter } = await threeChapters()
    const { book, universe } = ids(session)
    await adapter.write(outlinePath(universe, book), 'nonsense')
    await session.refresh()
    await renameItem(session, session.data.chapters.find((c) => c.title === 'A')!.id, 'Alpha')
    expect((await adapter.read(outlinePath(universe, book)))!.text).toContain('### 1. Alpha')
    // and the files were not hurt
    expect((await loadWorkspace(adapter)).problems).toEqual([])
  })
})

describe('unfiled scenes', () => {
  it('a scene whose chapter is gone is shown as unfiled, and can be filed by moving it to a chapter', async () => {
    const { session, adapter } = await threeChapters()
    const { book, universe } = ids(session)
    const a = session.data.chapters.find((c) => c.title === 'A')!
    await adapter.remove(chapterPath(universe, book, a.id)) // deleted by another app
    await session.refresh()
    const unfiled = bookUnfiled(session.data, book).map((s) => s.meta.title)
    expect(unfiled).toEqual(['A1', 'A2'])
    expect(shape(session)).toEqual(['B: B1, B2', 'C: C1, C2'])
    expect(session.view().problems).toEqual([])
    const a1 = session.data.scenes.find((s) => s.meta.title === 'A1')!.meta.id
    const c = session.data.chapters.find((x) => x.title === 'C')!.id
    await applyMove(session, planMove(session.data, a1, { id: c, where: 'inside' })!)
    expect(bookUnfiled(session.data, book).map((s) => s.meta.title)).toEqual(['A2'])
    expect(shape(session)).toEqual(['B: B1, B2', 'C: C1, C2, A1'])
    const outline = (await adapter.read(outlinePath(universe, book)))!.text
    expect(outline).toContain('## Unfiled')
  })
})

describe('deleting is moving to the trash', () => {
  it('a scene waits in .aurelia/trash with a manifest, and Undo puts back the same bytes', async () => {
    const { session, adapter } = await threeChapters()
    const a2 = session.data.scenes.find((s) => s.meta.title === 'A2')!.meta.id
    await session.editScene(a2, 'Words I will want back.\n')
    await session.flush()
    const path = session.pathOf(a2)!
    const before = await snapshot(adapter)
    const gone = await deleteItem(session, a2)
    const diff = changes(before, await snapshot(adapter))
    expect(await adapter.read(path)).toBeNull()
    expect(diff.removed).toContain(path.replace(/^universes\/unv_\w+\//, ''))
    const trashed = `.aurelia/trash/${gone.stamp}/${path}`
    expect((await adapter.read(trashed))!.text).toBe(before.get(path))
    expect(
      JSON.parse((await adapter.read(`.aurelia/trash/${gone.stamp}/manifest.json`))!.text),
    ).toMatchObject({
      label: 'A2',
      kind: 'scene',
      files: [path],
    })
    expect(shape(session)).toEqual(['A: A1', 'B: B1, B2', 'C: C1, C2'])
    expect((await listTrash(adapter)).map((e) => [e.label, e.waiting.length])).toEqual([['A2', 1]])

    const result = await restoreDeleted(session, gone.stamp)
    expect(result).toEqual({ restored: [path], skipped: [] })
    expect((await adapter.read(path))!.text).toBe(before.get(path))
    expect(shape(session)).toEqual(['A: A1, A2', 'B: B1, B2', 'C: C1, C2'])
    expect(await listTrash(adapter)).toEqual([])
    // the restored file can be edited again (compare-and-write knows it)
    await session.editScene(a2, 'More.\n')
    await session.flush()
    expect(session.view().save.kind).toBe('saved')
    expect((await adapter.read(path))!.text).toContain('More.')
  })

  it('a chapter takes its scenes, and all of it comes back from one Undo', async () => {
    const { session, adapter, open } = await threeChapters()
    const b = session.data.chapters.find((c) => c.title === 'B')!.id
    const before = await snapshot(adapter)
    const gone = await deleteItem(session, b)
    expect(shape(session)).toEqual(['A: A1, A2', 'C: C1, C2'])
    expect(shape(await open())).toEqual(['A: A1, A2', 'C: C1, C2'])
    expect((await listTrash(adapter))[0]).toMatchObject({ label: 'B', kind: 'chapter' })
    expect((await listTrash(adapter))[0]!.waiting).toHaveLength(3)
    await restoreDeleted(session, gone.stamp)
    expect(shape(session)).toEqual(['A: A1, A2', 'B: B1, B2', 'C: C1, C2'])
    for (const [path, text] of before)
      if (!path.endsWith('book.json') && !path.endsWith('OUTLINE.md'))
        expect((await adapter.read(path))!.text).toBe(text)
  })

  it('deleting a part leaves its chapters, loose', async () => {
    const { session } = await threeChapters()
    const { book } = ids(session)
    const part = await addPart(session, book, 'Part One')
    const b = session.data.chapters.find((c) => c.title === 'B')!.id
    await applyMove(session, planMove(session.data, b, { id: part, where: 'inside' })!)
    await deleteItem(session, part)
    expect(shape(session)).toEqual(['A: A1, A2', 'B: B1, B2', 'C: C1, C2'])
    expect(bookOutline(session.data, book).every((g) => !g.part)).toBe(true)
  })

  it('a book goes with its whole folder, is unlisted, and Undo lists it again', async () => {
    const { session, adapter } = await threeChapters()
    const first = ids(session)
    const second = await addBook(session, { title: 'Second' })
    await session.editScene(second.scene, 'Second words.\n')
    await session.flush()
    const gone = await deleteItem(session, second.book)
    expect(session.data.books.map((b) => b.id)).toEqual([first.book])
    const files = (await adapter.list()).filter((p) => p.includes(second.book))
    expect(files.every((p) => p.startsWith('.aurelia/trash/'))).toBe(true)
    expect(files.length).toBeGreaterThanOrEqual(4) // book.json, outline, chapter, scene
    await restoreDeleted(session, gone.stamp)
    expect(session.data.books.map((b) => b.id).sort()).toEqual([first.book, second.book].sort())
    expect(
      (await loadWorkspace(adapter)).data.scenes.find((s) => s.meta.id === second.scene)?.body,
    ).toBe('Second words.\n')
    expect((await loadWorkspace(adapter)).problems).toEqual([])
  })

  it('refuses to delete the last book of a workspace', async () => {
    const { session, adapter } = await outlineRig()
    const before = await snapshot(adapter)
    await expect(deleteItem(session, ids(session).book)).rejects.toThrow(/at least one book/)
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('a file whose place was taken stays in the trash, named, and is never written over', async () => {
    const { session, adapter } = await threeChapters()
    const a2 = session.data.scenes.find((s) => s.meta.title === 'A2')!.meta.id
    const path = session.pathOf(a2)!
    const gone = await deleteItem(session, a2)
    await adapter.write(path, 'someone else wrote here')
    const result = await restoreDeleted(session, gone.stamp)
    expect(result).toEqual({ restored: [], skipped: [path] })
    expect((await adapter.read(path))!.text).toBe('someone else wrote here')
    expect((await listTrash(adapter))[0]?.waiting).toEqual([path])
  })

  it('unsaved words are saved before the file moves, so the trash holds them', async () => {
    const { session, adapter } = await threeChapters()
    const a1 = session.data.scenes.find((s) => s.meta.title === 'A1')!.meta.id
    await session.editScene(a1, 'typed a moment ago') // still waiting for the debounce
    const gone = await deleteItem(session, a1)
    const trashed = `.aurelia/trash/${gone.stamp}/${session.pathOf(a1) ?? [...(await adapter.list())].find((p) => p.includes(a1) && p.startsWith('.aurelia/trash'))!.replace(/^\.aurelia\/trash\/[^/]+\//, '')}`
    expect((await adapter.read(trashed))!.text).toContain('typed a moment ago')
  })
})

describe('two files with one ID', () => {
  it('the author keeps one; the other goes to .aurelia/conflicts, whole', async () => {
    const { session, adapter } = await threeChapters()
    const { book, universe } = ids(session)
    const a2 = session.data.scenes.find((s) => s.meta.title === 'A2')!.meta.id
    const original = session.pathOf(a2)!
    const twin = scenePath(universe, book, 'scn_zzzzzzzzzz')
    const text = (await adapter.read(original))!.text
    await adapter.write(twin, text.replace('A2', 'The twin').concat('twin words\n'))
    await session.refresh()
    const dup = session.view().duplicates
    expect(dup).toHaveLength(1)
    expect(dup[0]!.files).toEqual([
      { path: original, title: 'A2' },
      { path: twin, title: 'The twin' },
    ])
    expect(session.view().problems).toEqual([])

    const moved = await chooseDuplicate(session, a2, twin)
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatch(/^\.aurelia\/conflicts\/.*\/universes\//)
    expect((await adapter.read(moved[0]!))!.text).toBe(text) // the one not kept, byte for byte
    expect(await adapter.read(original)).toBeNull()
    expect(session.view().duplicates).toEqual([])
    expect(session.data.scenes.find((s) => s.meta.id === a2)?.meta.title).toBe('The twin')
  })

  it('refuses a choice that is no longer there', async () => {
    const { session } = await threeChapters()
    await expect(chooseDuplicate(session, 'scn_aaaaaaaaaa', 'nowhere.md')).rejects.toThrow(
      /already been sorted/,
    )
  })
})

describe('a book or universe that is not listed is still shown', () => {
  it('a book file with no line in its universe is adopted in memory and listed by the next change', async () => {
    const { session, adapter } = await outlineRig()
    const { universe } = ids(session)
    const before = await snapshot(adapter)
    // the crash: the book's files are there, the line that lists it is not
    await addBook(session, { title: 'Stray' })
    const listed = (await adapter.read(`aurelia.json`))!.text
    await adapter.write('aurelia.json', before.get('aurelia.json')!) // not listed in the workspace either
    const again = await loadWorkspace(adapter)
    expect(again.data.books.map((b) => b.title).sort()).toEqual(['My Book', 'Stray'])
    expect(again.data.workspace.universes).toHaveLength(2)
    expect(listed).not.toBe(before.get('aurelia.json'))
    expect(universe).toBeDefined()
  })
})

describe('refusals', () => {
  it('a newer version, another tab: every action is refused in words and writes nothing', async () => {
    const { session, adapter, journal } = await outlineRig()
    const before = await snapshot(adapter)
    const text = before.get(session.pathOf(ids(session).scene)!)!
    await adapter.write(
      session.pathOf(ids(session).scene)!,
      text.replace('schemaVersion: 1', 'schemaVersion: 2'),
    )
    const { WorkspaceSession } = await import('./session')
    const newer = await WorkspaceSession.open(adapter, { journal, debounceMs: 1e9 })
    const { book, chapter, scene } = ids(newer)
    await expect(addChapter(newer, book)).rejects.toThrow(/newer version/)
    await expect(renameItem(newer, scene, 'X')).rejects.toThrow(/newer version/)
    await expect(deleteItem(newer, chapter)).rejects.toThrow(/newer version/)
    await expect(addBook(newer, { title: 'X' })).rejects.toThrow(/newer version/)
    await expect(setDetails(newer, scene, { status: 'draft' })).rejects.toThrow(/newer version/)
    await adapter.write(newer.pathOf(scene)!, text)
    const after = await snapshot(adapter)
    expect(changes(before, after)).toEqual({ changed: [], added: [], removed: [] })
    expect(await journal.list(newer.data.workspace.id)).toEqual([])
  })
})

describe('a stop at any step loses nothing', () => {
  /** Run `action` once per write it makes, failing that write; then open the folder fresh. */
  async function stopEverywhere(
    prepare: () => Promise<Rig>,
    action: (s: WorkspaceSession) => Promise<unknown>,
    words: (before: Map<string, string>) => string[],
  ) {
    const probe = await prepare()
    let writes = 0
    probe.adapter.beforeWrite = () => void writes++
    const removes: string[] = []
    probe.adapter.beforeRemove = (p) => void removes.push(p)
    await action(probe.session)
    const steps = writes + removes.length
    expect(steps).toBeGreaterThanOrEqual(2)

    for (let stopAt = 1; stopAt <= steps; stopAt++) {
      const rig = await prepare()
      const before = await snapshot(rig.adapter)
      let n = 0
      const tick = () => {
        if (++n === stopAt) throw new Error('disk stopped')
      }
      rig.adapter.beforeWrite = tick
      rig.adapter.beforeRemove = tick
      await action(rig.session).catch(() => undefined)
      rig.adapter.beforeWrite = rig.adapter.beforeRemove = undefined
      // A new session finishes what the journal holds, like a reopened tab.
      const again = await rig.open()
      await again.flush()
      const loaded = await loadWorkspace(rig.adapter)
      expect(JSON.stringify(loaded.problems), `problems after stopping at step ${stopAt}`).toBe(
        '[]',
      )
      const all = [...(await snapshot(rig.adapter))].map(([, t]) => t).join('\n=====\n')
      for (const word of words(before))
        expect(all, `“${word}” after stopping at step ${stopAt}`).toContain(word)
      // And the app can show it: every book is in a universe the workspace lists…
      for (const b of loaded.data.books) {
        const home = loaded.data.universes.find((u) => u.books.includes(b.id))
        expect(
          home,
          `book “${b.title}” has a universe after stopping at step ${stopAt}`,
        ).toBeDefined()
        expect(loaded.data.workspace.universes).toContain(home!.id)
      }
      // …and every scene is in the outline or unfiled.
      const shown = new Set([
        ...bookOutline(loaded.data, loaded.data.books[0]!.id).flatMap((g) =>
          g.chapters.flatMap((c) => c.scenes.map((s) => s.meta.id)),
        ),
        ...bookUnfiled(loaded.data, loaded.data.books[0]!.id).map((s) => s.meta.id),
      ])
      for (const s of loaded.data.scenes)
        if (s.book === loaded.data.books[0]!.id) expect(shown.has(s.meta.id)).toBe(true)
    }
  }

  const prepare = async () => {
    const rig = await threeChapters()
    const a1 = rig.session.data.scenes.find((s) => s.meta.title === 'A1')!.meta.id
    await rig.session.editScene(a1, 'Precious words in A1.\n')
    await rig.session.flush()
    return rig
  }
  const precious = () => ['Precious words in A1.']

  it('deleting a chapter (copy, check, then remove, scene by scene)', async () => {
    await stopEverywhere(
      prepare,
      (s) => deleteItem(s, s.data.chapters.find((c) => c.title === 'A')!.id),
      precious,
    )
  })

  it('restoring a chapter', async () => {
    await stopEverywhere(
      async () => {
        const rig = await prepare()
        const gone = await deleteItem(rig.session, rig.session.data.chapters[0]!.id)
        ;(rig as { stamp?: string }).stamp = gone.stamp
        return rig
      },
      async (s) => {
        const stamp = (await listTrash(s.adapter))[0]!.stamp
        return restoreDeleted(s, stamp)
      },
      precious,
    )
  })

  it('adding a chapter, a part, and a book', async () => {
    await stopEverywhere(
      prepare,
      (s) => addChapter(s, s.data.books[0]!.id, { title: 'New' }),
      precious,
    )
    await stopEverywhere(prepare, (s) => addPart(s, s.data.books[0]!.id, 'New part'), precious)
    await stopEverywhere(prepare, (s) => addBook(s, { title: 'New book' }), precious)
  })

  it('moving a scene to another chapter, and renaming', async () => {
    await stopEverywhere(
      prepare,
      (s) => {
        const a1 = s.data.scenes.find((x) => x.meta.title === 'A1')!.meta.id
        const c = s.data.chapters.find((x) => x.title === 'C')!.id
        return applyMove(s, planMove(s.data, a1, { id: c, where: 'inside' })!)
      },
      precious,
    )
    await stopEverywhere(prepare, (s) => renameItem(s, s.data.chapters[0]!.id, 'Renamed'), precious)
  })

  it('choosing between two files with one ID', async () => {
    const twinned = async () => {
      const rig = await prepare()
      const { book, universe } = ids(rig.session)
      const a1 = rig.session.data.scenes.find((s) => s.meta.title === 'A1')!.meta.id
      const text = (await rig.adapter.read(rig.session.pathOf(a1)!))!.text
      await rig.adapter.write(scenePath(universe, book, 'scn_zzzzzzzzzz'), `${text}twin words\n`)
      await rig.session.refresh()
      return rig
    }
    await stopEverywhere(
      twinned,
      (s) => chooseDuplicate(s, s.view().duplicates[0]!.id, s.view().duplicates[0]!.files[1]!.path),
      () => ['Precious words in A1.', 'twin words'],
    )
    expect(universePath('x')).toContain('universe.md')
  })
})

describe('the checks for outside changes wait for an action', () => {
  it('a focus check in the middle of a delete does not read the half-moved folder as someone else’s change', async () => {
    const { session, adapter } = await threeChapters()
    const b = session.data.chapters.find((c) => c.title === 'B')!.id
    let removed = 0
    let checked = false
    adapter.beforeRemove = async () => {
      if (++removed !== 2) return // one file is already gone, the others are not
      checked = true
      await session.checkAll() // the window was focused mid-delete
    }
    await deleteItem(session, b)
    expect(checked).toBe(true)
    expect(session.view().notes.map((n) => n.id)).not.toContain('external')
    expect(shape(session)).toEqual(['A: A1, A2', 'C: C1, C2'])
  })
})

describe('deleting while words are not saved, and after', () => {
  it('refuses, and moves nothing, while a scene still holds words the disk would not take', async () => {
    const { session, adapter, journal } = await threeChapters()
    const a1 = session.data.scenes.find((s) => s.meta.title === 'A1')!.meta.id
    const path = session.pathOf(a1)!
    adapter.beforeWrite = (p) => {
      if (p === path) throw new Error('disk full')
    }
    await session.editScene(a1, 'words the disk refused')
    await expect(deleteItem(session, a1)).rejects.toThrow(/still saving/)
    adapter.beforeWrite = undefined
    expect(await adapter.read(path)).not.toBeNull() // still in its place
    expect((await listTrash(adapter)).length).toBe(0)
    expect((await journal.list(session.data.workspace.id)).map((e) => e.path)).toContain(path)
    expect(session.data.scenes.find((s) => s.meta.id === a1)?.body).toBe('words the disk refused')
  })

  it('a delete leaves nothing for the next check to mistake for someone else’s change', async () => {
    const { session } = await threeChapters()
    await deleteItem(session, session.data.chapters.find((c) => c.title === 'B')!.id)
    await session.checkAll()
    expect(session.view().notes.map((n) => n.id)).not.toContain('external')
    expect(session.view().save.kind).toBe('saved')
  })
})

describe('typing while a delete moves the files', () => {
  it('keeps the words: they go into the trashed copy, with no conflict, and a restore brings them back', async () => {
    const { session, adapter, journal } = await threeChapters()
    const a1 = session.data.scenes.find((s) => s.meta.title === 'A1')!.meta.id
    const path = session.pathOf(a1)!
    let typed = false
    adapter.beforeRemove = async (p) => {
      if (p !== path || typed) return
      typed = true
      await session.editScene(a1, 'typed during the delete') // a key pressed after the checks, before the move ends
      await session.pipeline.flush(path) // and the save timer fires right then
    }
    const gone = await deleteItem(session, a1)
    adapter.beforeRemove = undefined
    expect(typed).toBe(true)
    expect(await adapter.read(path)).toBeNull() // nothing was written back to the old place
    expect((await adapter.read(`.aurelia/trash/${gone.stamp}/${path}`))!.text).toContain(
      'typed during the delete',
    )
    await session.flush()
    expect(session.view().conflicts).toEqual([])
    expect(session.view().save.kind).toBe('saved')
    expect(await journal.list(session.data.workspace.id)).toEqual([])
    await restoreDeleted(session, gone.stamp)
    expect((await adapter.read(path))!.text).toContain('typed during the delete')
    expect(session.data.scenes.find((s) => s.meta.id === a1)?.body).toBe('typed during the delete')
  })
})

describe('a restored scene is never shown nowhere', () => {
  it('refuses to put a chapter back while its book is in the trash, and puts it back once the book is', async () => {
    const { session, adapter } = await threeChapters()
    const second = await addBook(session, { title: 'Second' })
    const chapter = session.data.chapters.find((c) => c.book === second.book)!.id
    const chapterGone = await deleteItem(session, chapter)
    const bookGone = await deleteItem(session, second.book)
    const before = await snapshot(adapter)
    await expect(restoreDeleted(session, chapterGone.stamp)).rejects.toThrow(
      /book is in Recently deleted/,
    )
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
    expect(session.data.scenes.some((s) => s.meta.id === second.scene)).toBe(false)
    await restoreDeleted(session, bookGone.stamp)
    await restoreDeleted(session, chapterGone.stamp)
    const again = bookOutline(session.data, second.book).flatMap((g) => g.chapters)
    expect(again.flatMap((c) => c.scenes.map((s) => s.meta.id))).toEqual([second.scene])
  })

  it('says so, by path, for a scene whose book is not there (put there by hand or a sync tool)', async () => {
    const { session, adapter } = await outlineRig()
    const universe = session.data.universes[0]!.id
    const path = scenePath(universe, 'bok_zzzzzzzzzz', 'scn_aaaaaaaaaa')
    await adapter.write(
      path,
      '---\ntitle: "Lost"\nschemaVersion: 1\nid: "scn_aaaaaaaaaa"\nchapter: "chp_zzzzzzzzzz"\norder: "a"\n---\n\nwords\n',
    )
    const loaded = await loadWorkspace(adapter)
    expect(loaded.problems).toEqual([
      { path, reason: 'Its book is missing, so it is not in the outline.' },
    ])
    expect(await adapter.read(path)).not.toBeNull()
  })
})

describe('a move where no key fits', () => {
  it('re-keys the neighbours, so the placement is what was asked for and survives a reload', async () => {
    const { session, adapter, open } = await threeChapters()
    const scene = (t: string) => session.data.scenes.find((s) => s.meta.title === t)!.meta.id
    await setDetails(session, scene('A1'), { order: '0' })
    await setDetails(session, scene('A2'), { order: 'a' })
    const move = planMove(session.data, scene('A2'), { id: scene('A1'), where: 'before' })!
    expect(move.also?.map((o) => o.id)).toEqual([scene('A1')])
    const before = await snapshot(adapter)
    await applyMove(session, move)
    const diff = changes(before, await snapshot(adapter))
    expect(diff.changed.filter((p) => p.includes('/scenes/')).length).toBeGreaterThanOrEqual(1) // the neighbour got a fresh key
    expect(shape(await open()).slice(0, 1)).toEqual(['A: A2, A1'])
  })
})

describe('derived files never raise a conflict', () => {
  it('a hand-edited OUTLINE.md the session has not seen is put right, with no dialog', async () => {
    const { session, adapter } = await threeChapters()
    const { book, universe } = ids(session)
    await adapter.write(outlinePath(universe, book), 'someone typed here') // no refresh: the session still expects the old text
    await renameItem(session, session.data.chapters.find((c) => c.title === 'A')!.id, 'Alpha')
    expect((await adapter.read(outlinePath(universe, book)))!.text).toContain('### 1. Alpha')
    expect(session.view().conflicts).toEqual([])
    expect(session.view().save.kind).toBe('saved')
  })

  it('the outline cache is written into book.json as it is on disk now: another app’s change to it stays', async () => {
    const { session, adapter } = await threeChapters()
    const path = session.pathOf(ids(session).book)!
    const edited = JSON.parse((await adapter.read(path))!.text)
    edited['x-note'] = 'added by a sync tool'
    await adapter.write(path, `${JSON.stringify(edited, null, 2)}\n`) // no refresh
    const b2 = session.data.scenes.find((s) => s.meta.title === 'B2')!.meta.id
    await applyMove(session, planStep(session.data, b2, -1)!)
    const after = JSON.parse((await adapter.read(path))!.text)
    expect(after['x-note']).toBe('added by a sync tool')
    expect(after.outline[1].scenes[0]).toBe(b2)
    expect(session.view().conflicts).toEqual([])
    expect(session.view().save.kind).toBe('saved')
  })

  it('words waiting in book.json (a title just typed) still go through the pipeline, and the cache follows', async () => {
    const { session, adapter } = await threeChapters()
    const { book } = ids(session)
    const b2 = session.data.scenes.find((s) => s.meta.title === 'B2')!.meta.id
    await session.setFields(book, { title: 'Typed title' }) // pending: the debounce has not fired
    await applyMove(session, planStep(session.data, b2, -1)!)
    await session.flush()
    const after = JSON.parse((await adapter.read(session.pathOf(book)!))!.text)
    expect(after.title).toBe('Typed title')
    expect(after.outline[1].scenes[0]).toBe(b2)
  })
})

describe('Recently deleted speaks of chapters and scenes, never of files', () => {
  it('says what was deleted and how much of the story it held', async () => {
    const { session, adapter } = await threeChapters()
    const book = await addBook(session, { title: 'Second' })
    await deleteItem(session, session.data.chapters.find((c) => c.title === 'B')!.id)
    await deleteItem(session, session.data.scenes.find((s) => s.meta.title === 'A1')!.meta.id)
    await deleteItem(session, book.book)
    const words = (await listTrash(adapter)).map(describeEntry).sort()
    expect(words).toEqual(['Book · 1 chapter · 1 scene', 'Chapter · 2 scenes', 'Scene'])
    expect(words.join(' ')).not.toMatch(/file/i)
  })
})
