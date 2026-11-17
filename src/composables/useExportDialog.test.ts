// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { PROFILES_PATH } from '@/export/profile'
import { useEditsStore } from '@/stores/edits'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import { outlineRig } from '../../tests/helpers/outline-rig'
import { exportFixture } from '../../tests/helpers/export-fixture'

const saved = vi.hoisted(() => ({ files: [] as { name: string; size: number }[] }))
vi.mock('./useDownloadCopy', () => ({
  saveBlob: (blob: Blob, name: string) => saved.files.push({ name, size: blob.size }),
}))

import { useExportDialog } from './useExportDialog'

async function opened() {
  const rig = await outlineRig()
  const ws = useWorkspaceStore()
  ws.attach(rig.session)
  ws.bookId = rig.session.data.books[0]!.id
  const layout = useLayoutStore()
  layout.exportOpen = true
  const x = useExportDialog()
  await vi.waitFor(() => expect(x.profiles.value.length).toBeGreaterThan(0))
  return { rig, ws, layout, x }
}
const fileText = async (rig: Awaited<ReturnType<typeof outlineRig>>) =>
  (await rig.adapter.read(PROFILES_PATH))?.text

beforeEach(() => {
  setActivePinia(createPinia())
  saved.files = []
  localStorage.clear()
})

describe('profiles of the workspace', () => {
  it('starts with the standard profile and writes no file until one is saved', async () => {
    const { rig, x } = await opened()
    expect(x.profiles.value.map((p) => p.name)).toEqual(['Standard'])
    expect(x.dirty.value).toBe(false)
    expect(await fileText(rig)).toBeUndefined()
  })

  it('saves changes to a saved profile in the workspace file, and a later opening finds them', async () => {
    const { rig, layout, x } = await opened()
    x.newName.value = 'Agent'
    await x.saveAs()
    x.draft.author = 'Ada Writer'
    expect(x.dirty.value).toBe(true)
    await x.saveChanges()
    expect(JSON.parse((await fileText(rig))!)).toMatchObject({
      schemaVersion: 1,
      profiles: [{ name: 'Agent', author: 'Ada Writer' }],
    })
    expect(x.dirty.value).toBe(false)
    expect(x.notice.value).toBe('Saved “Agent”.')
    layout.exportOpen = false
    layout.exportOpen = true
    await nextTick()
    await vi.waitFor(() => expect(x.draft.author).toBe('Ada Writer'))
  })

  it('never writes over the built-in Standard: its changes are kept only by Save as new', async () => {
    const { rig, x } = await opened()
    x.draft.author = 'Ada Writer'
    expect(x.saved.value).toBe(false)
    await x.saveChanges()
    expect(await fileText(rig)).toBeUndefined()
  })

  it('saves a new profile under a name and selects it; deleting it goes back to the standard one', async () => {
    const { rig, x } = await opened()
    x.draft.format = 'epub'
    x.newName.value = 'Agent'
    await x.saveAs()
    expect(x.profiles.value.map((p) => p.name)).toEqual(['Standard', 'Agent'])
    expect(x.draft).toMatchObject({ name: 'Agent', format: 'epub' })
    expect(x.saved.value).toBe(true)
    await x.remove()
    expect(x.profiles.value.map((p) => p.name)).toEqual(['Standard'])
    expect(x.selectedId.value).toBe('standard')
    expect(JSON.parse((await fileText(rig))!).profiles).toEqual([])
  })

  it('says so, and leaves the file as it is, when the saved settings cannot be read', async () => {
    const { rig, x } = await opened()
    await rig.adapter.write(PROFILES_PATH, '{ not json')
    x.newName.value = 'X'
    await x.saveAs()
    expect(x.error.value).toMatch(/left as they are/)
    expect(await fileText(rig)).toBe('{ not json')
  })

  it('keeps profiles in memory in the sample, which has no files', async () => {
    const ws = useWorkspaceStore()
    ws.loadSample()
    ws.bookId = ws.data!.books[0]!.id
    const layout = useLayoutStore()
    layout.exportOpen = true
    const x = useExportDialog()
    x.newName.value = 'Sample profile'
    await x.saveAs()
    expect(x.profiles.value.map((p) => p.name)).toEqual(['Standard', 'Sample profile'])
  })
})

describe('Export', () => {
  it('downloads a Word file named after the book, closes the dialog and says so', async () => {
    const { ws, layout, x } = await opened()
    x.draft.format = 'docx'
    await x.run()
    expect(saved.files).toHaveLength(1)
    expect(saved.files[0]!.name).toBe(`${ws.data!.books[0]!.title}.docx`)
    expect(saved.files[0]!.size).toBeGreaterThan(1000)
    expect(layout.exportOpen).toBe(false)
    expect(useEditsStore().toast?.text).toMatch(/Exported .*\.docx/)
  })

  it('a PDF opens the print view instead of downloading', async () => {
    const { layout, x } = await opened()
    x.draft.format = 'pdf'
    await x.run()
    expect(saved.files).toEqual([])
    expect(layout.print?.html).toContain('class="chapter"')
    expect(layout.print?.css).toContain('@page')
    expect(layout.exportOpen).toBe(false)
  })

  it('exports the draft as it is on screen, even before it is saved', async () => {
    const ws = useWorkspaceStore()
    ws.loadSample()
    ws.bookId = ws.data!.books[0]!.id
    useLayoutStore().exportOpen = true
    const x = useExportDialog()
    x.draft.format = 'markdown'
    await x.run()
    expect(saved.files[0]!.name).toMatch(/\(Markdown\)\.zip$/)
  })

  it('does nothing when no book is open', async () => {
    const ws = useWorkspaceStore()
    ws.load(exportFixture())
    const x = useExportDialog()
    await x.run()
    expect(saved.files).toEqual([])
  })
})

describe('moving between saved settings', () => {
  it('asks before dropping changes that are not saved, and drops them only when told to', async () => {
    const { x } = await opened()
    x.newName.value = 'Agent'
    await x.saveAs()
    x.draft.author = 'Changed'
    x.choose('standard')
    expect(x.pendingId.value).toBe('standard')
    expect(x.selectedId.value).not.toBe('standard')
    expect(x.draft.author).toBe('Changed')
    x.keepEditing()
    expect(x.pendingId.value).toBeNull()
    x.choose('standard')
    x.confirmSwitch()
    expect(x.selectedId.value).toBe('standard')
    expect(x.draft.author).toBe('')
  })

  it('switches at once when nothing is unsaved', async () => {
    const { x } = await opened()
    x.newName.value = 'Agent'
    await x.saveAs()
    x.choose('standard')
    expect(x.pendingId.value).toBeNull()
    expect(x.selectedId.value).toBe('standard')
  })

  it('does not carry a setting this version does not know from one profile to another', async () => {
    const { rig, x } = await opened()
    await rig.adapter.write(
      PROFILES_PATH,
      JSON.stringify({ schemaVersion: 1, profiles: [{ id: 'exp_a', name: 'A', future: 'x' }] }),
    )
    x.newName.value = 'B'
    await x.saveAs() // reloads the file, with A in it
    x.choose('exp_a')
    expect((x.draft as Record<string, unknown>).future).toBe('x')
    x.choose('standard')
    expect('future' in x.draft).toBe(false)
  })

  it('says what was saved and deleted, and asks before a delete is done in the UI', async () => {
    const { x } = await opened()
    x.newName.value = 'Agent'
    await x.saveAs()
    expect(x.notice.value).toBe('Saved as “Agent”.')
    await x.remove()
    expect(x.notice.value).toBe('Deleted “Agent”.')
    expect(x.confirmingDelete.value).toBe(false)
  })
})

describe('what the dialog says about the book', () => {
  it('counts the scenes that are in no chapter and so are not exported', async () => {
    const { rig, x } = await opened()
    expect(x.unfiled.value).toBe(0)
    const ws = useWorkspaceStore()
    const scene = rig.session.data.scenes[0]!
    ws.load({
      ...ws.data!,
      scenes: [
        ...ws.data!.scenes,
        { ...scene, meta: { ...scene.meta, id: 'scn_loose00001', chapter: 'chp_gone000000' } },
      ],
    })
    expect(x.unfiled.value).toBe(1)
  })

  it('will not export an e-book with a language that is not a language tag', async () => {
    const { x } = await opened()
    x.draft.format = 'epub'
    x.draft.language = 'not a language'
    expect(x.languageError.value).toMatch(/language code/)
    await x.run()
    expect(saved.files).toEqual([])
    x.draft.language = 'fr-CA'
    expect(x.languageError.value).toBe('')
    await x.run()
    expect(saved.files).toHaveLength(1)
  })

  it('remembers where focus was, for the print view to give it back to', async () => {
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    const { layout } = await opened()
    expect(layout.printReturn).toBe(button)
    button.remove()
  })
})
