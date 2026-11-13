// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dav, startStore } from './helpers.ts'
import type { Store } from './helpers.ts'

let s: Store
beforeEach(async () => {
  s = await startStore()
  await writeFile(join(s.outside, 'secret.txt'), 'secret')
})
afterEach(() => s.close())

const untouched = async () => expect(await readdir(s.outside)).toEqual(['secret.txt'])

describe('path safety', () => {
  const bad = [
    '/dav/../outside/secret.txt',
    '/dav/%2e%2e/outside/secret.txt',
    '/dav/%2E%2E/outside/secret.txt',
    '/dav/a/../../outside/secret.txt',
    '/dav/a/%2e%2e/%2e%2e/outside/secret.txt',
    '/dav/.%2e/outside/secret.txt',
    '/dav/..%2foutside/secret.txt',
    '/dav/..%5coutside/secret.txt',
    '/dav/a%2fb',
    '/dav/a%5cb',
    '/dav/a%00b',
    '/dav/a%0ab',
    '/dav/%ff',
    '/dav/%',
    '/dav//x',
    '/dav/./x',
    '/dav/a\\..\\b',
  ]
  for (const method of ['GET', 'PUT', 'MKCOL', 'DELETE', 'PROPFIND', 'MOVE'])
    it(`${method} refuses every unsafe path with 400/403`, async () => {
      for (const p of bad) {
        const r = await dav(s.port, method, p, {
          body: method === 'PUT' ? 'x' : undefined,
          headers: { Depth: '0', Destination: '/dav/ok' },
        })
        expect([400, 403], `${method} ${p} -> ${r.status}`).toContain(r.status)
      }
      await untouched()
    })

  it('refuses unsafe MOVE destinations', async () => {
    await dav(s.port, 'PUT', '/dav/a', { body: 'x' })
    for (const d of [
      '/dav/../outside/x',
      '/dav/%2e%2e/outside/x',
      'http://h/dav/..%2fx',
      '/dav/a%00',
    ])
      expect([400, 403], d).toContain(
        (await dav(s.port, 'MOVE', '/dav/a', { headers: { Destination: d } })).status,
      )
    await untouched()
  })

  it('an absolute-form or non-slash request target is 400', async () => {
    const { raw } = await import('./helpers.ts')
    expect(await raw(s.port, 'GET * HTTP/1.1\r\nHost: x\r\n\r\n')).toMatch(/^HTTP\/1\.1 400 /)
  })

  it('refuses the reserved temp-file prefix', async () => {
    for (const m of ['GET', 'PUT', 'DELETE', 'MKCOL'])
      expect(
        (await dav(s.port, m, '/dav/.aurelia-store-x.tmp', { body: m === 'PUT' ? 'x' : undefined }))
          .status,
      ).toBe(403)
    expect((await dav(s.port, 'PUT', '/dav/d/.aurelia-store', { body: 'x' })).status).toBe(403)
  })

  it('plain dot-files the client writes are fine', async () => {
    expect((await dav(s.port, 'PUT', '/dav/.hidden', { body: 'x' })).status).toBe(201)
  })
})

describe('symlinks', () => {
  beforeEach(async () => {
    await symlink(s.outside, join(s.root, 'dir-out'))
    await symlink(join(s.outside, 'secret.txt'), join(s.root, 'file-out'))
    await mkdir(join(s.root, 'real'))
    await writeFile(join(s.root, 'real', 'f'), 'inside')
    await symlink(join(s.root, 'real'), join(s.root, 'dir-in'))
  })

  it('does not read through a symlink that leaves the store', async () => {
    expect((await dav(s.port, 'GET', '/dav/file-out')).status).toBe(403)
    expect((await dav(s.port, 'GET', '/dav/dir-out/secret.txt')).status).toBe(403)
    expect(
      (await dav(s.port, 'PROPFIND', '/dav/dir-out', { headers: { Depth: '1' } })).status,
    ).toBe(403)
  })

  it('does not write, create, move or delete through one', async () => {
    expect((await dav(s.port, 'PUT', '/dav/dir-out/new', { body: 'x' })).status).toBe(403)
    expect((await dav(s.port, 'PUT', '/dav/file-out', { body: 'x' })).status).toBe(403)
    expect((await dav(s.port, 'MKCOL', '/dav/dir-out/sub')).status).toBe(403)
    expect((await dav(s.port, 'DELETE', '/dav/dir-out/secret.txt')).status).toBe(403)
    await dav(s.port, 'PUT', '/dav/a', { body: 'x' })
    expect(
      (await dav(s.port, 'MOVE', '/dav/a', { headers: { Destination: '/dav/dir-out/a' } })).status,
    ).toBe(403)
    expect(
      (await dav(s.port, 'MOVE', '/dav/dir-out/secret.txt', { headers: { Destination: '/dav/b' } }))
        .status,
    ).toBe(403)
    expect(await readdir(s.outside)).toEqual(['secret.txt'])
    expect(await readFile(join(s.outside, 'secret.txt'), 'utf8')).toBe('secret')
  })

  it('does not list a symlink that leaves the store, and does not fail on it', async () => {
    const r = await dav(s.port, 'PROPFIND', '/dav/', { headers: { Depth: '1' } })
    expect(r.status).toBe(207)
    expect(r.text).not.toContain('dir-out')
    expect(r.text).not.toContain('file-out')
    expect(r.text).toContain('/dav/real/')
  })

  it('follows a symlink that stays inside the store', async () => {
    expect((await dav(s.port, 'GET', '/dav/dir-in/f')).text).toBe('inside')
  })

  it('deleting a symlink removes the link, not the target', async () => {
    expect((await dav(s.port, 'DELETE', '/dav/dir-in')).status).toBe(204)
    expect(await readFile(join(s.root, 'real', 'f'), 'utf8')).toBe('inside')
  })
})
