// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, readdir, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashStats } from '../src/files.ts'
import { parentGone } from '../src/methods.ts'
import { sweepTemp } from '../src/sweep.ts'
import { dav, startStore } from './helpers.ts'
import type { Store } from './helpers.ts'

let s: Store
beforeEach(async () => (s = await startStore()))
afterEach(() => s.close())

describe('stored files are data, never pages', () => {
  it.each([
    ['a.svg', true],
    ['a.html', true],
    ['a.png', true],
    ['a.md', false],
    ['a.txt', false],
    ['a.json', false],
    ['a.zip', false],
  ])('%s on GET and HEAD (attachment: %s)', async (name, attachment) => {
    await dav(s.port, 'PUT', `/dav/${name}`, { body: '<svg onload="alert(1)"/>' })
    for (const m of ['GET', 'HEAD']) {
      const r = await dav(s.port, m, `/dav/${name}`)
      expect(r.status).toBe(200)
      expect(r.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
      expect(r.headers['x-content-type-options']).toBe('nosniff')
      expect(r.headers['content-disposition']).toBe(attachment ? 'attachment' : undefined)
    }
  })
})

describe('folder If-Match', () => {
  it('DELETE and MOVE compare against the folder ETag (412 on a mismatch)', async () => {
    await dav(s.port, 'MKCOL', '/dav/d')
    const etag = (await dav(s.port, 'PROPFIND', '/dav/d', { headers: { Depth: '0' } })).text.match(
      /<[^>]*getetag>([^<]+)</,
    )![1]!
    expect(
      (await dav(s.port, 'DELETE', '/dav/d', { headers: { 'If-Match': '"nope"' } })).status,
    ).toBe(412)
    expect(
      (
        await dav(s.port, 'MOVE', '/dav/d', {
          headers: { Destination: '/dav/e', 'If-Match': '"nope"' },
        })
      ).status,
    ).toBe(412)
    expect((await dav(s.port, 'PROPFIND', '/dav/d', { headers: { Depth: '0' } })).status).toBe(207)
    expect(
      (
        await dav(s.port, 'MOVE', '/dav/d', {
          headers: { Destination: '/dav/e', 'If-Match': etag },
        })
      ).status,
    ).toBe(201)
    const e2 = (await dav(s.port, 'PROPFIND', '/dav/e', { headers: { Depth: '0' } })).text.match(
      /<[^>]*getetag>([^<]+)</,
    )![1]!
    expect((await dav(s.port, 'DELETE', '/dav/e', { headers: { 'If-Match': e2 } })).status).toBe(
      204,
    )
  })
})

describe('folder DELETE racing PUTs inside', () => {
  it('never answers 500', async () => {
    const seen = new Set<number>()
    for (let i = 0; i < 25; i++) {
      await dav(s.port, 'MKCOL', '/dav/d')
      const r = await Promise.all([
        ...Array.from({ length: 6 }, (_, j) =>
          dav(s.port, 'PUT', `/dav/d/f${j}`, { body: 'x'.repeat(1000) }),
        ),
        dav(s.port, 'DELETE', '/dav/d'),
      ])
      for (const x of r) seen.add(x.status)
      await dav(s.port, 'DELETE', '/dav/d')
    }
    expect([...seen].filter((c) => ![201, 204, 404, 409].includes(c))).toEqual([])
  })
  it('EINVAL, like ENOENT and ENOTDIR, means the parent is gone', () => {
    for (const code of ['EINVAL', 'ENOENT', 'ENOTDIR'])
      expect(parentGone(Object.assign(new Error('x'), { code }))).toBe(true)
    expect(parentGone(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false)
  })
})

describe('folder DELETE while uploads keep landing inside', () => {
  /** Eight clients writing new files into /dav/d for `ms`. */
  const hammer = (ms: number) => {
    const end = Date.now() + ms
    return Promise.all(
      Array.from({ length: 8 }, async (_, w) => {
        for (let i = 0; Date.now() < end; i++)
          await dav(s.port, 'PUT', `/dav/d/w${w}-${i}`, { body: 'x' })
      }),
    )
  }
  it('waits out a burst of about a second (204), where it used to give up after a fraction of one', async () => {
    await dav(s.port, 'MKCOL', '/dav/d')
    const writing = hammer(1000)
    await new Promise((r) => setTimeout(r, 30))
    expect((await dav(s.port, 'DELETE', '/dav/d')).status).toBe(204)
    await writing
  }, 10_000)
  it('a folder still being written into after the retries is a 409, never a 500', async () => {
    await dav(s.port, 'MKCOL', '/dav/d')
    const writing = hammer(3500)
    await new Promise((r) => setTimeout(r, 30))
    expect([204, 409]).toContain((await dav(s.port, 'DELETE', '/dav/d')).status)
    await writing
  }, 15_000)
})

describe('PROPFIND Depth 1 does not re-hash unchanged files', () => {
  const aged = (name: string) => {
    const old = new Date(Date.now() - 10_000)
    return utimes(join(s.root, name), old, old)
  }
  const etags = async () =>
    [
      ...(await dav(s.port, 'PROPFIND', '/dav/', { headers: { Depth: '1' } })).text.matchAll(
        /<[^>]*href>([^<]+)<.*?getetag>([^<]+)</gs,
      ),
    ].map((m) => `${m[1]}=${m[2]}`)

  it('memoises by (dev, ino, size, mtime); a change gets a new ETag', async () => {
    await dav(s.port, 'PUT', '/dav/a.md', { body: 'one' })
    await dav(s.port, 'PUT', '/dav/b.md', { body: 'two' })
    await aged('a.md')
    await aged('b.md')
    const first = await etags()
    const before = hashStats.reads
    expect(await etags()).toEqual(first)
    expect(hashStats.reads).toBe(before) // nothing read again
    await dav(s.port, 'PUT', '/dav/a.md', { body: 'three' }) // written just now: hashed again, and not remembered
    const after = await etags()
    expect(after).not.toEqual(first)
    expect(hashStats.reads).toBe(before + 1) // only the changed file
    // The ETag is still the SHA-256 of the content.
    const r = await dav(s.port, 'GET', '/dav/a.md')
    expect(after).toContain(`/dav/a.md=${r.headers.etag}`)
  })
  it('a file written within the last 2 s is never remembered: a coarse mtime could hide a rewrite', async () => {
    await writeFile(join(s.root, 'fresh.md'), 'aaa')
    await etags()
    const before = hashStats.reads
    await etags()
    expect(hashStats.reads).toBe(before + 1) // read again, not served from memory
    await aged('fresh.md')
    await etags() // old enough now: read once and remembered
    const aging = hashStats.reads
    await etags()
    expect(hashStats.reads).toBe(aging)
  })
  it('an in-place change of the same size (new mtime) is hashed again', async () => {
    await writeFile(join(s.root, 'c.md'), 'aaa')
    const first = await etags()
    await writeFile(join(s.root, 'c.md'), 'bbb')
    await utimes(join(s.root, 'c.md'), new Date(), new Date(Date.now() + 5000))
    expect(await etags()).not.toEqual(first)
  })
})

describe('sweeping old temp files on start', () => {
  it('removes only old .aurelia-store-*.tmp files, follows no symlink', async () => {
    const old = new Date(Date.now() - 2 * 3_600_000)
    const mk = async (p: string, when = old) => {
      await writeFile(p, 'x')
      await utimes(p, when, when)
    }
    await mkdir(join(s.root, 'sub'))
    await mkdir(join(s.outside, 'x'))
    await mk(join(s.root, '.aurelia-store-1.tmp'))
    await mk(join(s.root, 'sub', '.aurelia-store-2.tmp'))
    await mk(join(s.root, '.aurelia-store-fresh.tmp'), new Date())
    await mk(join(s.root, 'keep.tmp'))
    await mk(join(s.root, 'notes.md'))
    await mk(join(s.outside, '.aurelia-store-3.tmp'))
    await symlink(s.outside, join(s.root, 'link'))
    expect(await sweepTemp(s.root)).toBe(2)
    expect((await readdir(s.root)).sort()).toEqual(
      ['.aurelia-store-fresh.tmp', 'keep.tmp', 'link', 'notes.md', 'sub'].sort(),
    )
    expect(await readdir(s.outside)).toContain('.aurelia-store-3.tmp')
  })
})
