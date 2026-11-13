// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { FakeDirectory } from '../../tests/helpers/fake-directory'
import App from '@/App.vue'
import { useAppUpdate } from '@/composables/useAppUpdate'
import { createAppRouter } from '@/router'
import type { StorageAdapter } from '@/storage/adapter'
import { createWorkspace } from '@/storage/create'
import { openDeviceDb } from '@/storage/device-db'
import { HandleAdapter } from '@/storage/handle-adapter'
import { IdbJournal } from '@/storage/journal'
import { FakeLocks } from '../../tests/helpers/fake-locks'
import { gateRead } from '../../tests/helpers/gate-read'
import { MemoryAdapter } from '../../tests/helpers/memory-adapter'
import { WorkspaceSession } from '@/storage/session'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'

let app: VueWrapper | undefined
beforeEach(() => localStorage.clear())
afterEach(() => {
  app?.unmount()
  app = undefined
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
})

async function start(path = '/') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  app = mount(App, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return { app, router, ws: useWorkspaceStore() }
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!
const textarea = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Scene text"]')

/** Pick `dir` as the folder in the (stubbed) picker and press "Choose a folder". */
async function chooseFolder(dir: FakeDirectory) {
  window.showDirectoryPicker = async () => dir.asHandle()
  const view = await start('/')
  button('Choose a folder').click()
  await flushPromises()
  return view
}

describe('choosing a folder', () => {
  it('asks for a name in an empty folder, then writes a valid workspace into it and opens it', async () => {
    const dir = new FakeDirectory('Writing')
    dir.seed('.DS_Store', 'junk') // an operating system's file does not make the folder "not empty"
    const { router } = await chooseFolder(dir)
    expect(document.body.textContent).toContain('Name your workspace')
    const input = document.querySelector<HTMLInputElement>('#new-workspace input')!
    input.value = 'Winter 1709'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    document.querySelector<HTMLFormElement>('#new-workspace')!.requestSubmit()
    await vi.waitFor(() => expect(textarea()).not.toBeNull(), { timeout: 5000 })
    expect(router.currentRoute.value.path).toMatch(/^\/w\/bok_\w+\/scn_\w+$/)
    expect(
      dir
        .paths()
        .filter((p) => p !== '.DS_Store')
        .sort(),
    ).toEqual(expect.arrayContaining(['aurelia.json']))
    expect(dir.paths().filter((p) => p.endsWith('.md'))).toHaveLength(3)
    expect(document.querySelector('footer')?.textContent).toContain('In a folder')
  })

  it('refuses a folder with other files in it, and writes nothing', async () => {
    const dir = new FakeDirectory('Documents')
    dir.seed('taxes/2025.pdf', 'x')
    dir.seed('notes.txt', 'y')
    await chooseFolder(dir)
    const alert = document.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('already has other files in it')
    expect(alert.textContent).toContain('nothing was changed')
    expect(dir.paths().sort()).toEqual(['notes.txt', 'taxes/2025.pdf'])
    expect(document.body.textContent).not.toContain('Name your workspace')
  })

  it('opens a folder that already holds a workspace, and reads it', async () => {
    const dir = new FakeDirectory('Existing')
    await createWorkspace(new HandleAdapter(dir.asHandle(), 'folder', 'x'), 'Already Here')
    const { ws } = await chooseFolder(dir)
    await vi.waitFor(() => expect(textarea()).not.toBeNull(), { timeout: 5000 })
    expect(ws.data?.workspace.name).toBe('Already Here')
    expect(document.body.textContent).not.toContain('Name your workspace')
  })

  it('does nothing when the picker is closed', async () => {
    window.showDirectoryPicker = async () => {
      throw new DOMException('closed', 'AbortError')
    }
    await start('/')
    button('Choose a folder').click()
    await flushPromises()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})

async function open(adapter: StorageAdapter = new MemoryAdapter()) {
  await createWorkspace(adapter, 'My Writing')
  const db = openDeviceDb(new IDBFactory())
  const session = await WorkspaceSession.open(adapter, {
    journal: new IdbJournal(() => db),
    debounceMs: 1e9,
  })
  const view = await start('/')
  view.ws.attach(session)
  await view.router.push(view.ws.startPath())
  await flushPromises()
  return { ...view, session, adapter }
}
const footer = () => document.querySelector('footer')!.textContent ?? ''
const type = async (text: string) => {
  const area = textarea()!
  area.value = text
  area.dispatchEvent(new Event('input'))
  await flushPromises()
}

describe('a real workspace on screen', () => {
  it('says Saving… while words wait, Saved once they are in the file, and counts them live', async () => {
    const { ws, adapter } = await open()
    expect(footer()).toContain('Saved')
    await type('Three little words')
    expect(footer()).toContain('Saving…')
    expect(footer()).toContain('3')
    expect(ws.words.scene).toBe(3)
    await ws.flush()
    await flushPromises()
    expect(footer()).toContain('Saved')
    const scene = (await adapter.list()).find((p) => p.includes('/scenes/'))!
    expect((await adapter.read(scene))!.text.endsWith('Three little words')).toBe(true)
  })

  it('offers a new scene in the command palette, and adds one', async () => {
    const { ws, router } = await open()
    useLayoutStore().paletteOpen = true
    await flushPromises()
    const item = [...document.querySelectorAll('[role="option"]')].find((o) =>
      o.textContent?.includes('New scene in this chapter'),
    ) as HTMLElement
    item.click()
    await vi.waitFor(() => expect(ws.scene?.meta.title).toBe('Untitled scene 2'))
    expect(ws.data?.scenes).toHaveLength(2)
    expect(router.currentRoute.value.path).toContain(ws.sceneId!)
  })

  it('keeps both texts and offers the choice when the file changed under unsaved words', async () => {
    const { adapter, session, ws } = await open()
    await type('mine')
    const path = (await adapter.list()).find((p) => p.includes('/scenes/'))!
    await adapter.write(path, `${(await adapter.read(path))!.text}theirs`)
    await session.checkScene(ws.sceneId!)
    await flushPromises()
    expect(footer()).toContain('Changed outside Aurelia')
    expect(document.body.textContent).toContain('changed outside Aurelia while it was open here')
    expect(textarea()!.value).toBe('mine')
    button('Compare versions').click()
    await flushPromises()
    expect(document.body.textContent).toContain('Your version')
    expect(document.body.textContent).toContain('The file’s version')
    expect(document.body.textContent).toContain('theirs')
  })

  it('says Reconnect folder, and keeps the words, when the browser takes the folder back', async () => {
    const dir = new FakeDirectory('Writing')
    const { session, ws } = await open(
      new HandleAdapter(dir.asHandle(), 'folder', 'the folder “Writing”'),
    )
    dir.permission = 'prompt'
    await session.checkScene(ws.sceneId!)
    await flushPromises()
    expect(document.body.textContent).toContain('Aurelia can’t reach the folder “Writing”')
    expect(footer()).toContain('Folder not connected')
    await type('written while disconnected')
    expect(textarea()!.value).toBe('written while disconnected')
    button('Reconnect folder').click() // the author's OK
    await vi.waitFor(() => expect(footer()).not.toContain('Folder not connected'))
    await ws.flush()
    await flushPromises()
    expect(footer()).toContain('Saved')
    const scene = dir.paths().find((p) => p.includes('/scenes/'))!
    const file = await new HandleAdapter(dir.asHandle(), 'folder', '').read(scene)
    expect(file!.text.endsWith('written while disconnected')).toBe(true)
  })

  it('shows a read-only workspace as read-only, with the update banner and no way to add or type', async () => {
    const adapter = new MemoryAdapter()
    await createWorkspace(adapter, 'Newer')
    const path = (await adapter.list()).find((p) => p.includes('/scenes/'))!
    await adapter.write(
      path,
      (await adapter.read(path))!.text.replace('schemaVersion: 1', 'schemaVersion: 9'),
    )
    const session = await WorkspaceSession.open(adapter, {
      journal: new IdbJournal(() => openDeviceDb(new IDBFactory())),
    })
    const view = await start('/')
    view.ws.attach(session)
    await view.router.push(view.ws.startPath())
    await flushPromises()
    expect(textarea()!.readOnly).toBe(true)
    expect(footer()).toContain('Read-only')
    expect(document.body.textContent).toContain('saved by a newer version of Aurelia')
    expect(button('New scene in this chapter')).toBeUndefined()
  })

  it('lists files it could not read, by path, and never as an empty page', async () => {
    const adapter = new MemoryAdapter()
    await createWorkspace(adapter, 'Broken')
    adapter.putBytes(
      'universes/unv_aaaaaaaaaa/books/bok_aaaaaaaaaa/scenes/scn_bbbbbbbbbb.md',
      new Uint8Array([0xff, 0xfe]),
    )
    const db = openDeviceDb(new IDBFactory())
    const session = await WorkspaceSession.open(adapter, { journal: new IdbJournal(() => db) })
    const view = await start('/')
    view.ws.attach(session)
    await view.router.push(view.ws.startPath())
    await flushPromises()
    expect(document.body.textContent).toContain('1 file could not be read')
    button('See files').click()
    await flushPromises()
    expect(document.body.textContent).toContain('scn_bbbbbbbbbb.md')
  })
})

/** A workspace one scene of which is from a newer Aurelia, open on screen. */
async function openNewer(locks?: FakeLocks) {
  const adapter = new MemoryAdapter()
  await createWorkspace(adapter, 'Newer')
  const path = (await adapter.list()).find((p) => p.includes('/scenes/'))!
  await adapter.write(
    path,
    (await adapter.read(path))!.text.replace('schemaVersion: 1', 'schemaVersion: 9'),
  )
  const db = openDeviceDb(new IDBFactory())
  const session = await WorkspaceSession.open(adapter, {
    journal: new IdbJournal(() => db),
    locks: locks?.asManager(),
  })
  const view = await start('/')
  view.ws.attach(session)
  await view.router.push(view.ws.startPath())
  await flushPromises()
  return view
}

describe('what the screens promise and say', () => {
  afterEach(() => {
    useAppUpdate().updateReady.value = false
  })

  it('offers “Get the update” only when an update is ready, else says to update when one is offered', async () => {
    await openNewer()
    expect(button('Get the update')).toBeUndefined()
    expect(button('Reload Aurelia')).toBeUndefined()
    expect(document.body.textContent).toContain('when it offers a new version')
    useAppUpdate().updateReady.value = true
    await flushPromises()
    expect(button('Get the update')).toBeDefined()
    expect(button('Reload Aurelia')).toBeUndefined()
  })

  it('says a second tab is read-only, plainly, and is not the newer-version banner', async () => {
    const locks = new FakeLocks()
    const adapter = new MemoryAdapter()
    await createWorkspace(adapter, 'Two tabs')
    const db = openDeviceDb(new IDBFactory())
    const journal = new IdbJournal(() => db)
    await WorkspaceSession.open(adapter, { journal, locks: locks.asManager() }) // the other tab
    const second = await WorkspaceSession.open(adapter, { journal, locks: locks.asManager() })
    const view = await start('/')
    view.ws.attach(second)
    await view.router.push(view.ws.startPath())
    await flushPromises()
    expect(document.body.textContent).toContain('This workspace is open in another tab')
    expect(document.body.textContent).toContain('Close that tab to write here.')
    expect(document.body.textContent).not.toContain('newer version')
    expect(textarea()!.readOnly).toBe(true)
    expect(button('New scene in this chapter')).toBeUndefined()
  })

  it('shows the safety-copy banner when IndexedDB cannot be used at all', async () => {
    const adapter = new MemoryAdapter()
    await createWorkspace(adapter, 'No IndexedDB')
    const session = await WorkspaceSession.open(adapter, {
      journal: new IdbJournal(() => Promise.reject(new Error('IndexedDB is not available.'))),
    })
    const view = await start('/')
    view.ws.attach(session)
    await view.router.push(view.ws.startPath())
    await flushPromises()
    expect(document.body.textContent).toContain('can’t keep its safety copy')
    expect(textarea()).not.toBeNull()
  })

  it('names the writing surface by its scene and draws only a gold caret, no ring', async () => {
    await open()
    const area = textarea()!
    expect(area.getAttribute('aria-labelledby')).toBe('scene-text scene-title')
    expect(document.getElementById('scene-title')?.tagName).toBe('H1')
    expect(document.getElementById('scene-title')?.textContent).toContain('Untitled scene')
    expect(area.className).toContain('caret-gold-ink')
    expect(area.className).toContain('outline-none!')
    expect(area.className).not.toMatch(/-mx-|-my-|px-3|rounded/)
  })

  it('focuses the name field when the name dialog opens', async () => {
    const dir = new FakeDirectory('Writing')
    await chooseFolder(dir)
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(document.querySelector('#new-workspace input')),
    )
  })
})

describe('what a screen reader hears', () => {
  const live = () => document.querySelector('footer [role="status"]')!
  /** Unsaved words, then the file changes under them. */
  const conflict = async (view: Awaited<ReturnType<typeof open>>) => {
    await type('mine')
    const path = (await view.adapter.list()).find((p) => p.includes('/scenes/'))!
    await view.adapter.write(path, `${(await view.adapter.read(path))!.text}theirs`)
    await view.session.checkScene(view.ws.sceneId!)
    await flushPromises()
  }

  it('keeps one permanent status region that is silent for routine saving and speaks for a conflict', async () => {
    const view = await open()
    const region = live()
    expect(region.textContent).toBe('')
    await type('typing')
    expect(footer()).toContain('Saving…')
    expect(region.textContent).toBe('') // routine progress stays quiet
    await conflict(view)
    expect(live()).toBe(region) // the same element: its text changed, so it is read out
    expect(region.textContent).toBe('Changed outside Aurelia')
  })

  it('puts every banner inside one polite live region that was already in the page', async () => {
    const view = await open()
    const region = document.querySelector('[aria-live="polite"]')!
    expect(region).not.toBeNull()
    expect(region.children).toHaveLength(0)
    await conflict(view)
    expect(document.querySelector('[aria-live="polite"]')).toBe(region)
    expect(region.textContent).toContain('changed outside Aurelia while it was open here')
  })

  it('says the status first, and whole, in the phone header and the navigator', async () => {
    const view = await open()
    await conflict(view)
    const whole = (root: Element) =>
      [...root.querySelectorAll('span')].find((e) => e.textContent === 'Changed outside Aurelia')!
    useLayoutStore().wide = false
    await flushPromises()
    const status = whole(document.querySelector('header')!)
    expect(status).toBeDefined()
    expect(status.className).toContain('shrink-0')
    expect(status.closest('.truncate')).toBeNull()
    expect(document.querySelector('header')!.textContent).toMatch(/words/)
    useLayoutStore().wide = true
    await flushPromises()
    const inNav = whole(document.querySelector('nav[aria-label="Workspace"]')!)
    expect(inNav).toBeDefined()
    expect(inNav.closest('.truncate')).toBeNull()
  })

  it('shows the check beside “Saved” in the phone header, as the Phone board does', async () => {
    await open()
    useLayoutStore().wide = false
    await flushPromises()
    const header = document.querySelector('header')!
    expect(header.textContent).toContain('Saved')
    expect(header.querySelector('svg.text-ok')).not.toBeNull()
  })
})

describe('opening the workspace that is already open', () => {
  afterEach(() => {
    delete (navigator as { locks?: unknown }).locks
  })

  it('lets the old session go first, so “open in another tab” never shows', async () => {
    Object.defineProperty(navigator, 'locks', {
      value: new FakeLocks().asManager(),
      configurable: true,
    })
    const dir = new FakeDirectory('Writing')
    await createWorkspace(new HandleAdapter(dir.asHandle(), 'folder', 'x'), 'Twice')
    const { ws, router } = await chooseFolder(dir)
    await vi.waitFor(() => expect(textarea()).not.toBeNull(), { timeout: 5000 })
    const first = ws.session
    const seen: boolean[] = []
    watch(
      () => ws.view?.otherTab,
      (v) => seen.push(!!v),
      { flush: 'sync' },
    )
    await router.push('/')
    await flushPromises()
    button('Choose a folder').click()
    await vi.waitFor(() => expect(ws.session && ws.session !== first).toBe(true), { timeout: 5000 })
    await flushPromises()
    expect(seen).not.toContain(true)
    expect(ws.view?.readOnly).toBe(false)
    expect(document.body.textContent).not.toContain('open in another tab')
  })
})

describe('the two dialogs', () => {
  it('says what went wrong in plain words, never the browser’s, and stays open', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const view = await open()
    await type('mine')
    const path = (await view.adapter.list()).find((p) => p.includes('/scenes/'))!
    await view.adapter.write(path, `${(await view.adapter.read(path))!.text}theirs`)
    await view.session.checkScene(view.ws.sceneId!)
    await flushPromises()
    view.session.resolveConflict = async () => {
      throw new Error('RAW browser detail: createWritable on FileSystemFileHandle failed')
    }
    button('Compare versions').click()
    await flushPromises()
    button('Keep mine').click()
    await flushPromises()
    const alert = document.querySelector('[role="dialog"] [role="alert"]')!
    expect(alert.textContent).toBe('That did not work. Nothing was lost.')
    expect(document.body.textContent).not.toContain('RAW browser detail')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('stays open, and busy, while "Use the file’s version" is applied, then closes', async () => {
    const view = await open()
    await type('mine')
    const path = (await view.adapter.list()).find((p) => p.includes('/scenes/'))!
    await view.adapter.write(path, `${(await view.adapter.read(path))!.text}theirs`)
    await view.session.checkScene(view.ws.sceneId!)
    await flushPromises()
    button('Compare versions').click()
    await flushPromises()
    const gate = gateRead(view.adapter as MemoryAdapter, path)
    button('Use the file’s version').click()
    await vi.waitFor(() => expect(gate.isHeld()).toBe(true))
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull() // the conflict is gone from the view, the dialog is not
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('has two versions')
    gate.release()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(textarea()!.value).toBe('theirs')
  })

  it('moves focus into the conflict dialog, and Escape closes it and gives focus back', async () => {
    const view = await open()
    await type('mine')
    const path = (await view.adapter.list()).find((p) => p.includes('/scenes/'))!
    await view.adapter.write(path, `${(await view.adapter.read(path))!.text}theirs`)
    await view.session.checkScene(view.ws.sceneId!)
    await flushPromises()
    const opener = button('Compare versions')
    opener.focus()
    opener.click()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(
        true,
      ),
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('lists a set-aside copy by its scene’s title first, and says where it goes once', async () => {
    const adapter = new MemoryAdapter()
    await createWorkspace(adapter, 'Copies')
    const path = (await adapter.list()).find((p) => p.includes('/scenes/'))!
    await adapter.write(
      path.replace('.md', ' (conflicted copy).md'),
      (await adapter.read(path))!.text,
    )
    await open(adapter).catch(() => undefined)
    await flushPromises()
    button('Review').click()
    await flushPromises()
    const dialog = document.querySelector('[role="dialog"]')!.textContent!
    expect(dialog.indexOf('“Untitled scene”')).toBeGreaterThan(-1)
    expect(dialog.indexOf('“Untitled scene”')).toBeLessThan(dialog.indexOf('(conflicted copy)'))
    expect(document.body.textContent!.split('.aurelia/conflicts')).toHaveLength(2)
  })
})

describe('a tab that has just taken over', () => {
  it('says it is getting ready while it settles, and the file dialog cannot reconcile meanwhile', async () => {
    const locks = new FakeLocks()
    const adapter = new MemoryAdapter()
    await createWorkspace(adapter, 'Settling')
    const path = (await adapter.list()).find((p) => p.includes('/scenes/'))!
    // A conflicted copy of the scene, so the Files dialog has something to reconcile.
    await adapter.write(
      path.replace('.md', ' (conflicted copy).md'),
      (await adapter.read(path))!.text,
    )
    const db = openDeviceDb(new IDBFactory())
    const deps = { journal: new IdbJournal(() => db), locks: locks.asManager() }
    const first = await WorkspaceSession.open(adapter, deps)
    const second = await WorkspaceSession.open(adapter, deps)
    const view = await start('/')
    view.ws.attach(second)
    await view.router.push(view.ws.startPath())
    await flushPromises()
    const gate = gateRead(adapter, path)
    first.dispose()
    await vi.waitFor(() => expect(gate.isHeld()).toBe(true))
    await flushPromises()
    expect(document.body.textContent).toContain('Getting this workspace ready')
    expect(document.body.textContent).not.toContain('open in another tab')
    expect(second.view().copies.length).toBeGreaterThan(0)
    button('Review').click()
    await flushPromises()
    expect(button('Keep the original').disabled).toBe(true)
    expect(button('Keep this copy').disabled).toBe(true)
    gate.release()
    await vi.waitFor(() =>
      expect(document.body.textContent).not.toContain('Getting this workspace'),
    )
    expect(button('Keep the original').disabled).toBe(false)
  })
})
