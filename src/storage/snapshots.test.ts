// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeLocks } from '../../tests/helpers/fake-locks'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { newId } from '@/domain/ids'
import { StorageError } from './errors'
import { hashText } from './hash'
import { addBook, addChapter, deleteItem, setDetails } from './outline-actions'
import { restoreBook, restoreScene } from './snapshot-restore'
import { cleanName, listSnapshots, readSnapshot, takeSnapshot } from './snapshots'
import { snapshotFilePath, snapshotManifestPath } from './paths'
import { WorkspaceSession } from './session'

// Pass-through, so a test can force an ID (a collision) for one call.
vi.mock('@/domain/ids', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/domain/ids')>()
  return { ...real, newId: vi.fn(real.newId) }
})

type Rig = Awaited<ReturnType<typeof outlineRig>>
let rig: Rig
beforeEach(async () => {
  vi.mocked(newId).mockImplementation(
    (await vi.importActual<typeof import('@/domain/ids')>('@/domain/ids')).newId,
  )
  rig = await outlineRig()
})

const scene = (s: WorkspaceSession, n = 0) => s.data.scenes[n]!.meta.id
const body = (s: WorkspaceSession, id: string) => s.data.scenes.find((x) => x.meta.id === id)?.body
/** Type into a scene and let it reach the file. */
async function type(s: WorkspaceSession, id: string, text: string) {
  await s.editScene(id, text)
  await s.flush()
}
/** A second scene with text, in the first chapter. */
async function addScene(s: WorkspaceSession, text: string) {
  const id = await s.createScene(s.data.chapters[0]!.id)
  await type(s, id, text)
  return id
}
const book = (s: WorkspaceSession) => s.data.books[0]!.id

describe('taking a snapshot', () => {
  it('copies the scene file byte for byte, with a manifest that lists it and the hash of the copy', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    await type(session, id, 'The bells had already started.')
    const path = session.pathOf(id)!
    const snap = await takeSnapshot(session, { kind: 'scene', id }, { name: 'Before the edit' })
    expect(snap).toMatchObject({
      kind: 'scene',
      target: id,
      name: 'Before the edit',
      reason: 'manual',
    })
    const original = (await adapter.read(path))!
    const copy = (await adapter.read(snapshotFilePath(snap.id, path)))!
    expect(copy.text).toBe(original.text)
    expect(copy.hash).toBe(original.hash)
    expect(snap.files).toEqual([{ path, hash: original.hash }])
    expect(await listSnapshots(adapter)).toMatchObject([
      { id: snap.id, complete: true, title: 'Untitled scene' },
    ])
  })

  it('keeps the words not yet saved, because those are what the author sees', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    await session.editScene(id, 'Not saved yet.') // debounce is far away: still only in the pipeline
    expect(session.pipeline.pendingText(session.pathOf(id)!)).toBeDefined()
    const snap = await takeSnapshot(session, { kind: 'scene', id })
    const text = await readSnapshot(adapter, snap)
    expect([...text.values()][0]).toContain('Not saved yet.')
  })

  it('a book snapshot keeps the book file, parts, chapters and scenes, and not the records', async () => {
    const { session, adapter } = rig
    await addScene(session, 'Second scene.')
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    const kinds = snap.files.map((f) => f.path.split('/').slice(-2)[0])
    expect(new Set(kinds)).toEqual(new Set([book(session), 'chapters', 'scenes']))
    expect(snap.files.filter((f) => f.path.includes('/scenes/'))).toHaveLength(2)
    expect(snap.files.some((f) => f.path.includes('/records/'))).toBe(false)
    expect(snap.files.some((f) => f.path.endsWith('/OUTLINE.md'))).toBe(false)
    expect((await listSnapshots(adapter))[0]!.complete).toBe(true)
  })

  it('never writes over a snapshot: two are two folders, and a repeated ID is refused with the first left whole', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    const a = await takeSnapshot(session, { kind: 'scene', id })
    const b = await takeSnapshot(session, { kind: 'scene', id })
    expect(a.id).not.toBe(b.id)
    await type(session, id, 'Changed.')
    vi.mocked(newId).mockReturnValue(a.id as ReturnType<typeof newId>) // every try lands on the first one
    await expect(takeSnapshot(session, { kind: 'scene', id })).rejects.toThrow(/could not make/)
    const kept = await readSnapshot(
      adapter,
      (await listSnapshots(adapter)).find((x) => x.id === a.id)!,
    )
    expect([...kept.values()][0]).not.toContain('Changed.')
  })

  it('a first ID that is taken is skipped: the snapshot gets the next one', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    const first = await takeSnapshot(session, { kind: 'scene', id })
    vi.mocked(newId).mockReturnValueOnce(first.id as ReturnType<typeof newId>)
    const second = await takeSnapshot(session, { kind: 'scene', id })
    expect(second.id).not.toBe(first.id)
    expect(await listSnapshots(adapter)).toHaveLength(2)
  })

  it('a stop before snapshot.json lists nothing and leaves no orphan copies', async () => {
    const { session, adapter } = rig
    adapter.beforeWrite = (p) => {
      if (p.endsWith('snapshot.json')) throw new StorageError('other', 'stopped')
    }
    await expect(takeSnapshot(session, { kind: 'scene', id: scene(session) })).rejects.toThrow(
      'stopped',
    )
    expect(await listSnapshots(adapter)).toEqual([])
    // the copies the stopped call wrote are taken away: nothing lists them, and they would sync for ever
    expect((await adapter.list()).filter((p) => p.startsWith('.aurelia/snapshots/'))).toEqual([])
  })

  it('a copy that does not read back the same is a failure, not a snapshot', async () => {
    const { session, adapter } = rig
    const write = adapter.writeBytes.bind(adapter)
    adapter.writeBytes = (p, bytes) => write(p, bytes.slice(0, -1)) // a disk that cuts the last byte
    await expect(takeSnapshot(session, { kind: 'scene', id: scene(session) })).rejects.toThrow(
      /none was made/,
    )
    expect(await listSnapshots(adapter)).toEqual([])
  })

  it('is refused in a workspace that cannot be written to', async () => {
    const locks = new FakeLocks()
    const a = await WorkspaceSession.open(rig.adapter, {
      journal: rig.journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    const b = await WorkspaceSession.open(rig.adapter, {
      journal: rig.journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    expect(b.readOnly).toBe(true)
    await expect(takeSnapshot(b, { kind: 'scene', id: scene(b) })).rejects.toThrow(StorageError)
    expect(await listSnapshots(rig.adapter)).toEqual([])
    a.dispose()
    b.dispose()
  })

  it('a name is one short line', () => {
    expect(cleanName('  two\nlines\t ')).toBe('two lines')
    expect(cleanName('x'.repeat(200))).toHaveLength(80)
    expect(cleanName('   ')).toBeUndefined()
  })

  it('a snapshot that did not arrive whole is listed as not complete and cannot be read', async () => {
    const { session, adapter } = rig
    const snap = await takeSnapshot(session, { kind: 'scene', id: scene(session) })
    await adapter.remove(snapshotFilePath(snap.id, snap.files[0]!.path))
    const [listed] = await listSnapshots(adapter)
    expect(listed!.complete).toBe(false)
    await expect(readSnapshot(adapter, listed!)).rejects.toThrow(/not all here/)
  })

  it('a file changed after the snapshot was made is not used', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    await type(session, id, 'As written.')
    const snap = await takeSnapshot(session, { kind: 'scene', id })
    await adapter.write(snapshotFilePath(snap.id, snap.files[0]!.path), 'tampered')
    await expect(restoreScene(session, snap.id, id)).rejects.toThrow(/not as it was saved/)
    expect(body(session, id)).toBe('As written.')
  })

  it('a manifest from a newer Aurelia is not listed and not touched', async () => {
    const { adapter, session } = rig
    const raw = JSON.stringify({ schemaVersion: 2, id: 'snp_abc', kind: 'scene' })
    await adapter.write(snapshotManifestPath('snp_abc'), raw)
    await takeSnapshot(session, { kind: 'scene', id: scene(session) })
    expect(await listSnapshots(adapter)).toHaveLength(1)
    expect((await adapter.read(snapshotManifestPath('snp_abc')))!.text).toBe(raw)
  })
})

describe('restoring a scene', () => {
  it('puts the words back after taking a "Before restore" snapshot of the words now, and leaves the details alone', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    await type(session, id, 'Old words.')
    const old = await takeSnapshot(session, { kind: 'scene', id })
    await setDetails(session, id, { title: 'A new title' })
    await type(session, id, 'New words that must not be lost.')
    const result = await restoreScene(session, old.id, id)
    expect(result.changed).toBe(true)
    expect(body(session, id)).toBe('Old words.')
    expect(session.data.scenes[0]!.meta.title).toBe('A new title') // details stay as they are now
    await session.flush()
    expect((await adapter.read(session.pathOf(id)!))!.text.endsWith('Old words.')).toBe(true)
    const before = (await listSnapshots(adapter)).find((x) => x.id === result.before)!
    expect(before.reason).toBe('before-restore')
    expect([...(await readSnapshot(adapter, before)).values()][0]).toContain(
      'New words that must not be lost.',
    )
  })

  it('the words typed and not yet saved when Restore is pressed are in the Before snapshot too', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    await type(session, id, 'Old.')
    const old = await takeSnapshot(session, { kind: 'scene', id })
    await session.editScene(id, 'Typed a second ago.')
    const result = await restoreScene(session, old.id, id)
    const before = (await listSnapshots(adapter)).find((x) => x.id === result.before)!
    expect([...(await readSnapshot(adapter, before)).values()][0]).toContain('Typed a second ago.')
  })

  it('an unchanged scene writes nothing and takes no snapshot', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    await type(session, id, 'Same.')
    const snap = await takeSnapshot(session, { kind: 'scene', id })
    expect(await restoreScene(session, snap.id, id)).toEqual({ changed: false })
    expect(await listSnapshots(adapter)).toHaveLength(1)
  })

  it('a scene with two versions waiting is refused, and nothing is written', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    await type(session, id, 'Old.')
    const snap = await takeSnapshot(session, { kind: 'scene', id })
    await session.editScene(id, 'Mine, unsaved.')
    const path = session.pathOf(id)!
    await adapter.write(path, `${(await adapter.read(path))!.text}Theirs.`)
    await session.checkScene(id)
    expect(session.view().conflicts).toHaveLength(1)
    await expect(restoreScene(session, snap.id, id)).rejects.toThrow(/two versions are waiting/)
    expect(body(session, id)).toBe('Mine, unsaved.')
    expect(await listSnapshots(adapter)).toHaveLength(1) // no Before snapshot either: nothing was going to change
    expect((await adapter.read(path))!.text.endsWith('Theirs.')).toBe(true)
  })

  it('a scene whose ID two files carry is refused: which one is the scene is for the author to say', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    await type(session, id, 'Old.')
    const snap = await takeSnapshot(session, { kind: 'scene', id })
    await type(session, id, 'Newer.')
    const path = session.pathOf(id)!
    const twin = path.replace(`${id}.md`, 'scn_twin000001.md')
    await adapter.write(twin, (await adapter.read(path))!.text)
    await session.refresh()
    expect(session.view().duplicates).toHaveLength(1)
    await expect(restoreScene(session, snap.id, id)).rejects.toThrow(/two files have its ID/)
    expect(body(session, id)).toBe('Newer.')
  })

  it('a save that fails stops the restore and says the words are kept', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    await type(session, id, 'Old.')
    const snap = await takeSnapshot(session, { kind: 'scene', id })
    await type(session, id, 'Newer.')
    const path = session.pathOf(id)!
    adapter.beforeWrite = (p) => {
      if (p === path) throw new StorageError('other', 'disk full')
    }
    await expect(restoreScene(session, snap.id, id)).rejects.toThrow(/kept safe/)
    adapter.beforeWrite = undefined
    expect((await listSnapshots(adapter)).some((x) => x.reason === 'before-restore')).toBe(true)
  })

  it('a scene the snapshot does not hold, or that is gone, is refused in words', async () => {
    const { session } = rig
    const first = scene(session)
    const snap = await takeSnapshot(session, { kind: 'scene', id: first })
    const second = await addScene(session, 'Other.')
    await expect(restoreScene(session, snap.id, second)).rejects.toThrow(/does not hold/)
    await expect(restoreScene(session, 'snp_nothere', first)).rejects.toThrow(/not there any more/)
  })
})

describe('restoring a book', () => {
  it('restores the text of changed scenes, keeps a scene made since, and says so', async () => {
    const { session, adapter } = rig
    const first = scene(session)
    await type(session, first, 'First, as it was.')
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    await type(session, first, 'First, rewritten.')
    const added = await addScene(session, 'Written after the snapshot.')
    const result = await restoreBook(session, snap.id)
    expect(result.restored).toEqual(['Untitled scene'])
    expect(result.kept).toEqual([session.data.scenes.find((x) => x.meta.id === added)!.meta.title])
    expect(body(session, first)).toBe('First, as it was.')
    expect(body(session, added)).toBe('Written after the snapshot.') // never deleted
    const before = (await listSnapshots(adapter)).find((x) => x.id === result.before)!
    const texts = [...(await readSnapshot(adapter, before)).values()].join('\n')
    expect(texts).toContain('First, rewritten.')
    expect(texts).toContain('Written after the snapshot.')
  })

  const purgeTrash = async () => {
    for (const p of await rig.adapter.list())
      if (p.startsWith('.aurelia/trash/')) await rig.adapter.remove(p)
  }

  it('a scene waiting in Recently deleted is left there: restoring would give it older words and block Put back', async () => {
    const { session, adapter } = rig
    const { chapter, scene: doomed } = await addChapter(session, book(session), {
      title: 'Chapter two',
    })
    await type(session, doomed, 'Soon deleted.')
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    await type(session, doomed, 'Newer words.')
    await deleteItem(session, chapter)
    const before = await adapter.list()
    const result = await restoreBook(session, snap.id)
    expect(result.skipped).toEqual([
      { title: 'Untitled scene', why: expect.stringMatching(/Recently deleted/) },
    ])
    expect(result.broughtBack).toEqual([])
    expect(await adapter.list()).toEqual(before) // nothing written, no snapshot made
  })

  it('brings back a scene deleted since (no longer in the trash), with the chapter it was in', async () => {
    const { session } = rig
    const { chapter, scene: doomed } = await addChapter(session, book(session), {
      title: 'Chapter two',
    })
    await type(session, doomed, 'Soon deleted.')
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    await deleteItem(session, chapter)
    await purgeTrash()
    await session.refresh()
    expect(session.pathOf(doomed)).toBeUndefined()
    const result = await restoreBook(session, snap.id)
    expect(result.broughtBack).toEqual(['Untitled scene'])
    expect(body(session, doomed)).toBe('Soon deleted.')
    expect(session.data.chapters.some((c) => c.id === chapter)).toBe(true)
    expect(session.data.scenes.find((x) => x.meta.id === doomed)!.meta.chapter).toBe(chapter)
    expect(
      session.current(session.pathOf(book(session))!.replace('book.json', 'OUTLINE.md')),
    ).toContain('Chapter two')
    const again = await rig.open()
    expect(body(again, doomed)).toBe('Soon deleted.')
  })

  it('a chapter deleted on purpose, with nothing coming back into it, stays deleted', async () => {
    const { session } = rig
    const first = scene(session)
    const { chapter: empty, scene: emptied } = await addChapter(session, book(session), {
      title: 'Empty chapter',
    })
    await deleteItem(session, emptied) // the chapter is left with no scene
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    await deleteItem(session, empty)
    await purgeTrash()
    await session.refresh()
    await type(session, first, 'Changed.')
    const result = await restoreBook(session, snap.id)
    expect(result.restored).toHaveLength(1)
    expect(session.data.chapters.some((c) => c.id === empty)).toBe(false)
    // and when only a chapter was deleted, there is nothing to change
    expect(await restoreBook(session, snap.id)).toMatchObject({
      restored: [],
      broughtBack: [],
      unchanged: 1,
    })
  })

  it('words typed while the restore runs are refused, never written over: they stay in the scene (scene and book)', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    await type(session, id, 'Old.')
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    for (const run of [
      () => restoreScene(session, snap.id, id),
      () => restoreBook(session, snap.id),
    ]) {
      await type(session, id, 'New.')
      let typed = false
      adapter.beforeWrite = (p) => {
        if (p.endsWith('snapshot.json') && !typed) {
          typed = true
          void session.editScene(id, 'New. TYPEDDURING')
        }
      }
      const result = await run().catch((e: Error) => e.message)
      adapter.beforeWrite = undefined
      expect(JSON.stringify(result)).toMatch(/typed in while the restore ran/)
      expect(body(session, id)).toBe('New. TYPEDDURING')
      await session.flush()
      expect((await adapter.read(session.pathOf(id)!))!.text).toContain('TYPEDDURING')
    }
  })

  it('one scene that cannot be saved does not stop the others, and the outline is still brought up to date', async () => {
    const { session, adapter } = rig
    const a = scene(session)
    const b = await addScene(session, 'B old.')
    const { chapter, scene: z } = await addChapter(session, book(session), { title: 'Chapter two' })
    await type(session, a, 'A old.')
    await type(session, z, 'Z old.')
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    await type(session, a, 'A new.')
    await type(session, b, 'B new.')
    await deleteItem(session, chapter)
    await purgeTrash()
    await session.refresh()
    const pathA = session.pathOf(a)!
    adapter.beforeWrite = (p) => {
      if (p === pathA) throw new StorageError('other', 'disk full')
    }
    const result = await restoreBook(session, snap.id)
    adapter.beforeWrite = undefined
    expect(result.skipped).toEqual([
      { title: 'Untitled scene', why: 'it could not be saved just yet' },
    ])
    expect(result.restored).toHaveLength(1)
    expect(body(session, b)).toBe('B old.')
    expect(body(session, a)).toBe('A new.') // put back as it was, not left half-restored
    expect(body(session, z)).toBe('Z old.')
    expect(session.current(pathA.replace(/scenes\/.*/, 'OUTLINE.md'))).toContain('Chapter two')
  })

  it('a manifest naming a path outside its book is not a snapshot, and nothing is written there', async () => {
    const { session, adapter } = rig
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    for (const evil of [
      '../outside/x.md',
      '.aurelia/elsewhere/x.md',
      'universes/unv_x/books/bok_x/../../../../outside.md',
    ]) {
      const hash = await hashText('planted')
      const raw = JSON.parse((await adapter.read(snapshotManifestPath(snap.id)))!.text)
      const id = `snp_evil${evil.length}`
      await adapter.write(snapshotFilePath(id, evil), 'planted')
      await adapter.write(
        snapshotManifestPath(id),
        JSON.stringify({ ...raw, id, files: [...raw.files, { path: evil, hash }] }),
      )
      expect((await listSnapshots(adapter)).some((x) => x.id === id)).toBe(false)
      await expect(restoreBook(session, id)).rejects.toThrow(/not there any more/)
    }
    expect(await adapter.read('../outside/x.md').catch(() => null)).toBeNull()
    expect(
      (await adapter.list()).filter(
        (p) =>
          !p.startsWith('.aurelia/snapshots/') &&
          (p.startsWith('.aurelia/elsewhere') || p.endsWith('outside.md')),
      ),
    ).toEqual([])
  })

  it('a later version’s reason is still listed', async () => {
    const { session, adapter } = rig
    const snap = await takeSnapshot(session, { kind: 'scene', id: scene(session) })
    const raw = JSON.parse((await adapter.read(snapshotManifestPath(snap.id)))!.text)
    await adapter.write(
      snapshotManifestPath(snap.id),
      JSON.stringify({ ...raw, reason: 'before-accept' }),
    )
    expect((await listSnapshots(adapter))[0]!.reason).toBe('before-accept')
  })

  it('a file that is not text does not make every book snapshot "still arriving"', async () => {
    const { session, adapter } = rig
    const bad = session.pathOf(book(session))!.replace('book.json', 'chapters/chp_bad0000001.md')
    adapter.putBytes(bad, new Uint8Array([0xff, 0xfe, 0xfd]))
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    expect(snap.files.some((f) => f.path === bad)).toBe(false)
    const [listed] = await listSnapshots(adapter)
    expect(listed!.complete).toBe(true)
    await expect(readSnapshot(adapter, listed!)).resolves.toBeInstanceOf(Map)
  })

  it('a scene with two versions waiting is skipped and named; the others are restored', async () => {
    const { session, adapter } = rig
    const a = scene(session)
    const b = await addScene(session, 'B old.')
    await type(session, a, 'A old.')
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    await type(session, b, 'B new.')
    await session.editScene(a, 'A mine, unsaved.')
    const path = session.pathOf(a)!
    await adapter.write(path, `${(await adapter.read(path))!.text}Theirs.`)
    await session.checkScene(a)
    const result = await restoreBook(session, snap.id)
    expect(result.skipped).toEqual([
      { title: 'Untitled scene', why: expect.stringMatching(/two versions/) },
    ])
    expect(result.restored).toHaveLength(1)
    expect(body(session, b)).toBe('B old.')
    expect(body(session, a)).toBe('A mine, unsaved.')
  })

  it('does nothing, and makes no snapshot, when every scene already reads the same', async () => {
    const { session, adapter } = rig
    const snap = await takeSnapshot(session, { kind: 'book', id: book(session) })
    const result = await restoreBook(session, snap.id)
    expect(result).toMatchObject({ restored: [], broughtBack: [], unchanged: 1 })
    expect(result.before).toBeUndefined()
    expect(await listSnapshots(adapter)).toHaveLength(1)
  })

  it('a book that is in the trash is refused in words', async () => {
    const { session } = rig
    const other = await addBook(session, { title: 'Second' })
    const snap = await takeSnapshot(session, { kind: 'book', id: other.book })
    await deleteItem(session, other.book)
    await expect(restoreBook(session, snap.id)).rejects.toThrow(/Recently deleted/)
  })

  it('never loses a word: after random edits and restores, every word ever saved is in a file or a snapshot', async () => {
    const { session, adapter } = rig
    const id = scene(session)
    let seed = 11
    const rand = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n
    const said = new Set<string>()
    const snaps: string[] = []
    for (let i = 0; i < 25; i++) {
      const op = rand(4)
      if (op === 0) {
        const word = `w${i}x${rand(1000)}`
        said.add(word)
        await type(session, id, `${body(session, id)} ${word}`)
      } else if (op === 1) snaps.push((await takeSnapshot(session, { kind: 'scene', id })).id)
      else if (op === 2 && snaps.length) await restoreScene(session, snaps[rand(snaps.length)]!, id)
      else if (snaps.length)
        await restoreBook(session, snaps[rand(snaps.length)]!).catch(() => undefined)
    }
    const everything: string[] = []
    for (const p of await adapter.list()) everything.push((await adapter.read(p))!.text)
    const all = everything.join('\n')
    for (const word of said) expect(all, `word ${word} was lost`).toContain(word)
    // and every snapshot still passes its own hash check
    for (const snap of await listSnapshots(adapter))
      for (const f of snap.files)
        expect(await hashText((await adapter.read(snapshotFilePath(snap.id, f.path)))!.text)).toBe(
          f.hash,
        )
  })
})
