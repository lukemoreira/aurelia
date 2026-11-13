// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryAdapter } from '../../../tests/helpers/memory-adapter'
import { createWorkspace } from '@/storage/create'
import { StorageError } from '@/storage/errors'
import { openDeviceDb } from '@/storage/device-db'
import { IdbJournal } from '@/storage/journal'
import { recents } from '@/storage/app'
import { WorkspaceSession } from '@/storage/session'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import RenameWorkspaceDialog from './RenameWorkspaceDialog.vue'

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

let adapter: MemoryAdapter
async function setup() {
  adapter = new MemoryAdapter()
  await createWorkspace(adapter, 'My Book')
  const db = openDeviceDb(new IDBFactory())
  const session = await WorkspaceSession.open(adapter, {
    journal: new IdbJournal(() => db),
    debounceMs: 1e9,
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  const ws = useWorkspaceStore()
  ws.attach(session)
  const layout = useLayoutStore()
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  wrapper = mount(RenameWorkspaceDialog, { global: { plugins: [pinia] }, attachTo: document.body })
  layout.renameOpen = true
  await flushPromises()
  return { ws, layout, opener, session }
}
const input = () => document.querySelector<HTMLInputElement>('input')!
const save = () =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')!
const cancel = () =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel')!
async function type(text: string) {
  input().value = text
  input().dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}
const submit = async () => {
  document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await flushPromises()
}

beforeEach(() => localStorage.clear())

describe('the Rename workspace dialog', () => {
  it('opens with the current name in the field, selected and focused', async () => {
    await setup()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Rename workspace')
    expect(input().value).toBe('My Book')
    expect(document.activeElement).toBe(input())
    expect([input().selectionStart, input().selectionEnd]).toEqual([0, 'My Book'.length])
  })

  it('keeps Save disabled while the name is unchanged, empty or invalid', async () => {
    await setup()
    expect(save().disabled).toBe(true) // unchanged
    await type('  My Book  ')
    expect(save().disabled).toBe(true) // unchanged once trimmed
    await type('   ')
    expect(save().disabled).toBe(true)
    await type('x'.repeat(81))
    expect(save().disabled).toBe(true)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('under 80 letters')
    await type('bell\u0007')
    expect(save().disabled).toBe(true)
    await type('A new name')
    expect(save().disabled).toBe(false)
  })

  it('saves on submit: the name changes everywhere in the store, the file and the recent list; focus goes back', async () => {
    const { ws, layout, opener, session } = await setup()
    await recents.put({
      key: session.data.workspace.id,
      name: 'My Book',
      kind: 'browser',
      label: 'this browser',
      lastOpened: 1,
    })
    await type('  Fresh Name ')
    await submit()
    await vi.waitFor(() => expect(layout.renameOpen).toBe(false))
    expect(ws.data?.workspace.name).toBe('Fresh Name')
    expect(ws.view?.name).toBe('Fresh Name')
    expect(ws.saveState).toContain('Fresh Name')
    expect(JSON.parse((await adapter.read('aurelia.json'))!.text).name).toBe('Fresh Name')
    expect((await recents.get(session.data.workspace.id))?.name).toBe('Fresh Name')
    expect(document.activeElement).toBe(opener)
  })

  it('Cancel and Escape close it without changing anything', async () => {
    const { layout, ws, opener } = await setup()
    await type('Never saved')
    cancel().click()
    await flushPromises()
    expect(layout.renameOpen).toBe(false)
    expect(ws.view?.name).toBe('My Book')
    expect(document.activeElement).toBe(opener)

    layout.renameOpen = true
    await flushPromises()
    expect(input().value).toBe('My Book') // reopened with the current name, not the abandoned text
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(layout.renameOpen).toBe(false)
    expect(ws.view?.name).toBe('My Book')
  })

  it('says why in plain words when the workspace cannot be changed, and closes nothing', async () => {
    const { layout, session } = await setup()
    // A tab that cannot write: the dialog shows the session's own words and stays open.
    session.renameWorkspace = () =>
      Promise.reject(new StorageError('read-only', 'This workspace is open in another tab.'))
    await type('Other')
    await submit()
    expect(layout.renameOpen).toBe(true)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('another tab')
  })
})
