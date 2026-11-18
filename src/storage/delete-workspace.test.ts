// SPDX-License-Identifier: AGPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { ChatStore } from '@/assistant/chat-store'
import { BackupStore } from '@/backup/state'
import { FakeDirectory } from '../../tests/helpers/fake-directory'
import { readZip } from '../../tests/helpers/read-zip'
import { FakeLocks } from '../../tests/helpers/fake-locks'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { createWorkspace } from './create'
import { hashText } from './hash'
import {
  copyOfStored,
  deleteBrowserWorkspace,
  glanceAt,
  releaseBlock,
  removeFolderFromList,
  type DeleteDeps,
} from './delete-workspace'
import { openDeviceDb } from './device-db'
import { IdbJournal } from './journal'
import { Recents, type RecentWorkspace } from './recents'
import { WorkspaceSession, workspaceLockName } from './session'

const A = 'wsp_aaaaaaaaaa'
const B = 'wsp_bbbbbbbbbb'
const recent = (key: string, kind: 'browser' | 'folder' = 'browser'): RecentWorkspace => ({
  key,
  name: 'Saltmarch',
  kind,
  label: kind === 'folder' ? 'the folder “Saltmarch”' : 'this browser',
  lastOpened: 1,
})

let root: FakeDirectory // the browser's private file system
let recents: Recents
let journal: IdbJournal
let backup: BackupStore
let chat: ChatStore
let locks: FakeLocks
let deps: DeleteDeps
let calls: string[]

/** The device's IndexedDB for tests: one workspace's rows must be gone, the other's untouched. */
async function seed(key: string) {
  root.seed(`workspaces/${key}/aurelia.json`, '{}')
  root.seed(`workspaces/${key}/scenes/one.md`, 'words')
  await recents.put(recent(key))
  await journal.put({
    workspaceId: key,
    path: 'scenes/one.md',
    content: 'x',
    baseHash: null,
    time: 1,
  })
  await backup.save({ ...(await backup.load(key)), enabled: true, folder: `Aurelia/${key}` })
  await chat.save(key, [{ role: 'author', text: 'Who is Tomas?', tools: [] }])
}
const rowsOf = async (key: string) => ({
  files: root.paths().filter((p) => p.startsWith(`workspaces/${key}/`)),
  journal: (await journal.list(key)).length,
  backup: (await backup.load(key)).folder,
  chat: (await chat.load(key)).length,
  recent: !!(await recents.get(key)),
})

beforeEach(async () => {
  const db = openDeviceDb(new IDBFactory())
  recents = new Recents(() => db)
  journal = new IdbJournal(() => db)
  backup = new BackupStore(() => db)
  chat = new ChatStore(() => db)
  root = new FakeDirectory('root')
  locks = new FakeLocks()
  calls = []
  deps = {
    recents,
    journal,
    backup,
    chat,
    locks: locks.asManager(),
    removeDirectory: async (id) => {
      const all = await root.getDirectoryHandle('workspaces')
      await all.removeEntry(id)
    },
    forget: (id) => void calls.push(`forget ${id}`),
  }
  await seed(A)
  await seed(B)
})

describe('deleting a browser workspace', () => {
  it('removes that workspace’s files, journal rows, backup state and recent row, and nothing of the other', async () => {
    const other = await rowsOf(B)
    await deleteBrowserWorkspace(recent(A), deps)
    expect(await rowsOf(A)).toEqual({ files: [], journal: 0, backup: null, chat: 0, recent: false })
    expect(await rowsOf(B)).toEqual(other)
    expect(other).toMatchObject({ journal: 1, chat: 1, recent: true, backup: `Aurelia/${B}` })
    expect(calls).toEqual([`forget ${A}`])
  })

  it('refuses while another tab holds the workspace, and changes nothing', async () => {
    const before = await rowsOf(A)
    let release!: () => void
    void locks.request(workspaceLockName(A), () => new Promise<void>((r) => (release = r)))
    await expect(deleteBrowserWorkspace(recent(A), deps)).rejects.toThrow(
      'Close the other tab that has Saltmarch open, then try again.',
    )
    expect(await rowsOf(A)).toEqual(before)
    expect(calls).toEqual([])
    release()
  })

  it('is not stopped by another workspace’s lock, and does not hold its own lock afterwards', async () => {
    void locks.request(workspaceLockName(B), () => new Promise<void>(() => undefined))
    await deleteBrowserWorkspace(recent(A), deps)
    expect(locks.isHeld(workspaceLockName(A))).toBe(false)
    expect((await rowsOf(A)).recent).toBe(false)
  })

  it('goes on where the browser has no locks', async () => {
    await deleteBrowserWorkspace(recent(A), { ...deps, locks: undefined })
    expect((await rowsOf(A)).recent).toBe(false)
  })

  it('a failed directory removal leaves the recent row, the journal and the backup state in place', async () => {
    const before = await rowsOf(A)
    const boom = new DOMException('no access', 'NotAllowedError')
    await expect(
      deleteBrowserWorkspace(recent(A), {
        ...deps,
        removeDirectory: async () => {
          throw boom
        },
      }),
    ).rejects.toBe(boom)
    expect(await rowsOf(A)).toEqual(before)
    expect(calls).toEqual([])
  })

  it('an already-missing directory still cleans up the device’s rows', async () => {
    await deps.removeDirectory(A)
    await deleteBrowserWorkspace(recent(A), deps)
    expect(await rowsOf(A)).toEqual({ files: [], journal: 0, backup: null, chat: 0, recent: false })
  })

  it('lets the open session go first, and does nothing when that is refused', async () => {
    const order: string[] = []
    await deleteBrowserWorkspace(recent(A), {
      ...deps,
      release: async (id) => void order.push(`release ${id}`),
      removeDirectory: async (id) => void order.push(`remove ${id}`),
    })
    expect(order).toEqual([`release ${A}`, `remove ${A}`])

    const before = await rowsOf(B)
    await expect(
      deleteBrowserWorkspace(recent(B), {
        ...deps,
        release: async () => {
          throw new Error('unsaved')
        },
      }),
    ).rejects.toThrow('unsaved')
    expect(await rowsOf(B)).toEqual(before)
  })

  it('will not delete a folder workspace', async () => {
    await expect(deleteBrowserWorkspace(recent(A, 'folder'), deps)).rejects.toThrow()
    expect((await rowsOf(A)).recent).toBe(true)
  })
})

describe('removing a folder workspace from the list', () => {
  it('forgets the list entry and its chat: the folder’s files, the journal and the other entries stay', async () => {
    const folder = new FakeDirectory('Saltmarch')
    folder.seed('aurelia.json', '{"id":"x"}')
    folder.seed('scenes/one.md', 'my words')
    await recents.put({ ...recent('wsp_ffffffffff', 'folder'), handle: folder.asHandle() })
    await journal.put({
      workspaceId: 'wsp_ffffffffff',
      path: 'scenes/one.md',
      content: 'unsaved',
      baseHash: null,
      time: 1,
    })
    await chat.save('wsp_ffffffffff', [{ role: 'author', text: 'Who is Tomas?', tools: [] }])
    await removeFolderFromList(recent('wsp_ffffffffff', 'folder'), {
      ...deps,
      removeDirectory: async () => {
        throw new Error('must not delete anything')
      },
    })
    expect(await recents.get('wsp_ffffffffff')).toBeUndefined()
    expect(folder.paths().sort()).toEqual(['aurelia.json', 'scenes/one.md'])
    expect(await journal.list('wsp_ffffffffff')).toHaveLength(1) // unsaved words are kept
    expect(await chat.load('wsp_ffffffffff')).toEqual([]) // this device's chat about it goes
    expect((await rowsOf(B)).chat).toBe(1)
    expect((await rowsOf(A)).recent).toBe(true)
    expect((await rowsOf(B)).recent).toBe(true)
    expect(calls).toEqual(['forget wsp_ffffffffff'])
  })

  it('will not be used on a browser workspace', async () => {
    await expect(removeFolderFromList(recent(A), deps)).rejects.toThrow()
    expect((await rowsOf(A)).files.length).toBeGreaterThan(0)
  })
})

describe('the journal clears one workspace only', () => {
  it('leaves the others', async () => {
    const db = openDeviceDb(new IDBFactory())
    const j = new IdbJournal(() => db)
    for (const workspaceId of [A, A, B])
      await j.put({ workspaceId, path: `p${Math.random()}`, content: '', baseHash: null, time: 1 })
    await j.clear(A)
    expect(await j.list(A)).toEqual([])
    expect(await j.list(B)).toHaveLength(1)
  })
})

describe('when an open session may be deleted', () => {
  const open = async () => {
    const adapter = new MemoryAdapter()
    await createWorkspace(adapter, 'Saltmarch')
    return WorkspaceSession.open(adapter, { journal, debounceMs: 1e9 })
  }

  it('says yes once everything is saved', async () => {
    const session = await open()
    expect(releaseBlock(session.view())).toBeNull()
    session.dispose()
  })

  it('says no while a scene holds unsaved words', async () => {
    const session = await open()
    void session.editScene(session.data.scenes[0]!.meta.id, 'words that are not saved yet')
    expect(releaseBlock(session.view())).toContain('has changes that are not saved yet')
    session.dispose()
  })

  it('says to close the other tab when another tab writes it', async () => {
    const shared = new FakeLocks()
    const mine = new MemoryAdapter()
    const theirs = new MemoryAdapter()
    await createWorkspace(mine, 'Saltmarch', A)
    await createWorkspace(theirs, 'Saltmarch', A)
    const writer = await WorkspaceSession.open(theirs, { journal, locks: shared.asManager() })
    const reader = await WorkspaceSession.open(mine, { journal, locks: shared.asManager() })
    expect(releaseBlock(writer.view())).toBeNull()
    expect(releaseBlock(reader.view())).toBe(
      'Close the other tab that has Saltmarch open, then try again.',
    )
    writer.dispose()
    reader.dispose()
  })
})

describe('what the confirm dialog shows', () => {
  it('counts books and words read-only, and says nothing when the workspace cannot be read', async () => {
    const adapter = new MemoryAdapter()
    await createWorkspace(adapter, 'Saltmarch')
    const before = await adapter.list()
    expect(await glanceAt(adapter)).toEqual({ books: 1, words: 0 })
    expect(await adapter.list()).toEqual(before)
    expect(await glanceAt(new MemoryAdapter())).toBeNull()
  })
})

describe('a copy of a workspace that is not open', () => {
  it('includes the words only the journal holds, so deleting does not lose them', async () => {
    const adapter = new MemoryAdapter({ 'scenes/one.md': 'saved words', 'aurelia.json': '{}' })
    await journal.put({
      workspaceId: A,
      path: 'scenes/one.md',
      content: 'newer words, never saved',
      baseHash: await hashText('saved words'), // the file is still as the journal found it
      time: 1,
    })
    await journal.put({
      workspaceId: A,
      path: 'scenes/two.md',
      content: 'a new scene',
      baseHash: null,
      time: 1,
    })
    await journal.put({
      workspaceId: B,
      path: 'scenes/one.md',
      content: 'not this one',
      baseHash: null,
      time: 1,
    })
    const zip = readZip(
      new Uint8Array(await (await copyOfStored(adapter, recent(A), journal)).arrayBuffer()),
    )
    const text = (path: string) => zip.find((f) => f.path.endsWith(path))?.text
    expect(text('scenes/one.md')).toBe('newer words, never saved')
    expect(text('scenes/two.md')).toBe('a new scene')
    expect(zip.some((f) => f.text === 'not this one')).toBe(false)
  })
})

describe('a copy when the file changed after the journal entry was made', () => {
  const zipOf = async (adapter: MemoryAdapter) =>
    readZip(new Uint8Array(await (await copyOfStored(adapter, recent(A), journal)).arrayBuffer()))
  const entry = async (content: string, base: string | null) =>
    journal.put({ workspaceId: A, path: 'scenes/one.md', content, baseHash: base, time: 1 })

  it('keeps the file as it is and puts the journal’s words beside it, as a conflict does', async () => {
    const adapter = new MemoryAdapter({ 'scenes/one.md': 'changed by another app' })
    await entry('my unsaved words', await hashText('what the journal started from'))
    const zip = await zipOf(adapter)
    expect(zip.find((f) => f.path.endsWith('scenes/one.md'))?.text).toBe('changed by another app')
    expect(zip.find((f) => f.path.endsWith('scenes/one (Aurelia copy).md'))?.text).toBe(
      'my unsaved words',
    )
  })

  it('numbers the copy when one is already there, and leaves a file that already has the words alone', async () => {
    const adapter = new MemoryAdapter({
      'scenes/one.md': 'changed by another app',
      'scenes/one (Aurelia copy).md': 'an earlier copy',
    })
    await entry('my unsaved words', null)
    let zip = await zipOf(adapter)
    expect(zip.find((f) => f.path.endsWith('one (Aurelia copy).md'))?.text).toBe('an earlier copy')
    expect(zip.find((f) => f.path.endsWith('one (Aurelia copy 2).md'))?.text).toBe(
      'my unsaved words',
    )

    const written = new MemoryAdapter({ 'scenes/one.md': 'my unsaved words' })
    zip = await zipOf(written) // it did get written: nothing to add
    expect(zip.map((f) => f.path.split('/').slice(1).join('/'))).toEqual(['scenes/one.md'])
  })
})

describe('a row that is out of date', () => {
  it('refuses to delete when the stored entry is no longer a browser workspace', async () => {
    await recents.put({ ...recent(A, 'folder'), handle: new FakeDirectory().asHandle() })
    const before = await rowsOf(A)
    await expect(deleteBrowserWorkspace(recent(A), deps)).rejects.toThrow(
      'Saltmarch changed since this list was shown. Try again.',
    )
    expect(await rowsOf(A)).toEqual(before)
  })

  it('refuses to remove from the list when the stored entry is now a browser workspace', async () => {
    await expect(removeFolderFromList(recent(A, 'folder'), deps)).rejects.toThrow(
      'changed since this list was shown',
    )
    expect((await rowsOf(A)).recent).toBe(true)
  })

  it('refuses when the entry is gone altogether, without releasing the open session', async () => {
    await recents.remove(A)
    let released = false
    await expect(
      deleteBrowserWorkspace(recent(A), { ...deps, release: async () => void (released = true) }),
    ).rejects.toThrow('changed since this list was shown')
    expect(released).toBe(false)
    expect((await rowsOf(A)).files.length).toBeGreaterThan(0)
  })
})
