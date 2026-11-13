// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openDeviceDb } from './device-db'
import { hashText } from './hash'
import { IdbJournal, type JournalEntry } from './journal'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { SavePipeline } from './save-pipeline'
import { guardWrites } from './guard-writes'

const WS = 'wsp_test000001'
const PATH = 'scenes/scn_a.md'

let adapter: MemoryAdapter
let journal: IdbJournal
let readOnly = false
let log: string[]

/** A pipeline with timers that never fire by themselves: tests call `flush` when they mean it. */
function makePipeline(overrides: Partial<ConstructorParameters<typeof SavePipeline>[0]> = {}) {
  const guarded = guardWrites(adapter, () => readOnly)
  const pipeline = new SavePipeline({
    adapter: guarded,
    journal,
    workspaceId: WS,
    isReadOnly: () => readOnly,
    notify: () => undefined,
    debounceMs: 1e9,
    maxWaitMs: 1e9,
    backoffMs: [1e9],
    ...overrides,
  })
  return pipeline
}

beforeEach(async () => {
  readOnly = false
  log = []
  adapter = new MemoryAdapter({ [PATH]: 'original' })
  const db = openDeviceDb(new IDBFactory())
  journal = new IdbJournal(() => db)
})

async function opened(text = 'original') {
  const pipeline = makePipeline()
  pipeline.known.set(PATH, await hashText(text))
  return pipeline
}

describe('compare-and-write', () => {
  it('writes when the file is what we last read, and remembers the new hash', async () => {
    const p = await opened()
    await p.edit(PATH, 'mine')
    await p.flush(PATH)
    expect((await adapter.read(PATH))?.text).toBe('mine')
    expect(p.known.get(PATH)).toBe(await hashText('mine'))
    expect(p.summary().kind).toBe('saved')
    expect(await journal.list(WS)).toEqual([])
  })

  it('refuses a stale write: the file changed since we read it, so nothing is written', async () => {
    const p = await opened()
    await adapter.write(PATH, 'theirs') // another app saved meanwhile
    await p.edit(PATH, 'mine')
    await p.flush(PATH)
    expect((await adapter.read(PATH))?.text).toBe('theirs')
    expect(p.summary().kind).toBe('conflict')
    expect(p.conflicts()).toEqual([{ path: PATH, mine: 'mine', theirs: 'theirs' }])
    expect((await journal.list(WS))[0]?.content).toBe('mine') // the author's words are still kept
  })

  it('treats a file that appeared where we expected none as a conflict', async () => {
    const p = makePipeline()
    await p.edit('scenes/new.md', 'mine')
    await adapter.write('scenes/new.md', 'someone else made it')
    await p.flush('scenes/new.md')
    expect(p.summary().kind).toBe('conflict')
    expect((await adapter.read('scenes/new.md'))?.text).toBe('someone else made it')
  })

  it('creates a file that is not there', async () => {
    const p = makePipeline()
    await p.edit('scenes/new.md', 'fresh')
    await p.flush('scenes/new.md')
    expect((await adapter.read('scenes/new.md'))?.text).toBe('fresh')
  })
})

describe('the recovery journal', () => {
  it('is written before the file is touched, and cleared only after the write', async () => {
    const p = await opened()
    const put = journal.put.bind(journal)
    const remove = journal.remove.bind(journal)
    journal.put = async (e: JournalEntry) => {
      log.push('journal.put')
      return put(e)
    }
    journal.remove = async (ws: string, path: string) => {
      log.push('journal.remove')
      return remove(ws, path)
    }
    adapter.beforeWrite = () => void log.push('file.write')
    await p.edit(PATH, 'mine')
    await p.flush(PATH)
    await p.flush(PATH)
    expect(log.slice(0, 3)).toEqual(['journal.put', 'file.write', 'journal.remove'])
  })

  it('does not touch the file while the journal write has not finished', async () => {
    const p = await opened()
    journal.put = () => new Promise<void>(() => undefined) // never answers
    adapter.beforeWrite = () => void log.push('file.write')
    void p.edit(PATH, 'mine')
    void p.flush(PATH)
    await new Promise((r) => setTimeout(r, 30))
    expect(log).toEqual([])
    expect((await adapter.read(PATH))?.text).toBe('original')
  })

  it('keeps the entry, with the base hash it was edited from', async () => {
    const p = await opened()
    await p.edit(PATH, 'mine')
    const [entry] = await journal.list(WS)
    expect(entry).toMatchObject({
      path: PATH,
      content: 'mine',
      baseHash: await hashText('original'),
    })
  })

  it('keeps the newest text when more is typed while a write is in flight', async () => {
    const p = await opened()
    let release!: () => void
    adapter.beforeWrite = () => new Promise<void>((r) => (release = r))
    await p.edit(PATH, 'one')
    const saving = p.flush(PATH)
    await new Promise((r) => setTimeout(r, 20))
    await p.edit(PATH, 'one two')
    adapter.beforeWrite = undefined
    release()
    await saving
    expect((await adapter.read(PATH))?.text).toBe('one')
    // The journal now expects the file we just wrote, so a crash here recovers cleanly.
    expect(await journal.list(WS)).toMatchObject([
      { content: 'one two', baseHash: await hashText('one') },
    ])
    await p.flush(PATH)
    expect((await adapter.read(PATH))?.text).toBe('one two')
    expect(await journal.list(WS)).toEqual([])
  })

  it('on startup finishes a write the file has not seen yet, and says so', async () => {
    // A tab died after the journal entry and before the write.
    await journal.put({
      workspaceId: WS,
      path: PATH,
      content: 'lost words',
      baseHash: await hashText('original'),
      time: 1,
    })
    const p = await opened()
    const report = await p.recover()
    expect(report).toEqual({ saved: [PATH], conflicts: [], waiting: [] })
    expect((await adapter.read(PATH))?.text).toBe('lost words')
    expect(await journal.list(WS)).toEqual([])
  })

  it('on startup drops an entry whose text did reach the file (the tab died after the write)', async () => {
    await adapter.write(PATH, 'already there')
    await journal.put({
      workspaceId: WS,
      path: PATH,
      content: 'already there',
      baseHash: await hashText('original'),
      time: 1,
    })
    const p = makePipeline()
    expect(await p.recover()).toEqual({ saved: [], conflicts: [], waiting: [] })
    expect(await journal.list(WS)).toEqual([])
  })

  it('on startup opens a conflict, with both texts, when the file changed since the edit', async () => {
    await journal.put({
      workspaceId: WS,
      path: PATH,
      content: 'my lost words',
      baseHash: await hashText('original'),
      time: 1,
    })
    await adapter.write(PATH, 'changed elsewhere')
    const p = makePipeline()
    const report = await p.recover()
    expect(report.conflicts).toEqual([PATH])
    expect(p.conflicts()).toEqual([
      { path: PATH, mine: 'my lost words', theirs: 'changed elsewhere' },
    ])
    expect((await adapter.read(PATH))?.text).toBe('changed elsewhere')
    expect(await journal.list(WS)).toHaveLength(1) // never dropped without the author choosing
  })

  it('on startup keeps every entry of a read-only workspace and writes nothing', async () => {
    await journal.put({
      workspaceId: WS,
      path: PATH,
      content: 'words',
      baseHash: await hashText('original'),
      time: 1,
    })
    readOnly = true
    const p = await opened()
    expect((await p.recover()).waiting).toEqual([PATH])
    expect((await adapter.read(PATH))?.text).toBe('original')
    expect(await journal.list(WS)).toHaveLength(1)
  })
})

describe('the conflict flow', () => {
  async function conflicted() {
    const p = await opened()
    await adapter.write(PATH, 'theirs')
    await p.edit(PATH, 'mine')
    await p.flush(PATH)
    return p
  }

  it('"use the file’s version" keeps the author’s text as a copy next to it', async () => {
    const p = await conflicted()
    const copy = await p.resolve(PATH, 'theirs')
    expect(copy).toBe('scenes/scn_a (Aurelia copy).md')
    expect((await adapter.read(PATH))?.text).toBe('theirs')
    expect((await adapter.read(copy!))?.text).toBe('mine')
    expect(p.summary().kind).toBe('saved')
    expect(await journal.list(WS)).toEqual([])
  })

  it('"keep mine" saves the file’s version as a copy first, then writes the author’s', async () => {
    const p = await conflicted()
    const copy = await p.resolve(PATH, 'mine')
    expect((await adapter.read(copy!))?.text).toBe('theirs')
    expect((await adapter.read(PATH))?.text).toBe('mine')
    expect(p.summary().kind).toBe('saved')
  })

  it('"keep mine" is compare-and-write again: a file that changed once more is a new conflict', async () => {
    const p = await conflicted()
    adapter.beforeWrite = async (path) => {
      if (path === PATH) throw new Error('should not be written')
    }
    // Another change lands after the copy is made but before our write.
    const read = adapter.read.bind(adapter)
    let reads = 0
    adapter.read = async (path) => {
      const found = await read(path)
      if (path === PATH && ++reads === 1) await adapter.write('scenes/scn_a.md', 'third version')
      return found
    }
    adapter.beforeWrite = undefined
    await p.resolve(PATH, 'mine')
    expect(p.summary().kind).toBe('conflict')
    expect((await adapter.read(PATH))?.text).toBe('third version')
    expect(p.conflicts()[0]?.mine).toBe('mine')
  })

  it('"use the file’s version" keeps text typed after the choice: the conflict stands with it', async () => {
    const p = await conflicted()
    let release!: () => void
    adapter.beforeWrite = (path) => {
      if (path.includes('Aurelia copy')) return new Promise<void>((r) => (release = r))
    }
    const resolving = p.resolve(PATH, 'theirs')
    await vi.waitFor(() => expect(release).toBeDefined())
    await p.edit(PATH, 'mine, and typed after the choice')
    adapter.beforeWrite = undefined
    release()
    await resolving
    expect(p.summary().kind).toBe('conflict')
    expect(p.conflicts()[0]?.mine).toBe('mine, and typed after the choice')
    expect(await journal.list(WS)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: PATH, content: 'mine, and typed after the choice' }),
      ]),
    )
    expect((await adapter.read(PATH))?.text).toBe('theirs')
  })

  it('numbers a second copy instead of overwriting the first', async () => {
    const p = await conflicted()
    await adapter.write('scenes/scn_a (Aurelia copy).md', 'an older copy')
    const copy = await p.resolve(PATH, 'theirs')
    expect(copy).toBe('scenes/scn_a (Aurelia copy 2).md')
    expect((await adapter.read('scenes/scn_a (Aurelia copy).md'))?.text).toBe('an older copy')
  })

  it('keeps the author’s text in the journal until the copy is written', async () => {
    const p = await conflicted()
    adapter.beforeWrite = (path) => {
      if (path.includes('Aurelia copy')) throw new Error('disk full')
    }
    await expect(p.resolve(PATH, 'theirs')).rejects.toThrow()
    expect(await journal.list(WS)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: PATH, content: 'mine' })]),
    )
    expect(p.conflicts()).toHaveLength(1)
  })
})

describe('failures', () => {
  it('a newer-version workspace refuses every write and keeps nothing half done', async () => {
    readOnly = true
    const p = await opened()
    await expect(p.edit(PATH, 'mine')).rejects.toMatchObject({ code: 'read-only' })
    await expect(guardWrites(adapter, () => true).write('x.md', 'y')).rejects.toMatchObject({
      code: 'read-only',
    })
    await expect(guardWrites(adapter, () => true).remove(PATH)).rejects.toMatchObject({
      code: 'read-only',
    })
    expect((await adapter.read(PATH))?.text).toBe('original')
    expect(await journal.list(WS)).toEqual([])
  })

  it('a lost folder permission keeps the edits queued in the journal until access returns', async () => {
    const p = await opened()
    adapter.accessLost = true
    await p.edit(PATH, 'typed while disconnected')
    await p.flush(PATH)
    expect(p.summary().kind).toBe('blocked')
    expect(await journal.list(WS)).toMatchObject([{ content: 'typed while disconnected' }])
    adapter.accessLost = false
    await p.reconnect()
    expect(p.summary().kind).toBe('saved')
    expect((await adapter.read(PATH))?.text).toBe('typed while disconnected')
    expect(await journal.list(WS)).toEqual([])
  })

  it('a failing write is retried with backoff and the text stays in the journal', async () => {
    const p = makePipeline({ backoffMs: [5] })
    p.known.set(PATH, await hashText('original'))
    let fail = true
    adapter.beforeWrite = () => {
      if (fail) throw new Error('disk full')
    }
    await p.edit(PATH, 'mine')
    await p.flush(PATH)
    expect(p.summary()).toMatchObject({ kind: 'failed' })
    expect(await journal.list(WS)).toHaveLength(1)
    fail = false
    await new Promise((r) => setTimeout(r, 60))
    expect(p.summary().kind).toBe('saved')
    expect((await adapter.read(PATH))?.text).toBe('mine')
    p.dispose()
  })

  it('still saves when the journal is unavailable, and says so', async () => {
    journal.put = async () => {
      throw new Error('no indexedDB')
    }
    const p = await opened()
    await p.edit(PATH, 'mine')
    expect(p.journalFailed).toBe(true)
    await p.flush(PATH)
    expect((await adapter.read(PATH))?.text).toBe('mine')
  })
})

describe('no IndexedDB', () => {
  it('recovers nothing, throws nothing, and says the journal is unavailable', async () => {
    journal.list = async () => {
      throw new Error('IndexedDB is not available.')
    }
    const p = await opened()
    expect(await p.recover()).toEqual({ saved: [], conflicts: [], waiting: [] })
    expect(p.journalFailed).toBe(true)
  })
})

describe('a text from another device (sync)', () => {
  it('goes to the file while the file is still what the base says, and is remembered', async () => {
    const p = await opened()
    expect(await p.receive(PATH, 'from afar', await hashText('original'))).toBe('applied')
    expect((await adapter.read(PATH))?.text).toBe('from afar')
    expect(p.summary().kind).toBe('saved')
  })

  it('text typed on the screen as it was, before the files are read again, meets what arrived as a conflict and never writes over it', async () => {
    const p = await opened()
    await p.receive(PATH, 'from afar', await hashText('original'))
    await p.edit(PATH, 'original, and typed after') // the screen still showed the old text
    await p.flush(PATH)
    expect((await adapter.read(PATH))?.text).toBe('from afar')
    expect(p.conflicts()).toEqual([
      { path: PATH, mine: 'original, and typed after', theirs: 'from afar' },
    ])
  })

  it('the same for a file that was removed', async () => {
    const p = await opened()
    await p.receive(PATH, null, await hashText('original'))
    await p.edit(PATH, 'typed after')
    await p.flush(PATH)
    expect(await adapter.read(PATH)).toBeNull()
    expect(p.conflicts()).toEqual([{ path: PATH, mine: 'typed after', theirs: null }])
  })

  it('is deferred, and writes nothing, when the file is no longer what the base says', async () => {
    const p = await opened()
    await adapter.write(PATH, 'saved here since')
    expect(await p.receive(PATH, 'from afar', await hashText('original'))).toBe('deferred')
    expect((await adapter.read(PATH))?.text).toBe('saved here since')
  })

  it('a new file needs there to be none; a removal removes only what the base says', async () => {
    const p = await opened()
    expect(await p.receive(PATH, 'x', null)).toBe('deferred') // there is a file
    expect(await p.receive('scenes/new.md', 'new', null)).toBe('applied')
    expect(await p.receive(PATH, null, await hashText('other'))).toBe('deferred')
    expect((await adapter.read(PATH))?.text).toBe('original')
    expect(await p.receive(PATH, null, await hashText('original'))).toBe('applied')
    expect(await adapter.read(PATH)).toBeNull()
  })

  it('unsaved edits stay on screen as a conflict with the text that arrived, and both choices keep both', async () => {
    for (const choice of ['mine', 'theirs'] as const) {
      adapter = new MemoryAdapter({ [PATH]: 'original' })
      const p = await opened()
      await p.edit(PATH, 'mine, unsaved')
      expect(await p.receive(PATH, 'from afar', await hashText('original'))).toBe('applied')
      expect(p.summary().kind).toBe('conflict')
      expect(p.conflicts()).toEqual([{ path: PATH, mine: 'mine, unsaved', theirs: 'from afar' }])
      expect((await journal.list(WS))[0]?.content).toBe('mine, unsaved')
      await p.flush(PATH) // nothing is written over the text that arrived
      expect((await adapter.read(PATH))?.text).toBe('from afar')
      await p.resolve(PATH, choice)
      const texts = [...(await adapter.list())].map((f) => adapter.read(f))
      const all = (await Promise.all(texts)).map((f) => f?.text).join('|')
      expect(all).toContain('mine, unsaved')
      expect(all).toContain('from afar')
    }
  })

  it('a removal never overrides unsaved edits', async () => {
    const p = await opened()
    await p.edit(PATH, 'mine, unsaved')
    expect(await p.receive(PATH, null, await hashText('original'))).toBe('deferred')
    expect((await adapter.read(PATH))?.text).toBe('original')
    expect(p.pendingEntries().get(PATH)).toBe('mine, unsaved')
  })

  it('waits for a save that is in flight, so the two cannot interleave', async () => {
    const p = await opened()
    let release: () => void = () => undefined
    const held = new Promise<void>((r) => (release = r))
    adapter.beforeWrite = async (_path, text) => {
      if (text === 'mine') await held
    }
    await p.edit(PATH, 'mine')
    const saving = p.flush(PATH)
    const arriving = p.receive(PATH, 'from afar', await hashText('original'))
    await new Promise((r) => setTimeout(r, 10))
    release()
    await saving
    // The save landed first, so the file is no longer what the base said: deferred, nothing lost.
    expect(await arriving).toBe('deferred')
    expect((await adapter.read(PATH))?.text).toBe('mine')
  })

  it('the same text arriving as the unsaved one is no conflict', async () => {
    const p = await opened()
    await p.edit(PATH, 'same words')
    expect(await p.receive(PATH, 'same words', await hashText('original'))).toBe('applied')
    expect(p.summary().kind).toBe('saved')
    expect(p.conflicts()).toEqual([])
  })
})
