// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest'
import { readZip } from '../../tests/helpers/read-zip'
import { syncWorld, type SimDevice, type SyncWorld } from '../../tests/helpers/sync-rig'
import { outlineCache, outlineMarkdown } from '@/domain/outline-files'
import { hashText } from '@/storage/hash'
import { addChapter } from '@/storage/outline-actions'
import { WebDavStore } from '@/storage/remote/webdav-store'
import { davFetch } from '../../tests/helpers/fake-dav'
import { fetchBackup } from './restore'
import { manifestSchema } from './manifest'

let world: SyncWorld
afterEach(() => world?.dispose())

const sceneId = (d: SimDevice) => d.session.data.scenes[0]!.meta.id
const bodyOf = (d: SimDevice, id = sceneId(d)) =>
  d.session.data.scenes.find((s) => s.meta.id === id)?.body
/** Type on a device and let it reach the file. */
async function type(d: SimDevice, text: string, id = sceneId(d)) {
  await d.session.editScene(id, text)
  await d.session.flush()
}
/** A second scene, written and flushed. Returns its id and path. */
async function addScene(d: SimDevice, text = '') {
  const id = await d.session.createScene(d.session.data.chapters[0]!.id)
  if (text) await type(d, text, id)
  const path = (await d.scenePaths()).find((p) => p.includes(id))!
  return { id, path }
}
const copies = async (d: SimDevice) =>
  (await d.adapter.list()).filter((p) => /\(Aurelia copy [0-9a-f]{8}\)/.test(p))
const manifest = () => manifestSchema.parse(world.dav.json(`${world.folder}/backup.json`))
const current = (path: string) => world.dav.text(`${world.folder}/current/${path}`)
const onServer = () =>
  world.dav.paths(`${world.folder}/current/`).map((p) => p.slice(world.folder.length + 9))
const versions = () => world.dav.paths(`${world.folder}/versions/`)
/** Every text in every file of a device, joined: "is this word anywhere here?" */
const everything = async (d: SimDevice) => [...(await d.files()).values()].join('\n')

describe('pull and push', () => {
  it('a scene typed on A appears on B, and the open scene on B updates in place', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await type(a, 'The bells had already started.')
    await a.round()
    expect(bodyOf(b)).toBe('')
    await b.round()
    expect(bodyOf(b)).toBe('The bells had already started.')
  })

  it('goes both ways, and a new scene on one device is a new scene on the other', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const first = sceneId(a)
    const made = await addScene(b, 'Born on B.')
    await type(a, 'Typed on A.', first)
    await b.round()
    await a.round()
    await b.round()
    expect(bodyOf(a, made.id)).toBe('Born on B.')
    expect(bodyOf(b, first)).toBe('Typed on A.')
  })

  it('writes backup.json for the set of devices, with files that match current/', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await type(a, 'One.')
    await a.round()
    await b.round()
    const m = manifest()
    expect(Object.keys(m.sync!.devices)).toHaveLength(2)
    expect(Object.keys(m.files).sort()).toEqual(onServer().sort())
    for (const [path, f] of Object.entries(m.files))
      expect(await hashText(current(path)!)).toBe(f.hash)
    expect(world.dav.unconditional.filter((l) => l.includes('/current/'))).toEqual([])
  })

  it('nothing is written to current/ without If-Match or If-None-Match', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await type(a, 'A.')
    await type(b, 'B.')
    await a.round()
    await b.round()
    await a.round()
    expect(world.dav.unconditional.filter((l) => l.includes('/current/'))).toEqual([])
  })

  it('a device that changed nothing sends nothing', async () => {
    world = await syncWorld()
    const b = await world.join('Safari on iOS')
    world.dav.log.length = 0
    await b.round()
    expect(world.dav.log.filter((l) => l.startsWith('PUT') || l.startsWith('DELETE'))).toEqual([])
    expect(world.dav.log.filter((l) => l.startsWith('GET') && l.includes('/current/'))).toEqual([]) // each file's base was set when it was restored
  })
})

describe('a file changed on two devices', () => {
  it('keeps both texts: mine stays in the file, theirs is a copy that reaches everyone', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    b.online = false
    await type(a, 'Typed on A while B was away.')
    await a.round()
    await type(b, 'Typed on B while it was offline.')
    b.online = true
    await b.round()
    const [copy] = await copies(b)
    expect(copy).toBeDefined()
    expect(bodyOf(b)).toBe('Typed on B while it was offline.') // mine stays
    expect((await b.adapter.read(copy!))!.text).toContain('Typed on A while B was away.')
    expect(b.session.view().copies.map((c) => c.path)).toEqual([copy])
    await a.round()
    await b.round()
    expect(await copies(a)).toEqual([copy])
    expect(bodyOf(a)).toBe('Typed on B while it was offline.')
    expect(await everything(a)).toContain('Typed on A while B was away.')
    expect([...(await a.files())]).toEqual([...(await b.files())])
  })

  it('the same two texts met on two devices make one copy, not two', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const c = await world.join('Firefox on Windows')
    b.online = c.online = false
    await type(a, 'Mine, from A.')
    await a.round()
    await type(b, 'Theirs.')
    await type(c, 'Theirs.')
    b.online = c.online = true
    await b.round()
    await c.round()
    for (const d of [a, b, c, a, b, c]) await d.round()
    const names = (await Promise.all([a, b, c].map(copies))).map((x) => x.join())
    expect(new Set(names).size).toBe(1)
    expect((await a.files()).size).toBe((await b.files()).size)
  })

  it('a write that loses a race (412) re-reads and keeps both', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const [path] = await a.scenePaths()
    await type(a, 'Mine.')
    // Between A's listing and its write, another device's text lands on the server.
    let done = false
    a.beforeRequest = (method, p) => {
      if (method === 'PUT' && p.endsWith(path!) && !done) {
        done = true
        world.dav.tamper(`${world.folder}/current/${path}`, `${current(path!)}Theirs.\n`)
      }
    }
    await a.round()
    expect(done).toBe(true)
    await a.round()
    expect(await everything(a)).toContain('Mine.')
    expect(await everything(a)).toContain('Theirs.')
    await b.round()
    expect(await everything(b)).toContain('Mine.')
    expect(await everything(b)).toContain('Theirs.')
  })

  it('unsaved edits when the other device’s text arrives become a conflict, and both choices keep both texts', async () => {
    for (const choice of ['mine', 'theirs'] as const) {
      world = await syncWorld()
      const a = world.devices[0]!
      const b = await world.join('Safari on iOS')
      const [path] = await b.scenePaths()
      await type(a, 'From A.')
      await a.round()
      // B is typing as its round reads the file: the words are not saved yet.
      let typing = false
      b.beforeRequest = async (method, p) => {
        if (method === 'GET' && p.endsWith(path!) && !typing) {
          typing = true
          await b.session.editScene(sceneId(b), 'Unsaved on B.')
        }
      }
      await b.round()
      expect(typing).toBe(true)
      const view = b.session.view()
      expect(view.conflicts).toHaveLength(1)
      expect(view.conflicts[0]!.mine).toContain('Unsaved on B.')
      expect(view.conflicts[0]!.theirs).toContain('From A.')
      expect(bodyOf(b)).toBe('Unsaved on B.') // still on screen
      await b.session.resolveConflict(path!, choice)
      await b.round()
      await a.round()
      await b.round()
      for (const d of [a, b]) {
        expect(await everything(d)).toContain('Unsaved on B.')
        expect(await everything(d)).toContain('From A.')
      }
      expect([...(await a.files())]).toEqual([...(await b.files())])
      world.dispose()
    }
  })

  it('a text that was changed here after the round looked is deferred, then met as a conflict next round', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const [path] = await b.scenePaths()
    await type(a, 'From A.')
    await a.round()
    let once = true
    b.beforeRequest = async (method, p) => {
      if (method === 'GET' && p.endsWith(path!) && once) {
        once = false
        await type(b, 'Saved on B meanwhile.') // reaches the file after the scan
      }
    }
    await b.round()
    expect(bodyOf(b)).toBe('Saved on B meanwhile.') // not overwritten
    await b.round()
    expect(await everything(b)).toContain('From A.')
    expect(await everything(b)).toContain('Saved on B meanwhile.')
  })
})

describe('the workspace file changed on two devices', () => {
  const edit = async (d: SimDevice, change: (json: Record<string, unknown>) => void) => {
    const json = JSON.parse((await d.adapter.read('aurelia.json'))!.text) as Record<string, unknown>
    change(json)
    await d.adapter.write('aurelia.json', `${JSON.stringify(json, null, 2)}\n`)
  }

  it('only its lists differing, they are put together: no copy, and every device ends with both', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await edit(a, (j) => (j.universes as string[]).push('unv_fromA'))
    await a.round()
    await edit(b, (j) => (j.universes as string[]).push('unv_fromB'))
    await b.round()
    await a.round()
    expect(await copies(b)).toEqual([])
    for (const d of [a, b]) {
      const universes = JSON.parse((await d.adapter.read('aurelia.json'))!.text)
        .universes as string[]
      expect(universes).toEqual(expect.arrayContaining(['unv_fromA', 'unv_fromB']))
    }
    expect(JSON.parse(current('aurelia.json')!).universes).toHaveLength(3)
    expect([...(await a.files())]).toEqual([...(await b.files())])
  })

  it('anything but a list differing is still a conflict, and both texts are kept', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await edit(a, (j) => (j.name = 'Named on A'))
    await a.round()
    await edit(b, (j) => {
      j.name = 'Named on B'
      ;(j.universes as string[]).push('unv_fromB')
    })
    await b.round()
    expect(await copies(b)).toHaveLength(1)
    expect(await everything(b)).toContain('Named on A')
    expect(await everything(b)).toContain('Named on B')
  })
})

describe('derived files, the trash and the set-aside texts', () => {
  const bookOf = (d: SimDevice) => d.session.data.books[0]!.id
  const outlineFiles = async (d: SimDevice) =>
    (await d.adapter.list()).filter((p) => /\/(OUTLINE\.md|book\.json)$/.test(p))

  it('a conflict on a book’s outline files makes no copy: both devices end with the outline of all the scenes', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const [fileA] = await outlineFiles(a)
    expect(fileA).toBeDefined()
    // Each device adds a chapter on its own: OUTLINE.md and the outline cache in book.json differ on both sides.
    await addChapter(a.session, bookOf(a), { title: 'From A' })
    await addChapter(b.session, bookOf(b), { title: 'From B' })
    for (const d of [a, b, a, b, a, b]) await d.round()
    for (const d of [a, b]) {
      expect(await copies(d)).toEqual([])
      expect((await d.adapter.list()).some((p) => /OUTLINE.* copy|book.* copy/.test(p))).toBe(false)
      const outline = (await d.adapter.read(
        (await outlineFiles(d)).find((p) => p.endsWith('OUTLINE.md'))!,
      ))!.text
      expect(outline).toContain('From A')
      expect(outline).toContain('From B')
      expect(outline).toBe(outlineMarkdown(d.session.data, bookOf(d)))
      const book = JSON.parse(
        (await d.adapter.read((await outlineFiles(d)).find((p) => p.endsWith('book.json'))!))!.text,
      )
      expect(book.outline).toEqual(outlineCache(d.session.data, bookOf(d)))
    }
    expect([...(await a.files())]).toEqual([...(await b.files())])
  })

  it('a conflict on the title in book.json, which is the author’s text, still keeps both', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const path = (await outlineFiles(a)).find((p) => p.endsWith('book.json'))!
    const retitle = async (d: SimDevice, title: string) => {
      const json = JSON.parse((await d.adapter.read(path))!.text)
      await d.adapter.write(path, `${JSON.stringify({ ...json, title }, null, 2)}\n`)
    }
    await retitle(a, 'Title from A')
    await retitle(b, 'Title from B')
    await a.round()
    await b.round()
    expect(await copies(b)).toHaveLength(1)
    expect(await everything(b)).toContain('Title from A')
    expect(await everything(b)).toContain('Title from B')
  })

  it('the trash and the set-aside texts sync like any file, and a purged trash goes from every device', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const trash =
      '.aurelia/trash/2026-11-12T18-00-00-000Z/universes/unv_a/books/bok_a/chapters/chp_a.md'
    const aside =
      '.aurelia/conflicts/2026-11-12T18-00-00-000Z/universes/unv_a/books/bok_a/scenes/scn_a.md'
    await a.adapter.write(trash, 'Deleted chapter.')
    await a.adapter.write(aside, 'Set-aside text.')
    await a.round()
    expect(current(trash)).toBe('Deleted chapter.')
    expect(current(aside)).toBe('Set-aside text.')
    await b.round()
    expect((await b.adapter.read(trash))?.text).toBe('Deleted chapter.')
    expect((await b.adapter.read(aside))?.text).toBe('Set-aside text.')
    await a.adapter.remove(trash) // the trash is emptied
    await a.round()
    await b.round()
    expect(await b.adapter.read(trash)).toBeNull()
    expect((await b.adapter.read(aside))?.text).toBe('Set-aside text.') // never deleted by sync
  })
})

describe('deletes', () => {
  it('a scene deleted on A is gone on B, and does not come back', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const gone = await addScene(a, 'Soon deleted.')
    await a.round()
    await b.round()
    expect(bodyOf(b, gone.id)).toBe('Soon deleted.')
    await a.adapter.remove(gone.path)
    await a.round()
    expect(current(gone.path)).toBeNull()
    expect(manifest().sync!.tombstones[gone.path]?.hash).toBe(
      await hashText((await b.adapter.read(gone.path))!.text),
    )
    await b.round()
    expect(await b.adapter.read(gone.path)).toBeNull()
    expect(bodyOf(b, gone.id)).toBeUndefined()
    for (const d of [a, b, a, b]) await d.round()
    expect(await a.adapter.read(gone.path)).toBeNull()
    expect(await b.adapter.read(gone.path)).toBeNull()
    expect(current(gone.path)).toBeNull()
  })

  it('a version of the workspace is saved before the deleted file is removed here', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const gone = await addScene(a, 'Kept in a version.')
    await a.round()
    await b.round()
    world.advance(60_000)
    await a.adapter.remove(gone.path)
    await a.round()
    await b.round()
    const zip = versions().find((p) => p.endsWith('_before-sync.zip'))!
    const files = readZip(world.dav.files.get(zip)!.bytes)
    expect(files.find((f) => f.path.endsWith(gone.path))?.text).toContain('Kept in a version.')
  })

  it('an edit beats a delete: deleted on A, edited on B — the edit comes back to both', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const gone = await addScene(a, 'Original.')
    await a.round()
    await b.round()
    b.online = false
    await a.adapter.remove(gone.path)
    await a.round()
    await type(b, 'Original. And more, written on B.', gone.id)
    b.online = true
    await b.round()
    await a.round()
    expect(current(gone.path)).toContain('And more, written on B.')
    expect(bodyOf(a, gone.id)).toBe('Original. And more, written on B.')
  })

  it('an edit beats a delete the other way: edited on A, deleted on B', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const gone = await addScene(a, 'Original.')
    await a.round()
    await b.round()
    b.online = false
    await type(a, 'Original. Edited on A.', gone.id)
    await a.round()
    await b.adapter.remove(gone.path)
    b.online = true
    await b.round()
    expect(bodyOf(b, gone.id)).toBe('Original. Edited on A.')
    expect(current(gone.path)).toContain('Edited on A.')
  })

  it('words the author brought back are never deleted again: a file this device has no record of goes up, and its tombstone goes', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const c = await world.join('Firefox on Windows')
    const gone = await addScene(a, 'Deleted, then brought back.')
    await a.round()
    await c.round()
    const text = (await c.adapter.read(gone.path))!.text
    // C forgets what it had agreed on (a restored device database, say).
    await c.state.save({ ...(await c.state.load(world.id)), base: {} })
    await a.adapter.remove(gone.path)
    await a.round()
    expect(manifest().sync!.tombstones[gone.path]).toBeDefined()
    await c.round() // C's file has exactly the deleted bytes
    expect(await c.adapter.read(gone.path)).not.toBeNull()
    expect(current(gone.path)).toBe(text)
    expect(manifest().sync!.tombstones[gone.path]).toBeUndefined()
    await a.round()
    expect(bodyOf(a, gone.id)).toBe('Deleted, then brought back.')
  })

  it('deleting most of the workspace on A deletes it on B too: it is a decision, not a lost volume', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    for (let i = 0; i < 5; i++) await addScene(a, `Scene ${i}.`)
    await a.round()
    const b = await world.join('Safari on iOS')
    expect((await b.scenePaths()).length).toBe(6)
    const victims = (await a.scenePaths()).slice(0, 5)
    for (const p of victims) await a.adapter.remove(p)
    await a.session.checkAll()
    await a.round()
    expect((await a.scenePaths()).length).toBe(1)
    await b.round()
    await a.round()
    await b.round()
    for (const d of [a, b]) expect((await d.scenePaths()).length).toBe(1)
    expect(onServer().filter((p) => p.includes('/scenes/'))).toHaveLength(1)
    for (const p of victims) expect(current(p)).toBeNull()
  })

  it('a tombstone survives the manifest write losing its race', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const gone = await addScene(a, 'Deleted while B writes.')
    await a.round()
    await b.round()
    await a.adapter.remove(gone.path)
    await a.session.checkAll()
    // B's round lands between A's delete and A's manifest write.
    let fired = false
    a.beforeRequest = async (method, p) => {
      if (!fired && method === 'PUT' && p.endsWith('backup.json')) {
        fired = true
        await type(b, 'B writes elsewhere.')
        await b.round()
      }
    }
    await a.round()
    expect(fired).toBe(true)
    expect(manifest().sync!.tombstones[gone.path]).toBeDefined()
  })
})

describe('a device back from a long time away', () => {
  it('gets every change and loses none of its own', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const first = sceneId(a)
    const second = await addScene(a, 'Second scene.')
    await a.round()
    await b.round()
    b.online = false
    for (let day = 1; day <= 7; day++) {
      await type(a, `Day ${day} on A.`, second.id)
      await a.round()
      world.advance(86_400_000)
    }
    const third = await addScene(a, 'Third, from A.')
    await a.round()
    await type(b, 'Typed on B all week.', first)
    const own = await addScene(b, 'Born on B while away.')
    await b.round().catch(() => undefined)
    expect(b.engine.view().status).toBe('offline')
    expect(b.engine.view().sync!.waiting).toBeGreaterThanOrEqual(2)
    b.online = true
    await b.round()
    await a.round()
    for (const d of [a, b]) {
      expect(bodyOf(d, second.id)).toBe('Day 7 on A.')
      expect(bodyOf(d, third.id)).toBe('Third, from A.')
      expect(bodyOf(d, own.id)).toBe('Born on B while away.')
      expect(bodyOf(d, first)).toBe('Typed on B all week.')
    }
    expect([...(await a.files())]).toEqual([...(await b.files())])
  })

  it('what waits while offline is still waiting after the device database is read again', async () => {
    world = await syncWorld()
    const b = await world.join('Safari on iOS')
    b.online = false
    await type(b, 'Written offline.')
    await b.round()
    expect(b.engine.view().status).toBe('offline')
    const saved = await b.state.load(world.id)
    expect(saved.mode).toBe('sync')
    expect(Object.keys(saved.base!).length).toBeGreaterThan(0)
    b.online = true
    await b.round()
    expect(b.engine.view().status).toBe('idle')
    expect(current((await b.scenePaths())[0]!)).toContain('Written offline.')
  })
})

describe('before remote changes are applied', () => {
  it('saves a version first, with the text as it was, and stops if it cannot', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await type(b, 'B’s own text.')
    await b.round()
    await a.round()
    await type(a, 'B’s own text. Then A wrote more.')
    world.advance(60_000)
    await a.round()
    // The version cannot be saved: B keeps its file as it is.
    b.beforeRequest = (method, p) => {
      if (method === 'PUT' && p.includes('/versions/')) throw new TypeError('down')
    }
    await b.round()
    expect(bodyOf(b)).toBe('B’s own text.')
    expect(b.engine.view().status).toBe('offline')
    b.beforeRequest = undefined
    await b.round()
    expect(bodyOf(b)).toBe('B’s own text. Then A wrote more.')
    const zip = versions()
      .filter((p) => p.endsWith('_before-sync.zip'))
      .at(-1)! // B's, the later
    const old = readZip(world.dav.files.get(zip)!.bytes).find((f) => /scenes\//.test(f.path))!
    expect(old.text).toContain('B’s own text.')
    expect(old.text).not.toContain('Then A wrote more.')
  })

  it('a version is saved before every delete, even right after another', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const first = await addScene(a, 'First, to be deleted.')
    const second = await addScene(a, 'Second, to be deleted.')
    await type(a, 'An overwrite for B to pull.')
    await a.round()
    await b.round() // pulls: a version (the overwrite)
    const before = versions().filter((p) => p.endsWith('_before-sync.zip')).length
    for (const gone of [first, second]) {
      world.advance(1000) // a minute is not ten
      await a.adapter.remove(gone.path)
      await a.session.checkAll()
      await a.round()
      await b.round()
    }
    expect(versions().filter((p) => p.endsWith('_before-sync.zip'))).toHaveLength(before + 2)
  })

  it('every pull that overwrites has its version, however recent the last; a retried round adds none', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    const count = () => versions().filter((p) => p.endsWith('_before-sync.zip')).length
    for (const [i, text] of ['One.', 'One. Two.', 'One. Two. Three.'].entries()) {
      world.advance(1000)
      await type(a, text)
      await a.round()
      await b.round()
      expect(count()).toBe(i + 1)
    }
    // A round that fails after its version is tried again with the workspace unchanged: no second zip.
    world.advance(1000)
    await type(a, 'One. Two. Three. Four.')
    await a.round()
    let failed = false
    b.beforeRequest = (method, p) => {
      if (method === 'GET' && p.includes('/scenes/') && !failed) {
        failed = true
        throw new TypeError('offline')
      }
    }
    await b.round()
    expect(b.engine.view().status).toBe('offline')
    b.beforeRequest = undefined
    await b.round()
    expect(bodyOf(b)).toBe('One. Two. Three. Four.')
    expect(count()).toBe(4)
  })

  it('two versions of different text made in the same second are two files: none is dropped', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    // The clock never moves: every version below has the same second in its name.
    for (const text of ['First.', 'First. Second.']) {
      await type(a, text)
      await a.round()
      await b.round()
    }
    const mine = versions().filter((p) => p.includes('_before-sync'))
    expect(mine).toHaveLength(2)
    expect(new Set(mine.map((p) => p.replace(/~[0-9a-f]{8}/, ''))).size).toBe(1) // the same second and reason
    const texts = mine.map((p) =>
      readZip(world.dav.files.get(p)!.bytes)
        .map((f) => f.text)
        .join('\n'),
    )
    // The second pull's version holds B's text as the first pull left it: dropped, it would be lost.
    expect(texts.some((t) => t.includes('First.') && !t.includes('Second.'))).toBe(true)
  })

  it('a server that lost its files while a device was behind: the newer text it overwrites is in a version a restore can open', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    // A recent version already exists, so a thinned one would be skipped.
    await type(b, 'Old text.')
    await b.round()
    await a.round()
    b.online = false
    world.advance(60_000)
    await type(a, 'Old text. Newer text, only on A and the server.')
    await a.round()
    world.dav.files.forEach((_, p) => p.includes('/current/') && world.dav.files.delete(p))
    b.online = true
    await b.round() // B was behind: it puts its older text back up
    expect(current((await b.scenePaths())[0]!)).toBe(
      (await b.adapter.read((await b.scenePaths())[0]!))!.text,
    )
    world.advance(1000)
    await a.round() // A's copy was unchanged since it agreed, so it takes B's: its newer text is replaced here
    expect(bodyOf(a)).toBe('Old text.')
    const zip = versions()
      .filter((p) => p.endsWith('_before-sync.zip'))
      .at(-1)!
    const fetched = await fetchBackup(
      new WebDavStore('/dav/', davFetch(world.dav)),
      world.folder,
      zip.slice(zip.lastIndexOf('/') + 1),
    )
    expect(fetched.problems).toEqual([])
    expect(
      [...fetched.files.values()].map((f) => new TextDecoder().decode(f)).join('\n'),
    ).toContain('Newer text, only on A and the server.')
  })
})

describe('backup and sync together', () => {
  it('turning sync on where backup already ran needs no download: the manifest seeds the base', async () => {
    world = await syncWorld('Chrome on macOS', { sync: false })
    const a = world.devices[0]!
    await a.engine.turnOn()
    await type(a, 'Backed up first.')
    await a.round()
    world.dav.log.length = 0
    await a.engine.turnOnSync()
    expect(world.dav.log.filter((l) => l.startsWith('GET') && l.includes('/current/'))).toEqual([])
    expect(world.dav.log.filter((l) => l.startsWith('PUT') && l.includes('/current/'))).toEqual([])
    expect(manifest().sync!.devices).toBeDefined()
    expect(a.engine.view().mode).toBe('sync')
  })

  it('hourly versions go on with sync on', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    expect(versions()).toHaveLength(1)
    world.advance(2 * 3_600_000)
    await type(a, 'An hour later.')
    await a.round()
    expect(versions().length).toBeGreaterThanOrEqual(2)
  })

  it('a synced device is not asked about the folder when another synced device wrote the manifest', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await type(a, 'A.')
    await a.round()
    await type(b, 'B.')
    await b.round()
    expect(manifest().deviceName).toBe('Safari on iOS')
    await a.round()
    expect(a.engine.view().status).toBe('idle')
    expect(b.engine.view().ask).toBeNull()
  })

  it('a device that only backs up is asked when it meets a synced folder it does not own', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await type(a, 'A wrote last.')
    await a.round()
    await b.engine.turnOff()
    await b.engine.turnOn() // plain backup into the same folder
    expect(b.engine.view().status).toBe('ask')
    expect(b.engine.view().ask).not.toBeNull()
  })

  it('a device that syncs does not take over the plain backup of another device', async () => {
    world = await syncWorld('Chrome on macOS', { sync: false })
    const a = world.devices[0]!
    await a.engine.turnOn()
    const b = await world.join('Safari on iOS')
    await b.engine.turnOnSync()
    expect(b.engine.view().status).toBe('ask')
    expect(manifest().sync).toBeUndefined()
  })

  it('a plain backup rewriting the manifest keeps the sync member', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    await a.engine.turnOff()
    await a.engine.turnOn()
    await type(a, 'Backed up, not synced.')
    await a.round()
    expect(manifest().sync?.devices).toBeDefined()
  })

  it('turning sync off leaves the device list, keeps backing up to a folder of its own, and the other devices go on', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await b.round()
    expect(Object.keys(manifest().sync!.devices)).toHaveLength(2)
    await b.engine.turnOffSync()
    expect(Object.keys(manifest().sync!.devices)).toHaveLength(1)
    const view = b.engine.view()
    expect([view.enabled, view.mode, view.status]).toEqual([true, 'backup', 'idle'])
    expect(view.folder).toMatch(/ – Safari on iOS [0-9a-f]{6}$/)
    expect(world.dav.paths(`${view.folder}/current/`).length).toBeGreaterThan(0)
    await type(b, 'B backs up alone now.')
    await b.round()
    expect(
      world.dav
        .paths(`${view.folder}/current/`)
        .some((p) => world.dav.text(p)?.includes('B backs up alone now.')),
    ).toBe(true)
    expect(current((await a.scenePaths())[0]!)).not.toContain('B backs up alone now.')
    await type(a, 'A goes on.')
    await a.round()
    expect(current((await a.scenePaths())[0]!)).toContain('A goes on.')
  })

  it('turning sync on again, after backing up on its own, goes back to the shared folder', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await b.engine.turnOffSync()
    expect(b.engine.view().folder).not.toBe(world.folder)
    await type(a, 'A, meanwhile.')
    await a.round()
    await b.engine.turnOnSync()
    expect(b.engine.view().folder).toBe(world.folder)
    expect(b.engine.view().status).toBe('idle')
    expect(bodyOf(b)).toBe('A, meanwhile.')
    expect(Object.keys(manifest().sync!.devices)).toHaveLength(2)
  })

  it('a device that backs up into a folder that others sync is offered to join, and joins with both texts kept', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await b.engine.turnOffSync()
    await type(a, 'A wrote this.')
    await a.round() // A wrote last
    await type(b, 'B wrote this, on its own.')
    // B's backup state points at the shared folder, as plain backup.
    await b.state.save({
      ...(await b.state.load(world.id)),
      enabled: true,
      folder: world.folder,
      base: undefined,
    })
    await b.engine.run(true)
    expect(b.engine.view().status).toBe('ask')
    expect(b.engine.view().ask).toMatchObject({ sync: true })
    await b.engine.turnOnSync() // "Join the sync"
    expect(b.engine.view().status).toBe('idle')
    expect(b.session.data.workspace.id).toBe(world.id) // the same workspace, not a copy
    await a.round()
    for (const d of [a, b]) {
      expect(await everything(d)).toContain('A wrote this.')
      expect(await everything(d)).toContain('B wrote this, on its own.')
    }
    expect(Object.keys(manifest().sync!.devices)).toHaveLength(2)
  })

  it('a synced workspace shows something waiting from the first change until the round that sends it', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    expect(a.engine.view().sync!.waiting).toBe(0)
    await type(a, 'Typed.')
    expect(a.engine.view().sync!.waiting).toBeGreaterThan(0)
    await a.round()
    expect(a.engine.view().sync!.waiting).toBe(0)
  })
})

describe('restore and keep it in sync', () => {
  it('the copy has the same workspace ID, its base from the restore, and nothing to upload', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    await type(a, 'Before the second device.')
    await a.round()
    const b = await world.join('Safari on iOS')
    expect(b.session.data.workspace.id).toBe(world.id)
    expect(bodyOf(b)).toBe('Before the second device.')
    const s = await b.state.load(world.id)
    expect([s.enabled, s.mode, s.folder]).toEqual([true, 'sync', world.folder])
    expect(Object.keys(s.base!).sort()).toEqual(onServer().sort())
    world.dav.log.length = 0
    await b.round()
    expect(world.dav.log.filter((l) => l.startsWith('PUT') && l.includes('/current/'))).toEqual([])
    // Its first change is an If-Match against what it restored.
    await type(b, 'Typed on the restored copy.')
    await b.round()
    expect(world.dav.unconditional.filter((l) => l.includes('/current/'))).toEqual([])
    expect(current((await b.scenePaths())[0]!)).toContain('Typed on the restored copy.')
  })

  it('a restored copy that is behind never overwrites what the server has since', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await type(a, 'Newer, from A.')
    await a.round()
    await type(b, 'B’s own change, from an old base.')
    await b.round()
    expect(await everything(b)).toContain('Newer, from A.')
    expect(await everything(b)).toContain('B’s own change, from an old base.')
  })
})

describe('when it must not run', () => {
  it('a read-only or settling workspace does not sync, and nothing is applied to it', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await type(a, 'From A.')
    await a.round()
    b.blocked = true
    await b.round()
    expect(b.engine.view().status).toBe('blocked')
    expect(bodyOf(b)).toBe('')
    b.blocked = false
    await b.round()
    expect(bodyOf(b)).toBe('From A.')
  })

  it('the session itself refuses remote changes while it is settling after another tab took over, or read-only', async () => {
    world = await syncWorld()
    const b = await world.join('Safari on iOS')
    const [path] = await b.scenePaths()
    const disk = (await b.adapter.read(path!))!
    const change = [{ path: path!, text: 'x', expect: disk.hash }]
    const session = b.session as unknown as { settling: boolean; newer: boolean }
    for (const flag of ['settling', 'newer'] as const) {
      session[flag] = true
      await expect(b.session.applyRemote(change)).rejects.toThrow(/read-only/)
      expect((await b.adapter.read(path!))!.text).toBe(disk.text)
      session[flag] = false
    }
    expect(await b.session.applyRemote(change)).toEqual(new Map([[path!, 'applied']]))
  })

  it('a sign-in that ran out pauses, and a new one carries on', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    await type(a, 'Waiting for a sign-in.')
    world.dav.authorized = false
    await a.round()
    expect(a.engine.view().status).toBe('paused')
    world.dav.authorized = true
    await a.round()
    expect(a.engine.view().status).toBe('idle')
    expect(current((await a.scenePaths())[0]!)).toContain('Waiting for a sign-in.')
  })
})

describe('the server and the manifest', () => {
  it('a manifest that fell behind (a device died after its uploads) is put right by the next round', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await type(a, 'Uploaded, manifest not.')
    await a.round()
    const m = manifest()
    const path = Object.keys(m.files).find((p) => p.includes('/scenes/'))!
    world.dav.tamper(
      `${world.folder}/backup.json`,
      JSON.stringify({ ...m, files: { ...m.files, [path]: { ...m.files[path]!, hash: 'stale' } } }),
    )
    await b.round()
    expect(manifest().files[path]!.hash).toBe(await hashText(current(path)!))
  })

  it('a server that lost its files gets them back from the devices; nobody deletes anything', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const b = await world.join('Safari on iOS')
    await type(a, 'Must survive a lost volume.')
    await a.round()
    await b.round()
    const before = [...(await a.files()).keys()]
    world.dav.files.clear()
    await a.round()
    expect([...(await a.files()).keys()]).toEqual(before)
    expect(onServer().sort()).toEqual(before.sort())
    await b.round()
    expect([...(await b.files()).keys()]).toEqual(before)
  })

  it('several files vanishing from the server at once are put back, not deleted here', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    for (let i = 0; i < 6; i++) await addScene(a, `Scene ${i}.`)
    await a.round()
    const before = [...(await a.files()).keys()]
    for (const p of onServer().filter((p) => p.includes('/scenes/')))
      world.dav.files.delete(`${world.folder}/current/${p}`)
    await a.round()
    expect([...(await a.files()).keys()]).toEqual(before)
    expect(onServer().sort()).toEqual(before.sort())
  })

  it('a file on the server that is not text is left alone', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    const path = `${world.folder}/current/images/cover.png`
    world.dav.folders.add(`${world.folder}/current/images`)
    world.dav.files.set(path, {
      bytes: new Uint8Array([0xff, 0xfe, 0x00, 0x80]),
      etag: '"png"',
      modified: new Date(),
    })
    await a.round()
    expect(await a.adapter.read('images/cover.png').catch(() => 'unreadable')).toBeNull()
    expect(world.dav.files.has(path)).toBe(true)
    expect(a.engine.view().status).toBe('idle')
  })

  it('a server that gives no version tags cannot be synced with, and says so', async () => {
    world = await syncWorld()
    const a = world.devices[0]!
    for (const f of world.dav.files.values()) f.etag = ''
    await a.round()
    expect(a.engine.view().status).toBe('failed')
    expect(a.engine.view().error).toMatch(/version tag/)
  })
})
