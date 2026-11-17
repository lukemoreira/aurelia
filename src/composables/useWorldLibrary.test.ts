// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeLocks } from '../../tests/helpers/fake-locks'
import { changes, outlineRig, snapshot } from '../../tests/helpers/outline-rig'
import { loadWorkspace } from '@/storage/load'
import { WorkspaceSession } from '@/storage/session'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { useMedia } from './useMedia'
import { useNewNames } from './useNewNames'
import { usePlaces } from './usePlaces'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

const inScope = <T>(make: () => T) => effectScope().run(make)!
const text = 'They sailed to Greywater at dusk. The bells of Greywater rang, and Greywater slept.'

async function openWithGreywater() {
  const rig = await outlineRig()
  const ws = useWorkspaceStore()
  ws.attach(rig.session)
  ws.select(rig.session.data.books[0]!.id)
  await rig.session.editScene(rig.session.data.scenes[0]!.meta.id, text)
  await rig.session.flush()
  return { ...rig, ws, edits: useEditsStore() }
}

describe('the Names panel', () => {
  it('lists a word that comes back often and is not a record yet', async () => {
    await openWithGreywater()
    const n = inScope(() => useNewNames())
    expect(n.names.value.map((x) => [x.word, x.count])).toEqual([['Greywater', 3]])
    expect(n.canEdit.value).toBe(true)
  })

  it('"Create place" makes a record of it, shared by the universe; the word then leaves the list', async () => {
    const { session, edits } = await openWithGreywater()
    const n = inScope(() => useNewNames())
    await n.create(n.names.value[0]!, 'place')
    const made = session.data.records.filter((r) => r.meta.title === 'Greywater')
    expect(made).toHaveLength(1)
    expect(made[0]!.meta).toMatchObject({ type: 'place', scope: 'universe' })
    expect(edits.toast?.text).toMatch(/Greywater/)
    expect(n.names.value).toEqual([])
  })

  it('"Create character" makes a character', async () => {
    const { session } = await openWithGreywater()
    const n = inScope(() => useNewNames())
    await n.create(n.names.value[0]!, 'character')
    expect(session.data.records.find((r) => r.meta.title === 'Greywater')!.meta.type).toBe(
      'character',
    )
  })

  it('"Not a name" is kept in the book, never in a scene, survives a reopen, and Undo gives the word back', async () => {
    const { session, adapter, open, edits } = await openWithGreywater()
    const scenePath = session.pathOf(session.data.scenes[0]!.meta.id)!
    const sceneBefore = (await adapter.read(scenePath))!.text
    const before = await snapshot(adapter)
    const n = inScope(() => useNewNames())
    await n.notAName(n.names.value[0]!)
    expect(n.names.value).toEqual([])
    expect(session.data.books[0]!.notNames).toEqual(['Greywater'])
    const diff = changes(before, await snapshot(adapter))
    expect(diff.changed).toEqual([expect.stringMatching(/book\.json$/)])
    expect((await adapter.read(scenePath))!.text).toBe(sceneBefore) // not one byte of the writing

    const again = await open()
    useWorkspaceStore().attach(again)
    useWorkspaceStore().select(again.data.books[0]!.id)
    expect(inScope(() => useNewNames()).names.value).toEqual([]) // every device agrees: it is in the folder

    await edits.toast!.undo!()
    expect(session.data.books[0]!.notNames).toBeUndefined()
    expect((await loadWorkspace(adapter)).problems).toEqual([])
  })

  it('does nothing in a read-only tab: the error is told, nothing is written', async () => {
    const { session, adapter, journal, ws, edits } = await openWithGreywater()
    const locks = new FakeLocks()
    const holder = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    const second = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    expect(second.view().otherTab).toBe(true)
    ws.attach(second)
    ws.select(second.data.books[0]!.id)
    const before = await snapshot(adapter)
    const n = inScope(() => useNewNames())
    expect(n.canEdit.value).toBe(false)
    const word = n.names.value[0]!
    await n.create(word, 'place')
    expect(edits.toast).toMatchObject({ error: true })
    await n.notAName(word)
    expect(edits.toast).toMatchObject({ error: true })
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
    holder.dispose()
    second.dispose()
    expect(session).toBeDefined()
  })

  it('in the sample (a tour with no files) nothing can be made', async () => {
    const ws = useWorkspaceStore()
    ws.loadSample()
    ws.select(ws.data!.books[0]!.id)
    const n = inScope(() => useNewNames())
    const records = ws.data!.records.length
    for (const word of n.names.value) {
      await n.create(word, 'character')
      await n.notAName(word)
    }
    expect(n.canEdit.value).toBe(false)
    expect(ws.data!.records).toHaveLength(records)
  })
})

describe('the gallery’s refusals', () => {
  const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })

  it('the sample cannot take images', async () => {
    const ws = useWorkspaceStore()
    ws.loadSample()
    ws.select(ws.data!.books[0]!.id)
    expect(await inScope(() => useMedia()).importFiles([file('a.png')])).toEqual([])
    expect(ws.data!.media ?? []).toEqual([])
  })

  it('another tab, a newer version: no image is added and nothing is written', async () => {
    const { adapter, journal, ws } = await openWithGreywater()
    const locks = new FakeLocks()
    const holder = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    const second = await WorkspaceSession.open(adapter, {
      journal,
      debounceMs: 1e9,
      locks: locks.asManager(),
    })
    ws.attach(second)
    ws.select(second.data.books[0]!.id)
    const before = await snapshot(adapter)
    const m = inScope(() => useMedia())
    expect(m.canEdit.value).toBe(false)
    expect(await m.importFiles([file('a.png')])).toEqual([])
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
    holder.dispose()
    second.dispose()
  })

  it('imports a chosen file, reports it, and a bad one is told in words while the good ones still go in', async () => {
    const { session, edits } = await openWithGreywater()
    const m = inScope(() => useMedia())
    const made = await m.importFiles([file('a.png'), file('notes.txt'), file('b.png')])
    expect(made).toHaveLength(2)
    expect(session.data.media).toHaveLength(2)
    // one line for how many went in, then one problem per line
    const lines = edits.toast!.text.split('\n')
    expect(lines[0]).toBe('Added 2 of 3 images.')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/notes\.txt.*not an image/)
    expect(edits.toast!.error).toBe(true)
    expect(m.items.value.map((x) => x.meta.name)).toEqual(['a.png', 'b.png'])
  })

  it('says plainly when none could be added, and when all went in', async () => {
    const { edits } = await openWithGreywater()
    const m = inScope(() => useMedia())
    await m.importFiles([file('notes.txt')])
    expect(edits.toast!.text.split('\n')[0]).toBe('Could not add the image.')
    await m.importFiles([file('a.png'), file('b.png')])
    expect(edits.toast).toEqual({ text: 'Added 2 images.' })
  })

  it('delete goes to the trash with a way back, and Undo restores the image', async () => {
    const { session, edits } = await openWithGreywater()
    const m = inScope(() => useMedia())
    const [id] = await m.importFiles([file('a.png')])
    await m.saveDetails(id!, { caption: ' The gate ', credit: '' })
    expect(session.data.media![0]!.meta).toMatchObject({ caption: 'The gate' })
    expect(session.data.media![0]!.meta.credit).toBeUndefined()
    await m.remove(id!)
    expect(session.data.media ?? []).toEqual([])
    expect(edits.toast?.text).toMatch(/Recently deleted/)
    await edits.toast!.undo!()
    expect(session.data.media!.map((x) => x.meta.id)).toEqual([id])
  })
})

describe('moving a place from the tree', () => {
  it('a drop inside, the keyboard’s out and in, and "Move to…" all make the same move, and a cycle is never offered', async () => {
    const { session, ws } = await openWithGreywater()
    const unv = session.data.universes[0]!.id
    const { addRecord } = await import('@/storage/record-actions')
    const earth = await addRecord(session, { type: 'world', title: 'Earth', universeId: unv })
    const france = await addRecord(session, { type: 'place', title: 'France', universeId: unv })
    const paris = await addRecord(session, { type: 'place', title: 'Paris', universeId: unv })
    const p = inScope(() => usePlaces())
    const parentOf = (id: string) => ws.data!.records.find((r) => r.meta.id === id)!.meta.parent

    expect(p.dropTarget(france, { id: earth })).toEqual({ id: earth, where: 'inside' })
    await p.move(france, earth) // what a drop does
    await p.move(paris, earth)
    expect(parentOf(france)).toBe(earth)
    p.onAction(paris, 'down') // Alt+↓: into the place above it (France sorts before Paris)
    await vi.waitFor(() => expect(parentOf(paris)).toBe(france))
    p.onAction(paris, 'up') // Alt+↑: out one level
    await vi.waitFor(() => expect(parentOf(paris)).toBe(earth))

    expect(p.dropTarget(earth, { id: france })).toBeNull() // it would sit inside itself
    expect(p.dropTarget(france, { id: france })).toBeNull()
    expect(p.destinations(earth).map((d) => d.value)).toEqual(['top']) // nothing under it to move into
    expect(p.destinations(paris).map((d) => d.value)).toEqual(['top', earth, france])
  })
})
