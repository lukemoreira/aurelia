// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { bookOutline } from '@/domain/outline'
import { storyFindings, storyGraph } from '@/domain/story-graph'
import { planFromFiles } from '@/import/sources'
import { changes, outlineRig, snapshot } from '../../tests/helpers/outline-rig'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { WorkspaceSession } from './session'
import { createImportedWorkspace, importBook } from './import-actions'
import { loadWorkspace } from './load'
import { WORKSPACE_FILE } from './paths'

const enc = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>
const file = (path: string, text: string) => ({
  path,
  size: text.length,
  read: async () => enc(text),
})

const TWEE =
  ':: StoryTitle\nTwo doors\n\n:: StoryData\n{"start":"Hall"}\n\n:: Hall\nA hall. [[Left->Left door]] [[Right door]]\n\n:: Left door\nA dead end. [[Back->Hall]]\n\n:: Right door\nThe end.\n'
const plan = (files: { path: string; text: string }[], name = 'Imported') =>
  planFromFiles(
    files.map((f) => file(f.path, f.text)),
    name,
  )

describe('importing into an open workspace', () => {
  it('makes a new book with its chapters, scenes and text, and changes nothing that was there', async () => {
    const rig = await outlineRig()
    const before = await snapshot(rig.adapter)
    const made = await importBook(
      rig.session,
      await plan([
        { path: 'One/a.md', text: '# First\n\nWords of the first.\n' },
        { path: 'Two/b.md', text: 'Words of the second.' },
      ]),
      { title: 'Brought in' },
    )
    await rig.session.flush()
    const diff = changes(before, await snapshot(rig.adapter))
    expect(diff.removed).toEqual([])
    // Only what lists the new book is changed: the workspace file. Every other change is a new file.
    expect(diff.changed).toEqual([WORKSPACE_FILE])
    expect(diff.added.length).toBeGreaterThan(5)

    const loaded = await loadWorkspace(rig.adapter)
    expect(loaded.problems).toEqual([])
    expect(loaded.duplicates).toEqual([])
    const book = loaded.data.books.find((b) => b.id === made.book)!
    expect(book.title).toBe('Brought in')
    expect(
      bookOutline(loaded.data, made.book).flatMap((g) => g.chapters.map((c) => c.chapter.title)),
    ).toEqual(['One', 'Two'])
    const first = loaded.data.scenes.find((s) => s.meta.id === made.scene)!
    expect(first.meta.title).toBe('First')
    expect(first.body).toBe('Words of the first.\n')
    // The derived files are in step.
    expect(book.outline).toHaveLength(2)
    expect(
      await rig.adapter.read(
        `universes/${loaded.data.universes.find((u) => u.books.includes(made.book))!.id}/books/${made.book}/OUTLINE.md`,
      ),
    ).toBeTruthy()
  })

  it('adds the book to a shared universe when asked', async () => {
    const rig = await outlineRig()
    const universe = rig.session.data.universes[0]!
    await rig.session.setFields(universe.id, { kind: 'shared' })
    const made = await importBook(rig.session, await plan([{ path: 'a.md', text: 'x' }]), {
      universeId: universe.id,
    })
    await rig.session.flush()
    const loaded = await loadWorkspace(rig.adapter)
    expect(loaded.data.universes).toHaveLength(1)
    expect(loaded.data.universes[0]!.books).toContain(made.book)
  })

  it('a Twine story is a branching book with its start, its choices and no problems in the story graph', async () => {
    const rig = await outlineRig()
    const made = await importBook(rig.session, await plan([{ path: 'two.twee', text: TWEE }]))
    await rig.session.flush()
    const { data } = await loadWorkspace(rig.adapter)
    const book = data.books.find((b) => b.id === made.book)!
    expect(book.mode).toBe('branching')
    const hall = data.scenes.find((s) => s.meta.title === 'Hall')!
    expect(book.start).toBe(hall.meta.id)
    expect(made.scene).toBe(hall.meta.id)
    expect(hall.meta.choices?.map((c) => c.label)).toEqual(['Left', 'Right door'])
    for (const c of hall.meta.choices ?? [])
      expect(data.scenes.some((s) => s.meta.id === c.target)).toBe(true)
    expect(data.scenes.find((s) => s.meta.title === 'Right door')!.meta.ending).toBe(true)
    expect(storyFindings(storyGraph(data, made.book))).toEqual([])
  })

  it('refuses a name that is not one, before writing anything', async () => {
    const rig = await outlineRig()
    const before = await snapshot(rig.adapter)
    const p = await plan([{ path: 'a.md', text: 'x' }])
    await expect(importBook(rig.session, p, { title: '   ' })).rejects.toThrow(
      /Give the book a name/,
    )
    await expect(importBook(rig.session, p, { title: 'a\nb' })).rejects.toThrow(/hidden characters/)
    await expect(importBook(rig.session, p, { title: 'x'.repeat(201) })).rejects.toThrow(
      /under 200/,
    )
    expect(changes(before, await snapshot(rig.adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('is refused in words on a workspace that a newer version made, and writes nothing', async () => {
    const { session, adapter, journal } = await outlineRig()
    const before = await snapshot(adapter)
    const scenePath = session.pathOf(session.data.scenes[0]!.meta.id)!
    await adapter.write(
      scenePath,
      before.get(scenePath)!.replace('schemaVersion: 1', 'schemaVersion: 2'),
    )
    const newer = await WorkspaceSession.open(adapter, { journal, debounceMs: 1e9 })
    await expect(importBook(newer, await plan([{ path: 'a.md', text: 'x' }]))).rejects.toThrow(
      /newer version/,
    )
    await adapter.write(scenePath, before.get(scenePath)!)
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('a stop at any write leaves the workspace readable and every book that was there whole', async () => {
    const p = await plan([
      { path: 'One/a.md', text: 'First.' },
      { path: 'Two/b.md', text: 'Second.' },
    ])
    const probe = await outlineRig()
    let writes = 0
    probe.adapter.beforeWrite = () => void writes++
    await importBook(probe.session, p)
    await probe.session.flush()
    expect(writes).toBeGreaterThan(6)
    for (let stop = 1; stop <= writes; stop++) {
      const rig = await outlineRig()
      const first = rig.session.data.books[0]!.id
      let n = 0
      rig.adapter.beforeWrite = () => {
        if (++n === stop) throw new Error('stopped')
      }
      await importBook(rig.session, p).catch(() => undefined)
      rig.adapter.beforeWrite = undefined
      await rig.session.flush().catch(() => undefined)
      const loaded = await loadWorkspace(rig.adapter)
      expect(loaded.problems, `stop ${stop}`).toEqual([])
      expect(
        loaded.data.books.some((b) => b.id === first),
        `stop ${stop}`,
      ).toBe(true)
      // A book that has its file is in some universe: a stop never leaves one hidden (and a retry a second).
      for (const book of loaded.data.books)
        expect(
          loaded.data.universes.some((u) => u.books.includes(book.id)),
          `stop ${stop}: ${book.title}`,
        ).toBe(true)
    }
  })
})

describe('importing from the Welcome screen', () => {
  it('writes a workspace that holds the book alone, with aurelia.json last', async () => {
    const adapter = new MemoryAdapter()
    const order: string[] = []
    adapter.beforeWrite = (path) => void order.push(path)
    await createImportedWorkspace(adapter, 'Fresh', await plan([{ path: 'a.md', text: 'x' }]))
    expect(order.at(-1)).toBe(WORKSPACE_FILE)
    expect(order.indexOf(WORKSPACE_FILE)).toBe(order.length - 1)
    const loaded = await loadWorkspace(adapter)
    expect(loaded.problems).toEqual([])
    expect(loaded.data.workspace.name).toBe('Fresh')
    // The book has the name the author gave, not the one the files came with.
    expect(loaded.data.books[0]!.title).toBe('Fresh')
    expect(loaded.data.books).toHaveLength(1)
    expect(loaded.data.scenes).toHaveLength(1)
  })
})
