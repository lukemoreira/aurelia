// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { isId } from '@/domain/ids'
import { changes, outlineRig, snapshot } from '../../tests/helpers/outline-rig'
import { loadWorkspace } from './load'
import { addBook, deleteItem, renameItem, restoreDeleted, setDetails } from './outline-actions'
import { aliasesPatch, addRecord } from './record-actions'

const universe = (s: { data: { universes: { id: string }[] } }) => s.data.universes[0]!.id

describe('records: create', () => {
  it('a character is one new file under the universe’s records, with the details at the top', async () => {
    const { session, adapter } = await outlineRig()
    const before = await snapshot(adapter)
    const id = await addRecord(session, {
      type: 'character',
      title: '  Elena Vasquez ',
      universeId: universe(session),
    })
    expect(isId(id, 'chr')).toBe(true)
    const diff = changes(before, await snapshot(adapter))
    expect(diff).toEqual({ changed: [], added: [`records/characters/${id}.md`], removed: [] })
    const text = (await adapter.read(session.pathOf(id)!))!.text
    expect(text).toBe(
      `---\ntitle: "Elena Vasquez"\nschemaVersion: 1\nid: "${id}"\ntype: "character"\nscope: "universe"\n---\n\n`,
    )
    const loaded = await loadWorkspace(adapter)
    expect(loaded.problems).toEqual([])
    expect(loaded.data.records.map((r) => [r.meta.title, r.meta.scope, r.universe])).toEqual([
      ['Elena Vasquez', 'universe', universe(session)],
    ])
  })

  it('a place private to one book lives in that book’s folder and says so in its scope', async () => {
    const { session, adapter } = await outlineRig()
    const book = session.data.books[0]!.id
    const id = await addRecord(session, {
      type: 'place',
      title: 'The Lantern Gate',
      universeId: universe(session),
      bookId: book,
    })
    expect(session.pathOf(id)).toBe(
      `universes/${universe(session)}/books/${book}/records/places/${id}.md`,
    )
    const record = (await loadWorkspace(adapter)).data.records[0]!
    expect(record.meta).toMatchObject({ type: 'place', scope: `book:${book}` })
  })

  it('every type is filed under its own folder with its own ID prefix', async () => {
    const { session } = await outlineRig()
    const folders: Record<string, string> = {}
    for (const type of [
      'character',
      'place',
      'item',
      'event',
      'arc',
      'lore',
      'research',
    ] as const) {
      const id = await addRecord(session, { type, title: type, universeId: universe(session) })
      folders[type] = session.pathOf(id)!.split('/').at(-2)!
      expect(session.data.records.find((r) => r.meta.id === id)?.meta.type).toBe(type)
    }
    expect(folders).toEqual({
      character: 'characters',
      place: 'places',
      item: 'items',
      event: 'events',
      arc: 'arcs',
      lore: 'lore',
      research: 'research',
    })
  })

  it('refuses an empty or unreadable name, an unknown universe, and writes nothing', async () => {
    const { session, adapter } = await outlineRig()
    const before = await snapshot(adapter)
    for (const title of ['', '  ', 'a\nb', 'x'.repeat(201)])
      await expect(
        addRecord(session, { type: 'character', title, universeId: universe(session) }),
      ).rejects.toThrow()
    await expect(
      addRecord(session, { type: 'character', title: 'X', universeId: 'unv_aaaaaaaaaa' }),
    ).rejects.toThrow(/no longer/)
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })
})

describe('records: edit', () => {
  async function elena() {
    const rig = await outlineRig()
    const id = await addRecord(rig.session, {
      type: 'character',
      title: 'Elena Vasquez',
      universeId: universe(rig.session),
    })
    return { ...rig, id }
  }

  it('rename, summary, role and names change only their own lines, in one file', async () => {
    const { session, adapter, id } = await elena()
    const path = session.pathOf(id)!
    const before = await snapshot(adapter)
    await renameItem(session, id, 'Helena Vasquez')
    await setDetails(session, id, {
      summary: 'A smuggler’s daughter.',
      role: 'Protagonist',
      aliases: aliasesPatch([{ text: 'Elena' }, { text: 'Lena', match: 'ask' }]),
    })
    expect(changes(before, await snapshot(adapter)).changed).toEqual([
      path.replace(/^universes\/unv_\w+\//, ''),
    ])
    expect((await adapter.read(path))!.text).toBe(
      `---\ntitle: "Helena Vasquez"\nschemaVersion: 1\nid: "${id}"\ntype: "character"\nscope: "universe"\n` +
        `summary: "A smuggler’s daughter."\nrole: "Protagonist"\naliases:\n  - { text: "Elena" }\n  - { text: "Lena", match: "ask" }\n---\n\n`,
    )
    const loaded = (await loadWorkspace(adapter)).data.records[0]!
    expect(loaded.meta.aliases).toEqual([{ text: 'Elena' }, { text: 'Lena', match: 'ask' }])
    expect(loaded.summary).toBe('A smuggler’s daughter.')
  })

  it('names: trimmed, no empty one, no repeat, the default match is not written, none takes the key away', () => {
    expect(
      aliasesPatch([
        { text: ' Elena ' },
        { text: 'Elena' },
        { text: '  ' },
        { text: 'Lena', match: 'auto' },
        { text: 'Vasquez', match: 'never' },
      ]),
    ).toEqual([{ text: 'Elena' }, { text: 'Lena' }, { text: 'Vasquez', match: 'never' }])
    expect(aliasesPatch([{ text: 'Elena', note: 'from the import' } as never])).toEqual([
      { text: 'Elena', note: 'from the import' },
    ])
    expect(aliasesPatch([])).toBeUndefined()
    expect(aliasesPatch([{ text: ' ' }])).toBeUndefined()
  })

  it('notes are the text under the details: edited through the pipeline, details untouched', async () => {
    const { session, adapter, id } = await elena()
    const path = session.pathOf(id)!
    await setDetails(session, id, { summary: 'Courier.' })
    const head = (await adapter.read(path))!.text
    await session.editNotes(id, 'Born in the Lantern Quarter.\n\nOwes everyone.')
    await session.flush()
    expect((await adapter.read(path))!.text).toBe(
      `${head}Born in the Lantern Quarter.\n\nOwes everyone.`,
    )
    expect((await loadWorkspace(adapter)).data.records[0]?.body).toBe(
      'Born in the Lantern Quarter.\n\nOwes everyone.',
    )
    // and a detail changed afterwards keeps the notes
    await setDetails(session, id, { role: 'Courier' })
    expect((await adapter.read(path))!.text).toContain('Owes everyone.')
  })

  it('refuses a value the schema does not allow (a number for the summary), and writes nothing', async () => {
    const { session, adapter, id } = await elena()
    const before = await snapshot(adapter)
    await expect(setDetails(session, id, { summary: 12 })).rejects.toThrow()
    expect(changes(before, await snapshot(adapter))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })

  it('a record deleted goes to the trash and comes back whole, with its notes', async () => {
    const { session, adapter, id } = await elena()
    await session.editNotes(id, 'Keep these words.')
    await session.flush()
    const path = session.pathOf(id)!
    const text = (await adapter.read(path))!.text
    const gone = await deleteItem(session, id)
    expect(session.data.records).toEqual([])
    expect(await adapter.read(path)).toBeNull()
    expect((await adapter.read(`.aurelia/trash/${gone.stamp}/${path}`))!.text).toBe(text)
    await restoreDeleted(session, gone.stamp)
    expect((await adapter.read(path))!.text).toBe(text)
    expect(session.data.records[0]?.body).toBe('Keep these words.')
  })

  it('deleting a book takes the records private to it along', async () => {
    const { session, adapter } = await outlineRig()
    const second = await addBook(session, { title: 'Second' })
    // Books of their own are standalone: their records live in that universe, under the book.
    const home = session.data.universes.find((u) => u.books.includes(second.book))!
    const id = await addRecord(session, {
      type: 'place',
      title: 'Only here',
      universeId: home.id,
      bookId: second.book,
    })
    await deleteItem(session, second.book)
    expect(session.data.records.find((r) => r.meta.id === id)).toBeUndefined()
    expect(
      await adapter.read(`universes/${home.id}/books/${second.book}/records/places/${id}.md`),
    ).toBeNull()
  })
})
