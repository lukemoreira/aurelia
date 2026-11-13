// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeDav, davFetch } from '../../../tests/helpers/fake-dav'
import { RemoteError } from '../errors'
import { WebDavStore, detectServer, parseMultistatus } from './webdav-store'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array) => new TextDecoder().decode(b)

let dav: FakeDav
let store: WebDavStore
beforeEach(() => {
  dav = new FakeDav()
  store = new WebDavStore('/dav/', davFetch(dav))
})

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof RemoteError ? e.code : `other: ${e}`),
  )

describe('WebDavStore', () => {
  it('writes a file (making the folders above it) and reads it back with its tag', async () => {
    const tag = await store.write('Aurelia/My Book (wsp_a)/current/a.md', bytes('héllo ✓'))
    expect(tag).toMatch(/^"\d+"$/)
    const file = await store.read('Aurelia/My Book (wsp_a)/current/a.md')
    expect(text(file!.bytes)).toBe('héllo ✓')
    expect(file!.etag).toBe(tag)
    expect(dav.folders.has('Aurelia/My Book (wsp_a)/current')).toBe(true)
  })

  it('reads a missing file as null and lists a missing folder as empty', async () => {
    expect(await store.read('nope.md')).toBeNull()
    expect(await store.list('Aurelia')).toEqual([])
  })

  it('lists the children of a folder with their kind, size and tag, names decoded', async () => {
    dav.seed('Aurelia/Café (wsp_a)/backup.json', '{"a":1}')
    dav.seed('Aurelia/Café (wsp_a)/versions/x.zip', 'zz')
    const root = await store.list('Aurelia')
    expect(root.map((e) => [e.name, e.path, e.folder])).toEqual([
      ['Café (wsp_a)', 'Aurelia/Café (wsp_a)', true],
    ])
    const inside = await store.list('Aurelia/Café (wsp_a)')
    const manifest = inside.find((e) => e.name === 'backup.json')!
    expect([
      manifest.folder,
      manifest.size,
      manifest.etag,
      manifest.modified instanceof Date,
    ]).toEqual([false, 7, dav.files.get('Aurelia/Café (wsp_a)/backup.json')!.etag, true])
    expect(inside.find((e) => e.name === 'versions')!.folder).toBe(true)
  })

  it('writes only when the tag still matches (If-Match), and says so when it does not', async () => {
    const first = await store.write('m.json', bytes('1'))
    await store.write('m.json', bytes('2'), { ifMatch: first! })
    expect(await code(store.write('m.json', bytes('3'), { ifMatch: first! }))).toBe('precondition')
    expect(dav.text('m.json')).toBe('2')
    // A file that is not there fails If-Match too: a missing file is not the one we read.
    expect(await code(store.write('gone.json', bytes('x'), { ifMatch: '"1"' }))).toBe(
      'precondition',
    )
    expect(dav.text('gone.json')).toBeNull()
  })

  it('creates a file only when there is none yet (If-None-Match: *)', async () => {
    await store.write('m.json', bytes('mine'), { ifNoneMatch: '*' })
    expect(await code(store.write('m.json', bytes('theirs'), { ifNoneMatch: '*' }))).toBe(
      'precondition',
    )
    expect(dav.text('m.json')).toBe('mine')
  })

  it('of two writers holding the same tag, exactly one wins', async () => {
    const tag = (await store.write('m.json', bytes('0')))!
    const results = await Promise.all(
      ['a', 'b', 'c'].map((who) => code(store.write('m.json', bytes(who), { ifMatch: tag }))),
    )
    expect(results.filter((r) => r === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r === 'precondition')).toHaveLength(2)
  })

  it('removes a file; removing what is not there is not an error; If-Match guards it', async () => {
    const tag = (await store.write('a/b.md', bytes('x')))!
    expect(await code(store.remove('a/b.md', { ifMatch: '"nope"' }))).toBe('precondition')
    await store.remove('a/b.md', { ifMatch: tag })
    await store.remove('a/b.md')
    expect(await store.read('a/b.md')).toBeNull()
  })

  it('makes every folder on the way, and a folder that exists is fine', async () => {
    await store.mkdir('a/b/c')
    await store.mkdir('a/b/c')
    expect([...dav.folders].sort()).toEqual(['', 'a', 'a/b', 'a/b/c'])
  })

  it('moves a file, and refuses to replace one when told not to', async () => {
    await store.write('a/x.zip', bytes('1'))
    await store.write('a/taken.zip', bytes('2'))
    await store.move('a/x.zip', 'a/y.zip', { overwrite: false })
    expect(dav.text('a/y.zip')).toBe('1')
    await store.write('a/z.zip', bytes('3'))
    expect(await code(store.move('a/z.zip', 'a/taken.zip', { overwrite: false }))).toBe(
      'precondition',
    )
    await store.move('a/z.zip', 'a/taken.zip')
    expect(dav.text('a/taken.zip')).toBe('3')
  })

  it('names what went wrong: sign-in, size, server trouble and no network', async () => {
    dav.authorized = false
    expect(await code(store.read('a'))).toBe('unauthorized')
    expect(await code(store.write('a', bytes('x')))).toBe('unauthorized')
    dav.authorized = true
    dav.down = true
    expect(await code(store.list('a'))).toBe('server')
    dav.down = false
    const big = new Uint8Array(64 * 1024 * 1024 + 1)
    expect(await code(store.write('big.bin', big))).toBe('too-large')
    const offline = new WebDavStore('/dav/', () => Promise.reject(new TypeError('Failed to fetch')))
    expect(await code(offline.read('a'))).toBe('offline')
  })

  it('treats a redirect as a login page: sign in again, never follow it', async () => {
    const redirected = new WebDavStore('/dav/', async () =>
      Object.defineProperty(new Response(null), 'type', { value: 'opaqueredirect' }),
    )
    expect(await code(redirected.read('a'))).toBe('unauthorized')
  })

  it('a folder that cannot be made is a conflict', async () => {
    const refuse = new WebDavStore('/dav/', async () => new Response(null, { status: 409 }))
    expect(await code(refuse.write('a/b.md', bytes('x')))).toBe('conflict')
  })

  it('percent-encodes names in the address and sends nothing the server must guess', async () => {
    await store.write('Aurelia/My Writing (wsp_a) – Chrome on macOS/backup.json', bytes('{}'))
    expect(dav.paths()).toEqual(['Aurelia/My Writing (wsp_a) – Chrome on macOS/backup.json'])
  })
})

describe('parseMultistatus', () => {
  it('reads a server that uses the default namespace and an absolute href', () => {
    const xml = `<?xml version="1.0"?><multistatus xmlns="DAV:">
      <response><href>http://host/dav/Aurelia/</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response>
      <response><href>/dav/Aurelia/A%20B%20(wsp_1)/</href><propstat><prop><resourcetype><collection/></resourcetype><getlastmodified>Wed, 12 Nov 2026 18:30:00 GMT</getlastmodified></prop></propstat></response>
      <response><href>/dav/Aurelia/a.md</href><propstat><prop><resourcetype/><getetag>"abc"</getetag><getcontentlength>12</getcontentlength></prop></propstat></response>
    </multistatus>`
    const rows = parseMultistatus(xml)
    expect(rows.map((r) => [r.path, r.folder, r.etag, r.size])).toEqual([
      ['Aurelia', true, null, 0],
      ['Aurelia/A B (wsp_1)', true, null, 0],
      ['Aurelia/a.md', false, '"abc"', 12],
    ])
    expect(rows[1]!.modified?.toISOString()).toBe('2026-11-12T18:30:00.000Z')
  })
})

describe('detectServer', () => {
  it('says there is a server, that it wants a sign-in, or that there is none here', async () => {
    expect(await detectServer('/dav/', davFetch(dav))).toBe('available')
    dav.authorized = false
    expect(await detectServer('/dav/', davFetch(dav))).toBe('sign-in')
    dav.authorized = true
    dav.down = true
    expect(await detectServer('/dav/', davFetch(dav))).toBe('none')
    expect(await detectServer('/dav/', () => Promise.reject(new TypeError('offline')))).toBe('none')
  })

  it('does not take a page that answers every address for a server (no DAV header)', async () => {
    const spa = async () => new Response('<html></html>', { status: 200 })
    expect(await detectServer('/dav/', spa)).toBe('none')
  })
})
