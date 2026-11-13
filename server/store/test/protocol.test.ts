// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dav } from './helpers.ts'
import type { Store } from './helpers.ts'
import { startStore } from './helpers.ts'

let s: Store
beforeEach(async () => (s = await startStore()))
afterEach(() => s.close())

const sha = (b: string) => `"${createHash('sha256').update(b).digest('hex')}"`
const put = (p: string, body: string, headers: Record<string, string> = {}) =>
  dav(s.port, 'PUT', p, { body, headers })

describe('OPTIONS and health', () => {
  it('OPTIONS /dav/ answers DAV: 1 and Allow', async () => {
    const r = await dav(s.port, 'OPTIONS', '/dav/')
    expect(r.status).toBe(200)
    expect(r.headers.dav).toBe('1')
    expect(r.headers.allow).toContain('PROPFIND')
  })
  it('/healthz needs no login and anything else under no /dav is 404', async () => {
    expect((await dav(s.port, 'GET', '/healthz')).status).toBe(200)
    expect((await dav(s.port, 'GET', '/other')).status).toBe(404)
    expect((await dav(s.port, 'GET', '/davx/a')).status).toBe(404)
  })
  it('any other method is 405', async () => {
    for (const m of ['POST', 'PATCH', 'COPY', 'LOCK', 'PROPPATCH'])
      expect((await dav(s.port, m, '/dav/a')).status, m).toBe(405)
  })
})

describe('PUT and GET', () => {
  it('creates (201), replaces (204), and returns a SHA-256 strong ETag', async () => {
    const a = await put('/dav/a.md', 'hello')
    expect(a.status).toBe(201)
    expect(a.headers.etag).toBe(sha('hello'))
    const b = await put('/dav/a.md', 'hello world')
    expect(b.status).toBe(204)
    expect(b.headers.etag).toBe(sha('hello world'))
    expect(await readFile(join(s.root, 'a.md'), 'utf8')).toBe('hello world')
  })
  it('GET and HEAD return the body, ETag, length, date and type', async () => {
    await put('/dav/a.md', 'héllo')
    const g = await dav(s.port, 'GET', '/dav/a.md')
    expect(g.status).toBe(200)
    expect(g.text).toBe('héllo')
    expect(g.headers.etag).toBe(sha('héllo'))
    expect(g.headers['content-length']).toBe('6')
    expect(g.headers['content-type']).toContain('text/markdown')
    expect(g.headers['last-modified']).toMatch(/GMT$/)
    expect(g.headers['cache-control']).toBe('no-store')
    const h = await dav(s.port, 'HEAD', '/dav/a.md')
    expect(h.status).toBe(200)
    expect(h.headers.etag).toBe(g.headers.etag)
    expect(h.text).toBe('')
  })
  it('GET of a missing file is 404, of a folder 405', async () => {
    expect((await dav(s.port, 'GET', '/dav/nope')).status).toBe(404)
    await mkdir(join(s.root, 'd'))
    expect((await dav(s.port, 'GET', '/dav/d')).status).toBe(405)
  })
  it('PUT with a missing parent is 409; PUT onto a folder or the root is 405', async () => {
    expect((await put('/dav/no/such/a.md', 'x')).status).toBe(409)
    await mkdir(join(s.root, 'd'))
    expect((await put('/dav/d', 'x')).status).toBe(405)
    expect((await put('/dav/', 'x')).status).toBe(405)
  })
  it('PUT below a file is 409', async () => {
    await put('/dav/f', 'x')
    expect((await put('/dav/f/g', 'x')).status).toBe(409)
  })
  it('names with spaces, unicode and reserved characters round-trip', async () => {
    const p = '/dav/Mon%20Livre/%C3%89l%C3%A9na%20%26%20co%3F.md'
    await dav(s.port, 'MKCOL', '/dav/Mon%20Livre')
    expect((await put(p, 'x')).status).toBe(201)
    expect(await readFile(join(s.root, 'Mon Livre', 'Éléna & co?.md'), 'utf8')).toBe('x')
    expect((await dav(s.port, 'GET', p)).text).toBe('x')
  })
})

describe('If-Match and If-None-Match on PUT', () => {
  it('If-None-Match: * creates only when absent', async () => {
    expect((await put('/dav/a', 'one', { 'If-None-Match': '*' })).status).toBe(201)
    expect((await put('/dav/a', 'two', { 'If-None-Match': '*' })).status).toBe(412)
    expect(await readFile(join(s.root, 'a'), 'utf8')).toBe('one')
  })
  it('If-Match replaces only when the ETag is current', async () => {
    const e1 = (await put('/dav/a', 'one')).headers.etag as string
    expect((await put('/dav/a', 'two', { 'If-Match': e1 })).status).toBe(204)
    expect((await put('/dav/a', 'three', { 'If-Match': e1 })).status).toBe(412)
    expect(await readFile(join(s.root, 'a'), 'utf8')).toBe('two')
    expect((await put('/dav/a', 'four', { 'If-Match': `"x", ${sha('two')}` })).status).toBe(204)
  })
  it('If-Match on a missing file is 412 (and nothing is created)', async () => {
    expect((await put('/dav/a', 'one', { 'If-Match': '"abc"' })).status).toBe(412)
    expect(await readdir(s.root)).toEqual([])
  })
  it('a failed precondition leaves no temp file', async () => {
    await put('/dav/a', 'one')
    await put('/dav/a', 'two', { 'If-None-Match': '*' })
    expect(await readdir(s.root)).toEqual(['a'])
  })
})

describe('MKCOL', () => {
  it('201, then 405 when it exists, 409 without a parent', async () => {
    expect((await dav(s.port, 'MKCOL', '/dav/d')).status).toBe(201)
    expect((await dav(s.port, 'MKCOL', '/dav/d/')).status).toBe(405)
    expect((await dav(s.port, 'MKCOL', '/dav/x/y')).status).toBe(409)
    expect((await dav(s.port, 'MKCOL', '/dav/')).status).toBe(405)
  })
})

describe('DELETE', () => {
  it('deletes files (204), folders with content (204), 404 when missing', async () => {
    await put('/dav/a', 'x')
    await dav(s.port, 'MKCOL', '/dav/d')
    await put('/dav/d/b', 'x')
    expect((await dav(s.port, 'DELETE', '/dav/a')).status).toBe(204)
    expect((await dav(s.port, 'DELETE', '/dav/d')).status).toBe(204)
    expect((await dav(s.port, 'DELETE', '/dav/d')).status).toBe(404)
    expect(await readdir(s.root)).toEqual([])
  })
  it('honours If-Match on files', async () => {
    const e = (await put('/dav/a', 'x')).headers.etag as string
    expect(
      (await dav(s.port, 'DELETE', '/dav/a', { headers: { 'If-Match': '"no"' } })).status,
    ).toBe(412)
    expect((await dav(s.port, 'DELETE', '/dav/a', { headers: { 'If-Match': e } })).status).toBe(204)
  })
  it('never deletes the root', async () => {
    await put('/dav/a', 'x')
    expect((await dav(s.port, 'DELETE', '/dav/')).status).toBe(405)
    expect(await readdir(s.root)).toEqual(['a'])
  })
})

describe('MOVE', () => {
  const move = (from: string, to: string, headers: Record<string, string> = {}) =>
    dav(s.port, 'MOVE', from, { headers: { Destination: to, ...headers } })
  it('moves a file (201) with a path or a full URL as Destination', async () => {
    await put('/dav/a', 'x')
    expect((await move('/dav/a', '/dav/b')).status).toBe(201)
    expect((await move('/dav/b', `http://localhost:30080/dav/c`)).status).toBe(201)
    expect(await readdir(s.root)).toEqual(['c'])
  })
  it('Overwrite: F is 412 when the target exists; default overwrites (204)', async () => {
    await put('/dav/a', 'A')
    await put('/dav/b', 'B')
    expect((await move('/dav/a', '/dav/b', { Overwrite: 'F' })).status).toBe(412)
    expect(await readFile(join(s.root, 'b'), 'utf8')).toBe('B')
    expect((await move('/dav/a', '/dav/b', { Overwrite: 'T' })).status).toBe(204)
    expect(await readFile(join(s.root, 'b'), 'utf8')).toBe('A')
    expect(await readdir(s.root)).toEqual(['b'])
  })
  it('moves folders, and replaces a folder when overwriting', async () => {
    await dav(s.port, 'MKCOL', '/dav/d1')
    await put('/dav/d1/f', '1')
    await dav(s.port, 'MKCOL', '/dav/d2')
    await put('/dav/d2/g', '2')
    expect((await move('/dav/d1', '/dav/d2')).status).toBe(204)
    expect(await readdir(join(s.root, 'd2'))).toEqual(['f'])
    expect((await move('/dav/d2', '/dav/d3')).status).toBe(201)
  })
  it('404 without source, 409 without destination parent, 400 without Destination', async () => {
    expect((await move('/dav/nope', '/dav/b')).status).toBe(404)
    await put('/dav/a', 'x')
    expect((await move('/dav/a', '/dav/no/b')).status).toBe(409)
    expect((await dav(s.port, 'MOVE', '/dav/a')).status).toBe(400)
    expect((await move('/dav/a', '/dav/b', { Overwrite: 'maybe' })).status).toBe(400)
  })
  it('refuses a destination outside /dav, onto itself, or inside itself', async () => {
    await dav(s.port, 'MKCOL', '/dav/d')
    await put('/dav/a', 'x')
    expect((await move('/dav/a', '/elsewhere/a')).status).toBe(502)
    expect((await move('/dav/a', '/dav/a')).status).toBe(403)
    expect((await move('/dav/d', '/dav/d/e')).status).toBe(403)
    expect((await move('/dav/a', '/dav/../etc/x')).status).toBe(400)
  })
  it('honours If-Match on the source', async () => {
    await put('/dav/a', 'x')
    expect((await move('/dav/a', '/dav/b', { 'If-Match': '"no"' })).status).toBe(412)
    expect((await move('/dav/a', '/dav/b', { 'If-Match': sha('x') })).status).toBe(201)
  })
})

describe('PROPFIND', () => {
  const prop = (p: string, depth?: string) =>
    dav(s.port, 'PROPFIND', p, { headers: depth === undefined ? {} : { Depth: depth } })
  it('Depth 0 and 1 give a 207 with DAV: properties', async () => {
    await dav(s.port, 'MKCOL', '/dav/Book')
    await put('/dav/Book/a%20b.md', 'hello')
    const r = await prop('/dav/Book/', '1')
    expect(r.status).toBe(207)
    expect(r.headers['content-type']).toContain('application/xml')
    expect(r.text).toContain('<D:multistatus xmlns:D="DAV:">')
    expect(r.text).toContain('<D:href>/dav/Book/</D:href>')
    expect(r.text).toContain('<D:resourcetype><D:collection/></D:resourcetype>')
    expect(r.text).toContain('<D:href>/dav/Book/a%20b.md</D:href>')
    expect(r.text).toContain(`<D:getetag>${sha('hello')}</D:getetag>`)
    expect(r.text).toContain('<D:getcontentlength>5</D:getcontentlength>')
    expect(r.text).toMatch(
      /<D:getlastmodified>[A-Z][a-z]{2}, \d\d [A-Z][a-z]{2} \d{4} [\d:]{8} GMT</,
    )
    expect(r.text).toContain('<D:getcontenttype>text/markdown; charset=utf-8</D:getcontenttype>')
    const d0 = await prop('/dav/Book/', '0')
    expect(d0.text).not.toContain('a%20b.md')
    expect(d0.text.match(/<D:response>/g)).toHaveLength(1)
  })
  it('the root lists, the temp files are hidden, a file answers for itself', async () => {
    await put('/dav/z', 'z')
    await writeFile(join(s.root, '.aurelia-store-leftover.tmp'), 'half')
    const r = await prop('/dav/', '1')
    expect(r.text).toContain('<D:href>/dav/</D:href>')
    expect(r.text).toContain('<D:href>/dav/z</D:href>')
    expect(r.text).not.toContain('aurelia-store')
    expect((await prop('/dav/z', '1')).text.match(/<D:response>/g)).toHaveLength(1)
  })
  it('rejects infinity (and a missing Depth) with 403; 404 when missing', async () => {
    expect((await prop('/dav/', 'infinity')).status).toBe(403)
    expect((await prop('/dav/')).status).toBe(403)
    expect((await prop('/dav/nope', '0')).status).toBe(404)
  })
  it('escapes XML in names', async () => {
    await put('/dav/a%26%3Cb%3E', 'x')
    const r = await prop('/dav/', '1')
    expect(r.text).toContain('/dav/a%26%3Cb%3E')
    expect(r.text).not.toContain('<b>')
  })
})

describe('body limit', () => {
  it('a Content-Length over 64 MiB is 413 before any byte is read', async () => {
    const { raw } = await import('./helpers.ts')
    const out = await raw(
      s.port,
      `PUT /dav/big HTTP/1.1\r\nHost: x\r\nContent-Length: ${64 * 1024 * 1024 + 1}\r\n\r\n`,
    )
    expect(out).toMatch(/^HTTP\/1\.1 413 /)
    expect(await readdir(s.root)).toEqual([])
  })
  it('a chunked body that grows past 64 MiB is 413 and leaves no temp file', async () => {
    const { raw } = await import('./helpers.ts')
    const mib = Buffer.alloc(1024 * 1024, 97)
    const chunks: Buffer[] = []
    for (let i = 0; i < 66; i++) chunks.push(Buffer.from('100000\r\n'), mib, Buffer.from('\r\n'))
    const out = await raw(
      s.port,
      'PUT /dav/big HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n',
      chunks,
    )
    expect(out).toMatch(/^HTTP\/1\.1 413 /)
    expect(await readdir(s.root)).toEqual([])
  })
  it('exactly 64 MiB is accepted', async () => {
    const r = await put('/dav/ok', 'x'.repeat(64 * 1024 * 1024))
    expect(r.status).toBe(201)
  })
})
