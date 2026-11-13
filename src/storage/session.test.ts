// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newId } from '@/domain/ids'
import { FakeLocks } from '../../tests/helpers/fake-locks'
import { readZip } from '../../tests/helpers/read-zip'
import { checkWorkspaceName, createWorkspace, inspectFolder } from './create'
import { openDeviceDb } from './device-db'
import { splitDocument } from './frontmatter'
import { hashText } from './hash'
import { IdbJournal } from './journal'
import { loadWorkspace } from './load'
import { copyPathFor } from './paths'
import { gateRead } from '../../tests/helpers/gate-read'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { WorkspaceSession } from './session'

// Pass-through, so a test can force an ID (a collision) for one call.
vi.mock('@/domain/ids', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/domain/ids')>()
  return { ...real, newId: vi.fn(real.newId) }
})

let adapter: MemoryAdapter
let journal: IdbJournal

const open = (a = adapter) => WorkspaceSession.open(a, { journal, debounceMs: 1e9 })
const scenePathOf = async (a = adapter) =>
  (await a.list()).find((p) => /\/scenes\/scn_\w+\.md$/.test(p))!

const lastLine = (text: string | undefined) => text?.split('\n').at(-1)

beforeEach(async () => {
  adapter = new MemoryAdapter()
  const db = openDeviceDb(new IDBFactory())
  journal = new IdbJournal(() => db)
  await createWorkspace(adapter, 'My Book')
})

describe('creating and loading a workspace', () => {
  it('writes the minimal valid workspace of ADR-0003 and reads it back', async () => {
    const loaded = await loadWorkspace(adapter)
    const { data } = loaded
    expect(data.workspace.name).toBe('My Book')
    expect([
      data.universes.length,
      data.books.length,
      data.chapters.length,
      data.scenes.length,
    ]).toEqual([1, 1, 1, 1])
    expect(data.universes[0]?.kind).toBe('standalone')
    expect(loaded.problems).toEqual([])
    expect(loaded.readOnly).toBe(false)
    const paths = await adapter.list()
    expect(paths).toContain('aurelia.json')
    expect(paths.filter((p) => p.endsWith('.md'))).toHaveLength(4) // the derived OUTLINE.md too
  })

  it('tells a workspace, an empty folder and a folder of other files apart', async () => {
    expect(await inspectFolder(adapter)).toEqual({ state: 'workspace' })
    expect(await inspectFolder(new MemoryAdapter({ '.DS_Store': 'x' }))).toEqual({ state: 'empty' })
    expect(
      await inspectFolder(new MemoryAdapter({ 'photos/a.jpg': 'x', 'notes.txt': 'y' })),
    ).toEqual({
      state: 'other',
      names: ['photos/', 'notes.txt'],
    })
  })

  it('shows a file it cannot read by path and never drops it', async () => {
    const path = await scenePathOf()
    adapter.putBytes(
      'universes/unv_aaaaaaaaaa/books/bok_aaaaaaaaaa/scenes/scn_bbbbbbbbbb.md',
      new Uint8Array([0xff, 0xfe, 0x41]),
    )
    await adapter.write(
      'universes/unv_aaaaaaaaaa/books/bok_aaaaaaaaaa/scenes/scn_cccccccccc.md',
      '---\ntitle: [oops\n---\n',
    )
    const { problems, data } = await loadWorkspace(adapter)
    expect(problems.map((p) => p.path).sort()).toEqual([
      'universes/unv_aaaaaaaaaa/books/bok_aaaaaaaaaa/scenes/scn_bbbbbbbbbb.md',
      'universes/unv_aaaaaaaaaa/books/bok_aaaaaaaaaa/scenes/scn_cccccccccc.md',
    ])
    expect(data.scenes).toHaveLength(1)
    expect(await adapter.read(path)).not.toBeNull()
    // Plain words first, then the parser's own line, which a hand-editing author needs.
    expect(problems.map((p) => p.reason)).toEqual([
      expect.stringMatching(/^Aurelia could not read this file\. /),
      expect.stringMatching(/^Aurelia could not read this file\. The problem is near line 1: /),
    ])
  })

  it('shows two files with one ID to the author instead of picking one', async () => {
    const path = await scenePathOf()
    const text = (await adapter.read(path))!.text
    const twin = path.replace(/scn_\w+\.md$/, 'scn_zzzzzzzzzz.md')
    await adapter.write(twin, text)
    const { problems, data, duplicates } = await loadWorkspace(adapter)
    expect(data.scenes).toHaveLength(1)
    expect(problems).toEqual([])
    expect(duplicates).toEqual([
      {
        id: data.scenes[0]!.meta.id,
        files: [
          { path, title: 'Untitled scene' },
          { path: twin, title: 'Untitled scene' },
        ],
      },
    ])
  })

  it('opens read-only, and refuses every write, when a file has a newer schemaVersion', async () => {
    const path = await scenePathOf()
    const text = (await adapter.read(path))!.text.replace('schemaVersion: 1', 'schemaVersion: 2')
    await adapter.write(path, text)
    const session = await open()
    expect(session.readOnly).toBe(true)
    expect(session.data.scenes).toHaveLength(1) // still shown, so nothing seems to vanish
    const id = session.data.scenes[0]!.meta.id
    await session.editScene(id, 'new words')
    await expect(session.createScene(session.data.chapters[0]!.id)).rejects.toThrow()
    await expect(session.adapter.write('x.md', 'y')).rejects.toMatchObject({ code: 'read-only' })
    await expect(session.adapter.remove(path)).rejects.toMatchObject({ code: 'read-only' })
    expect((await adapter.read(path))!.text).toBe(text)
    expect(await journal.list(session.data.workspace.id)).toEqual([])
  })
})

describe('editing a scene', () => {
  it('replaces only the body: the frontmatter stays byte for byte, comments and key order included', async () => {
    const path = await scenePathOf()
    const original = (await adapter.read(path))!.text
    const head = splitDocument(original)!.head
    const handWritten = head.replace('---\n\n', '# my note\nmood: "tense"   # keep me\n---\n\n')
    await adapter.write(path, `${handWritten}First draft.\n`)
    const session = await open()
    const id = session.data.scenes[0]!.meta.id
    await session.editScene(id, 'The bells had already started.\n\nSecond paragraph.')
    await session.flush()
    const saved = (await adapter.read(path))!.text
    expect(saved).toBe(`${handWritten}The bells had already started.\n\nSecond paragraph.`)
    expect(saved.startsWith(handWritten)).toBe(true)
    expect(session.data.scenes[0]?.words).toBe(7)
  })

  it('keeps a Windows file’s line endings', async () => {
    const path = await scenePathOf()
    const head = splitDocument((await adapter.read(path))!.text)!.head.replace(/\n/g, '\r\n')
    await adapter.write(path, `${head}one\r\ntwo`)
    const session = await open()
    const scene = session.data.scenes[0]!
    expect(scene.body).toBe('one\ntwo') // the editor always sees \n
    await session.editScene(scene.meta.id, 'one\ntwo\nthree')
    await session.flush()
    expect((await adapter.read(path))!.text).toBe(`${head}one\r\ntwo\r\nthree`)
  })

  it('does not write a scene that was never edited', async () => {
    const path = await scenePathOf()
    const before = (await adapter.read(path))!.hash
    const session = await open()
    await session.flush()
    await session.checkAll()
    expect((await adapter.read(path))!.hash).toBe(before)
  })

  it('creates a new scene after the last one, with a real ID and a fractional order', async () => {
    const session = await open()
    const chapter = session.data.chapters[0]!
    const first = session.data.scenes[0]!
    const id = await session.createScene(chapter.id)
    const scene = session.data.scenes.find((s) => s.meta.id === id)!
    expect(scene.meta.id).toMatch(/^scn_[a-z0-9]{10}$/)
    expect(scene.meta.order > first.meta.order).toBe(true)
    expect(scene.meta.title).toBe('Untitled scene 2')
    const reloaded = await loadWorkspace(adapter)
    expect(reloaded.data.scenes.map((s) => s.meta.id)).toContain(id)
    expect(session.pipeline.summary().kind).toBe('saved')
  })
})

describe('changes outside Aurelia', () => {
  it('reloads the open scene in place when it changed and nothing is unsaved, with a note', async () => {
    const path = await scenePathOf()
    const session = await open()
    const id = session.data.scenes[0]!.meta.id
    const text = (await adapter.read(path))!.text
    await adapter.write(path, `${text}Typed in another app.`)
    await session.checkScene(id)
    expect(session.data.scenes[0]?.body).toBe('Typed in another app.')
    expect(session.view().notes.map((n) => n.id)).toContain('external')
    expect(session.view().save.kind).toBe('saved')
  })

  it('opens the conflict flow instead when there are unsaved edits, and overwrites nothing', async () => {
    const path = await scenePathOf()
    const session = await open()
    const id = session.data.scenes[0]!.meta.id
    await session.editScene(id, 'my unsaved words')
    const text = (await adapter.read(path))!.text
    await adapter.write(path, `${text}their words`)
    await session.checkScene(id)
    const view = session.view()
    expect(view.save.kind).toBe('conflict')
    expect(view.conflicts[0]).toMatchObject({ title: 'Untitled scene' })
    expect(view.conflicts[0]?.mine.endsWith('my unsaved words')).toBe(true)
    expect(view.conflicts[0]?.theirs?.endsWith('their words')).toBe(true)
    expect((await adapter.read(path))!.text).toBe(`${text}their words`)
    expect(session.data.scenes[0]?.body).toBe('my unsaved words') // the author still sees their text
  })

  it('finds conflicted copies on load and on focus, and reconciles them without deleting anything', async () => {
    const path = await scenePathOf()
    const copy = path.replace('.md', ' (conflicted copy).md')
    const original = (await adapter.read(path))!.text
    await adapter.write(copy, `${original}the other device`)
    await adapter.write('universes/x/book.json (conflicted copy)', '{}')
    const session = await open()
    expect(
      session
        .view()
        .copies.map((c) => c.path)
        .sort(),
    ).toEqual([copy, 'universes/x/book.json (conflicted copy)'].sort())
    expect(session.view().copies.find((c) => c.path === copy)?.original).toBe(path)
    expect(session.data.scenes).toHaveLength(1) // a copy is not read as a second scene

    await adapter.write(
      path.replace(/scn_(\w+)\.md$/, 'scn_$1 (Dropbox conflicted copy 2026-11-12).md'),
      'x',
    )
    await session.checkAll() // the focus check finds the new one
    expect(session.view().copies).toHaveLength(3)

    // Keep the original: the copy moves to .aurelia/conflicts.
    await session.reconcileCopy(copy, 'original')
    expect((await adapter.list()).some((p) => p === copy)).toBe(false)
    const moved = (await adapter.list()).filter((p) => p.startsWith('.aurelia/conflicts/'))
    expect(moved).toHaveLength(1)
    expect((await adapter.read(moved[0]!))!.text).toBe(`${original}the other device`)
    expect((await adapter.read(path))!.text).toBe(original)
  })

  it('keeping the copy sets the original aside in .aurelia/conflicts and puts the copy in its place', async () => {
    const path = await scenePathOf()
    const original = (await adapter.read(path))!.text
    const copy = path.replace('.md', ' (conflicted copy).md')
    await adapter.write(copy, `${original}the other device`)
    const session = await open()
    await session.reconcileCopy(copy, 'copy')
    expect((await adapter.read(path))!.text).toBe(`${original}the other device`)
    expect(session.data.scenes[0]?.body).toBe('the other device')
    const kept = (await adapter.list()).filter((p) => p.startsWith('.aurelia/conflicts/'))
    expect(kept).toHaveLength(2)
    const texts = await Promise.all(kept.map(async (p) => (await adapter.read(p))!.text))
    expect(texts).toContain(original)
    expect((await adapter.list()).includes(copy)).toBe(false)
  })

  it('the conflict choice "use the file’s version" leaves a copy and shows the file’s text', async () => {
    const path = await scenePathOf()
    const session = await open()
    const id = session.data.scenes[0]!.meta.id
    await session.editScene(id, 'mine')
    await adapter.write(path, `${(await adapter.read(path))!.text}theirs`)
    await session.checkScene(id)
    await session.resolveConflict(path, 'theirs')
    expect(session.data.scenes[0]?.body).toBe('theirs')
    expect(session.view().copies).toHaveLength(1) // the Aurelia copy is found like any conflicted copy
    expect(session.view().save.kind).toBe('saved')
  })

  it('shows the file’s text the moment "use the file’s version" lands, so a key typed while the files are read again goes on it', async () => {
    const path = await scenePathOf()
    const session = await open()
    const id = session.data.scenes[0]!.meta.id
    await session.editScene(id, 'mine')
    await adapter.write(path, `${(await adapter.read(path))!.text}theirs`)
    await session.checkScene(id)
    const gate = gateRead(adapter, path)
    const resolving = session.resolveConflict(path, 'theirs')
    await vi.waitFor(() => expect(gate.isHeld()).toBe(true))
    expect(session.view().conflicts).toHaveLength(0)
    expect(session.data.scenes[0]?.body).toBe('theirs') // not "mine": the textarea shows this
    await session.editScene(id, `${session.data.scenes[0]!.body}!`) // one keystroke
    gate.release()
    await resolving
    await session.flush()
    expect(session.view().save.kind).toBe('saved')
    expect(lastLine((await adapter.read(path))?.text)).toBe('theirs!')
    const texts = await Promise.all(
      (await adapter.list()).map(async (p) => (await adapter.read(p))!.text),
    )
    expect(texts.some((t) => lastLine(t) === 'mine')).toBe(true) // the author's version is a copy
  })

  it('"use the file’s version" of a file that is not a scene does not let a key overwrite it', async () => {
    const path = await scenePathOf()
    const session = await open()
    const id = session.data.scenes[0]!.meta.id
    await session.editScene(id, 'mine')
    await adapter.write(path, 'garbage: [')
    await session.checkScene(id)
    const gate = gateRead(adapter, path)
    const resolving = session.resolveConflict(path, 'theirs')
    await vi.waitFor(() => expect(gate.isHeld()).toBe(true))
    await session.editScene(id, 'typed during the re-read') // refused: there is no readable head
    gate.release()
    await resolving
    await session.flush()
    expect((await adapter.read(path))!.text).toBe('garbage: [')
    expect(session.view().problems.map((p) => p.path)).toContain(path)
    const copies = await Promise.all(
      (await adapter.list())
        .filter((p) => p !== path)
        .map(async (p) => (await adapter.read(p))!.text),
    )
    expect(copies.some((t) => t.endsWith('mine'))).toBe(true) // the author's version is kept as a copy
  })

  it('still shows the file’s text, and says so, when the files cannot be read again afterwards', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const path = await scenePathOf()
    const session = await open()
    const id = session.data.scenes[0]!.meta.id
    await session.editScene(id, 'mine')
    await adapter.write(path, `${(await adapter.read(path))!.text}theirs`)
    await session.checkScene(id)
    adapter.list = async () => {
      throw new Error('boom')
    }
    await session.resolveConflict(path, 'theirs') // the choice was made: this does not throw
    expect(session.data.scenes[0]?.body).toBe('theirs')
    expect(session.view().notes.map((n) => n.id)).toContain('refresh-failed')
  })
})

describe('losing the folder', () => {
  it('queues edits in the journal while access is gone, and saves them when it returns', async () => {
    const session = await open()
    const id = session.data.scenes[0]!.meta.id
    adapter.accessLost = true
    await session.checkScene(id)
    expect(session.view().permissionLost).toBe(true)
    await session.editScene(id, 'typed offline')
    await session.flush()
    expect(await journal.list(session.data.workspace.id)).toHaveLength(1)
    adapter.accessLost = false
    expect(await session.reconnect()).toBe(true)
    expect(session.view().permissionLost).toBe(false)
    expect(session.view().save.kind).toBe('saved')
    expect((await adapter.read(await scenePathOf()))!.text.endsWith('typed offline')).toBe(true)
  })
})

describe('recovery on open', () => {
  it('finishes a write the last session never completed and tells the author once', async () => {
    const path = await scenePathOf()
    const base = await hashText((await adapter.read(path))!.text)
    const text = (await adapter.read(path))!.text + 'words typed just before the crash'
    await journal.put({
      workspaceId: (await loadWorkspace(adapter)).data.workspace.id,
      path,
      content: text,
      baseHash: base,
      time: 1,
    })
    const session = await open()
    expect((await adapter.read(path))!.text).toBe(text)
    expect(session.data.scenes[0]?.body).toBe('words typed just before the crash')
    expect(session.view().notes.find((n) => n.id === 'recovered')?.text).toContain('Untitled scene')
  })

  it('shows the author’s text and the conflict when the file changed since', async () => {
    const path = await scenePathOf()
    const base = await hashText((await adapter.read(path))!.text)
    const mine = (await adapter.read(path))!.text + 'mine'
    await journal.put({
      workspaceId: (await loadWorkspace(adapter)).data.workspace.id,
      path,
      content: mine,
      baseHash: base,
      time: 1,
    })
    await adapter.write(path, `${(await adapter.read(path))!.text}theirs`)
    const session = await open()
    expect(session.view().save.kind).toBe('conflict')
    expect(session.data.scenes[0]?.body).toBe('mine')
    expect((await adapter.read(path))!.text.endsWith('theirs')).toBe(true)
  })
})

describe('download a copy', () => {
  it('zips every file, including text that has not been saved yet', async () => {
    const session = await open()
    const id = session.data.scenes[0]!.meta.id
    adapter.accessLost = false
    await session.editScene(id, 'unsaved words')
    const zip = new Uint8Array(await (await session.exportZip()).arrayBuffer())
    const files = readZip(zip)
    expect(files.every((f) => f.crcOk)).toBe(true)
    expect(files.map((f) => f.path).sort()).toEqual(
      (await adapter.list()).map((p) => `My Book/${p}`).sort(),
    )
    expect(files.find((f) => f.path.includes('/scenes/'))?.text.endsWith('unsaved words')).toBe(
      true,
    )
  })
})

describe('a save that finishes while the files are being read', () => {
  it.each(['checkAll', 'refresh'] as const)(
    '%s does not put the old text back, and the next save is not a conflict',
    async (way) => {
      const path = await scenePathOf()
      const session = await open()
      const id = session.data.scenes[0]!.meta.id
      const oldHash = (await adapter.read(path))!.hash
      await session.editScene(id, 'the newest words')
      // The load reads the file (old bytes), then waits; the save lands meanwhile.
      const read = adapter.read.bind(adapter)
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      let held = false
      adapter.read = async (p) => {
        const found = await read(p)
        if (p === path && !held) {
          held = true
          await gate
        }
        return found
      }
      const loading = session[way]()
      await vi.waitFor(() => expect(held).toBe(true))
      await session.flush()
      release()
      await loading
      const newHash = (await adapter.read(path))!.hash
      expect(newHash).not.toBe(oldHash)
      expect(session.data.scenes[0]?.body).toBe('the newest words')
      expect(session.pipeline.known.get(path)).toBe(newHash)
      expect(session.view().notes).toEqual([])
      await session.editScene(id, 'the newest words, and more')
      await session.flush()
      expect(session.view().save.kind).toBe('saved')
      expect((await adapter.read(path))!.text.endsWith('the newest words, and more')).toBe(true)
    },
  )
})

describe('one tab writes a workspace', () => {
  const lockName = (s: WorkspaceSession) => `aurelia-workspace:${s.data.workspace.id}`

  it('a second tab opens read-only with its own banner state, and writes after the first lets go', async () => {
    const locks = new FakeLocks()
    const a = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    expect(locks.isHeld(lockName(a))).toBe(true)
    expect(a.view()).toMatchObject({ readOnly: false, otherTab: false })

    const b = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    expect(b.view()).toMatchObject({ readOnly: true, otherTab: true, newerVersion: false })
    const id = b.data.scenes[0]!.meta.id
    await b.editScene(id, 'typed in the second tab')
    const path = await scenePathOf()
    expect((await adapter.read(path))!.text).not.toContain('typed in the second tab')
    expect(await journal.list(b.data.workspace.id)).toEqual([])

    await a.editScene(id, 'written in the first tab')
    await a.flush()
    a.dispose() // the first tab closes
    await vi.waitFor(() => expect(b.view().otherTab).toBe(false))
    await vi.waitFor(() => expect(b.data.scenes[0]?.body).toBe('written in the first tab'))
    expect(b.view().readOnly).toBe(false)
    await b.editScene(id, 'now the second tab writes')
    await b.flush()
    expect((await adapter.read(path))!.text.endsWith('now the second tab writes')).toBe(true)
    b.dispose()
    await vi.waitFor(() => expect(locks.isHeld(lockName(b))).toBe(false))
  })

  it('a tab that has just taken over cannot type until the dead tab’s words are settled', async () => {
    const path = await scenePathOf()
    const locks = new FakeLocks()
    const a = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    const b = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    const id = b.data.scenes[0]!.meta.id
    // Tab A died with words in the journal, based on the file as it is now.
    const disk = (await adapter.read(path))!
    await journal.put({
      workspaceId: b.data.workspace.id,
      path,
      content: `${disk.text}from the journal`,
      baseHash: disk.hash,
      time: 0,
    })
    const gate = gateRead(adapter, path)
    a.dispose()
    await vi.waitFor(() => expect(gate.isHeld()).toBe(true)) // taken over, still reading
    expect(b.view().readOnly).toBe(true)
    expect(b.view().otherTab).toBe(false) // not "open in another tab": it is only settling
    await b.editScene(id, 'typed too early') // refused: it would replace the journal's words
    await expect(b.createScene(b.data.chapters[0]!.id)).rejects.toThrow()
    gate.release()
    await vi.waitFor(() => expect(b.view().readOnly).toBe(false))
    expect(lastLine((await adapter.read(path))?.text)).toBe('from the journal')
    expect(await journal.list(b.data.workspace.id)).toEqual([])
    await b.editScene(id, 'typed after')
    await b.flush()
    expect(lastLine((await adapter.read(path))?.text)).toBe('typed after')
  })

  /** Two tabs; the first writes `ahead` to the file (if given), then dies with `words` in the journal. */
  async function deadTabWithWords(words: string, ahead?: string) {
    const path = await scenePathOf()
    const locks = new FakeLocks()
    const deps = { journal, debounceMs: 1e9, locks: locks.asManager() }
    const a = await WorkspaceSession.open(adapter, deps)
    const b = await WorkspaceSession.open(adapter, deps)
    const id = b.data.scenes[0]!.meta.id
    if (ahead) {
      await a.editScene(id, ahead)
      await a.flush()
    }
    const disk = (await adapter.read(path))!
    await journal.put({
      workspaceId: b.data.workspace.id,
      path,
      content: `${disk.text}${words}`,
      baseHash: disk.hash,
      time: 0,
    })
    return { a, b, id, path }
  }
  const fileTexts = async () =>
    Promise.all((await adapter.list()).map(async (p) => (await adapter.read(p))!.text))

  it('finishes the dead tab’s journal even when the files cannot be read again first', async () => {
    const { a, b, id, path } = await deadTabWithWords('\na died with this', 'a wrote this')
    const list = adapter.list.bind(adapter)
    let fails = 1
    adapter.list = async (o) => {
      if (fails-- > 0) throw new Error('disk hiccup')
      return list(o)
    }
    a.dispose()
    await vi.waitFor(() => expect(b.view().otherTab).toBe(false))
    await vi.waitFor(() => expect(b.view().readOnly).toBe(false))
    expect(lastLine((await adapter.read(path))!.text)).toBe('a died with this')
    expect(await journal.list(b.data.workspace.id)).toEqual([])
    expect(b.view().notes.map((n) => n.id)).toContain('refresh-failed')
    await b.editScene(id, 'b typed after')
    await b.flush()
    expect(lastLine((await adapter.read(path))!.text)).toBe('b typed after')
  })

  it('a key typed on a stale screen meets a conflict when both re-reads fail', async () => {
    const { a, b, id, path } = await deadTabWithWords('\na died with this', 'a wrote this')
    const list = adapter.list.bind(adapter)
    let fails = 2
    adapter.list = async (o) => {
      if (fails-- > 0) throw new Error('disk hiccup')
      return list(o)
    }
    a.dispose()
    await vi.waitFor(() => expect(b.view().readOnly).toBe(false))
    await b.editScene(id, `${b.data.scenes[0]!.body}!`)
    await b.flush()
    expect(b.view().save.kind).toBe('conflict')
    expect(lastLine((await adapter.read(path))!.text)).toBe('a died with this')
    expect((await fileTexts()).some((t) => t.includes('a wrote this'))).toBe(true)
  })

  it('shows the dead tab’s words on screen when they cannot be written, so a key does not replace them', async () => {
    const { a, b, id } = await deadTabWithWords('a died with this')
    const write = adapter.write.bind(adapter)
    let fails = 1
    adapter.write = async (p, t) => {
      if (fails-- > 0) throw new Error('disk full')
      return write(p, t)
    }
    a.dispose()
    await vi.waitFor(() => expect(b.view().otherTab).toBe(false))
    await vi.waitFor(() => expect(b.view().readOnly).toBe(false))
    expect(b.data.scenes[0]?.body).toContain('a died with this')
    expect([...b.pipeline.pendingEntries().values()].map(lastLine)).toEqual(['a died with this'])
    await b.editScene(id, `${b.data.scenes[0]!.body} and b added this`)
    await b.flush()
    await vi.waitFor(async () =>
      expect((await fileTexts()).some((t) => t.includes('a died with this and b added this'))).toBe(
        true,
      ),
    )
  })

  it('a tab closed while it settles does not go on writing without the lock', async () => {
    const { a, b, path } = await deadTabWithWords('from the journal')
    const gate = gateRead(adapter, path)
    a.dispose()
    await vi.waitFor(() => expect(gate.isHeld()).toBe(true))
    b.dispose()
    gate.release()
    await new Promise((r) => setTimeout(r, 50))
    expect(lastLine((await adapter.read(path))!.text)).not.toBe('from the journal')
    expect((await journal.list(b.data.workspace.id)).map((e) => lastLine(e.content))).toEqual([
      'from the journal',
    ])
  })

  it('a lock granted as the tab closes is handed straight back, and nothing is taken over', async () => {
    let grant!: () => unknown
    const manager = {
      request: (_n: string, o: { ifAvailable?: boolean }, cb: (l: object | null) => unknown) =>
        o.ifAvailable
          ? Promise.resolve(cb(null)) // someone else holds it
          : new Promise((resolve) => (grant = () => resolve(cb({ name: 'x' })))),
    } as unknown as LockManager
    const b = await WorkspaceSession.open(adapter, { journal, debounceMs: 1e9, locks: manager })
    b.dispose()
    const outcome = await Promise.race([
      Promise.resolve(grant()).then(() => 'released'),
      new Promise((r) => setTimeout(() => r('held forever'), 100)),
    ])
    expect(outcome).toBe('released')
    expect(b.view().otherTab).toBe(true) // never took over
  })

  it('a tab closed while it waits never takes over', async () => {
    const locks = new FakeLocks()
    const a = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    const b = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    b.dispose()
    a.dispose()
    await vi.waitFor(() => expect(locks.isHeld(lockName(a))).toBe(false))
  })
})

describe('a new scene never takes an existing scene’s ID', () => {
  it('draws another ID when the first is already a scene', async () => {
    const path = await scenePathOf()
    const before = (await adapter.read(path))!.hash
    const session = await open()
    const existing = session.data.scenes[0]!.meta.id
    vi.mocked(newId)
      .mockReturnValueOnce(existing as never)
      .mockReturnValueOnce(existing as never)
    const id = await session.createScene(session.data.chapters[0]!.id)
    expect(id).not.toBe(existing)
    expect(session.data.scenes).toHaveLength(2)
    expect((await adapter.read(path))!.hash).toBe(before)
  })
})

describe('a recovered copy of a scene', () => {
  it('is not shown as the scene itself', async () => {
    const path = await scenePathOf()
    const original = (await adapter.read(path))!.text
    const copyPath = copyPathFor(path)
    const session = await open()
    // The copy was being written when the tab died, and the disk still refuses it.
    adapter.beforeWrite = (p) => {
      if (p === copyPath) throw new Error('disk full')
    }
    await journal.put({
      workspaceId: session.data.workspace.id,
      path: copyPath,
      content: original.replace(/\n\n$/, '') + '\n\nthe words of the copy',
      baseHash: null,
      time: 1,
    })
    const again = await open()
    await again.refresh()
    expect(again.data.scenes).toHaveLength(1)
    expect(again.data.scenes[0]?.body).toBe('')
    await again.editScene(again.data.scenes[0]!.meta.id, 'typed into the real scene')
    adapter.beforeWrite = undefined
    await again.pipeline.flush(path)
    expect((await adapter.read(path))!.text.endsWith('typed into the real scene')).toBe(true)
    again.dispose()
  })
})

describe('no IndexedDB', () => {
  it('opens and saves anyway, says the safety copy is missing, and drops nothing', async () => {
    const dead = new IdbJournal(() => Promise.reject(new Error('IndexedDB is not available.')))
    const session = await WorkspaceSession.open(adapter, { journal: dead, debounceMs: 1e9 })
    expect(session.view().journalFailed).toBe(true)
    const id = session.data.scenes[0]!.meta.id
    await session.editScene(id, 'still saved to the file')
    await session.flush()
    expect(
      (await adapter.read(await scenePathOf()))!.text.endsWith('still saved to the file'),
    ).toBe(true)
    expect(session.view().save.kind).toBe('saved')
    expect(session.view().journalFailed).toBe(true)
  })
})

describe('renaming the workspace', () => {
  const nameOnDisk = async () => JSON.parse((await adapter.read('aurelia.json'))!.text).name

  it('changes only the name in aurelia.json, byte for byte, and shows it at once', async () => {
    const before = (await adapter.read('aurelia.json'))!.text
    const session = await open()
    await session.renameWorkspace('  A better name ')
    expect(session.data.workspace.name).toBe('A better name')
    expect(session.view().name).toBe('A better name')
    expect((await adapter.read('aurelia.json'))!.text).toBe(
      before.replace('"My Book"', '"A better name"'),
    )
    expect(session.view().save.kind).toBe('saved')
  })

  it('goes through the save pipeline: the journal has the text before the file is touched, and is cleared after', async () => {
    const session = await open()
    const seen: unknown[] = []
    adapter.beforeWrite = async (path) => {
      if (path === 'aurelia.json')
        seen.push((await journal.list(session.data.workspace.id)).map((e) => e.path))
    }
    await session.renameWorkspace('Journaled')
    expect(seen).toEqual([['aurelia.json']])
    expect(await journal.list(session.data.workspace.id)).toEqual([])
  })

  it('does not write when the name did not change', async () => {
    const session = await open()
    const writes = vi.spyOn(adapter, 'write')
    await session.renameWorkspace(' My Book ')
    expect(writes).not.toHaveBeenCalled()
  })

  it('opens the conflict flow, naming it "Workspace settings", when aurelia.json changed outside Aurelia — nothing is overwritten', async () => {
    const session = await open()
    const outside = (await adapter.read('aurelia.json'))!.text.replace('"My Book"', '"Their name"')
    await adapter.write('aurelia.json', outside)
    await session.renameWorkspace('My name')
    const view = session.view()
    expect(view.save.kind).toBe('conflict')
    expect((await adapter.read('aurelia.json'))!.text).toBe(outside)
    expect(view.conflicts).toEqual([
      expect.objectContaining({
        path: 'aurelia.json',
        title: 'Workspace settings',
        mine: 'Workspace name: My name',
        theirs: 'Workspace name: Their name',
      }),
    ])
    expect(session.data.workspace.name).toBe('My name') // the author still sees their name
    // Using the file's version keeps both: ours becomes a copy, the file's name is shown.
    await session.resolveConflict('aurelia.json', 'theirs')
    expect(session.data.workspace.name).toBe('Their name')
    expect(await nameOnDisk()).toBe('Their name')
  })

  it('keeping mine after a conflict writes our name and sets the file’s text aside as a copy', async () => {
    const session = await open()
    await adapter.write(
      'aurelia.json',
      (await adapter.read('aurelia.json'))!.text.replace('My Book', 'Theirs'),
    )
    await session.renameWorkspace('Mine')
    await session.resolveConflict('aurelia.json', 'mine')
    expect(await nameOnDisk()).toBe('Mine')
    const copy = (await adapter.list()).find((p) => p.includes('Aurelia copy'))!
    expect(JSON.parse((await adapter.read(copy))!.text).name).toBe('Theirs')
  })

  it('keeping mine after another device changed aurelia.json keeps their file and only my name', async () => {
    const session = await open()
    const before = (await adapter.read('aurelia.json'))!.text
    await adapter.write('aurelia.json', before.replace('}\n', ',\n  "x-note": 7\n}\n'))
    await session.renameWorkspace('Mine')
    await session.resolveConflict('aurelia.json', 'mine')
    expect(JSON.parse((await adapter.read('aurelia.json'))!.text)).toMatchObject({
      name: 'Mine',
      'x-note': 7,
    })
  })

  it('after using theirs, a rename started before the files are re-read builds on their file', async () => {
    const session = await open()
    const before = (await adapter.read('aurelia.json'))!.text
    await adapter.write('aurelia.json', before.replace('}\n', ',\n  "x-note": 7\n}\n'))
    await session.renameWorkspace('Mine')
    const refresh = session.refresh.bind(session)
    vi.spyOn(session, 'refresh').mockImplementation(async () => {
      await session.renameWorkspace('Second')
      await refresh()
    })
    await session.resolveConflict('aurelia.json', 'theirs')
    expect(JSON.parse((await adapter.read('aurelia.json'))!.text)).toMatchObject({
      name: 'Second',
      'x-note': 7,
    })
  })

  it('an unsaved rename stays on screen when the files are read again', async () => {
    const session = await open()
    adapter.beforeWrite = () => {
      throw new Error('disk full')
    }
    const wrote = session.renameWorkspace('Kept on screen')
    await wrote.catch(() => undefined)
    adapter.beforeWrite = undefined
    await session.refresh()
    expect(session.data.workspace.name).toBe('Kept on screen')
    expect(await nameOnDisk()).toBe('My Book')
  })

  it('picks up a rename made outside Aurelia and builds the next rename on that file', async () => {
    const session = await open()
    await adapter.write(
      'aurelia.json',
      (await adapter.read('aurelia.json'))!.text
        .replace('"My Book"', '"Elsewhere"')
        .replace('}\n', ',\n  "x-note": 1\n}\n'),
    )
    await session.checkAll()
    expect(session.data.workspace.name).toBe('Elsewhere')
    await session.renameWorkspace('Again')
    expect(JSON.parse((await adapter.read('aurelia.json'))!.text)).toMatchObject({
      name: 'Again',
      'x-note': 1,
    })
  })

  it('is refused, in plain words, for a newer version, another tab and a tab that is settling — and writes nothing', async () => {
    const before = (await adapter.read('aurelia.json'))!.text
    const path = await scenePathOf()
    const sceneText = (await adapter.read(path))!.text
    await adapter.write(path, sceneText.replace('schemaVersion: 1', 'schemaVersion: 2'))
    const newer = await open()
    await expect(newer.renameWorkspace('X')).rejects.toThrow(/newer version/)
    await adapter.write(path, sceneText)

    const locks = new FakeLocks()
    const a = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    const b = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    await expect(b.renameWorkspace('X')).rejects.toThrow(/another tab/)

    const gate = gateRead(adapter, path)
    a.dispose()
    await vi.waitFor(() => expect(gate.isHeld()).toBe(true))
    expect(b.view().settling).toBe(true)
    await expect(b.renameWorkspace('X')).rejects.toThrow(/catching up/)
    gate.release()
    await vi.waitFor(() => expect(b.view().readOnly).toBe(false))
    expect((await adapter.read('aurelia.json'))!.text).toBe(before)
    expect(await journal.list(b.data.workspace.id)).toEqual([])
  })

  it('uses the same name check as creating a workspace', async () => {
    const session = await open()
    for (const bad of ['', '   ', 'x'.repeat(81), 'two\nlines', 'bell\u0007'])
      await expect(session.renameWorkspace(bad)).rejects.toThrow()
    expect(checkWorkspaceName('  ok  ')).toEqual({ name: 'ok', error: '', ok: true })
    expect(checkWorkspaceName('x'.repeat(80)).ok).toBe(true)
    expect(await nameOnDisk()).toBe('My Book')
  })
})
