// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dav, startStore } from './helpers.ts'
import type { Store } from './helpers.ts'

let s: Store
beforeEach(async () => (s = await startStore()))
afterEach(() => s.close())

const count = (rs: Array<{ status: number }>, status: number) =>
  rs.filter((r) => r.status === status).length

describe('compare-and-write under concurrency', () => {
  it('of 12 PUTs with the same If-Match exactly one wins', async () => {
    const e = (await dav(s.port, 'PUT', '/dav/a', { body: 'v0' })).headers.etag as string
    const rs = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        dav(s.port, 'PUT', '/dav/a', { body: `v${i + 1}`, headers: { 'If-Match': e } }),
      ),
    )
    expect(count(rs, 204)).toBe(1)
    expect(count(rs, 412)).toBe(11)
    const winner = rs.findIndex((r) => r.status === 204)
    expect((await dav(s.port, 'GET', '/dav/a')).text).toBe(`v${winner + 1}`)
  })

  it('of 12 creating PUTs with If-None-Match: * exactly one creates', async () => {
    const rs = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        dav(s.port, 'PUT', '/dav/a', { body: `v${i}`, headers: { 'If-None-Match': '*' } }),
      ),
    )
    expect(count(rs, 201)).toBe(1)
    expect(count(rs, 412)).toBe(11)
  })

  it('of 12 MOVEs onto one target with Overwrite: F exactly one wins', async () => {
    for (let i = 0; i < 12; i++) await dav(s.port, 'PUT', `/dav/s${i}`, { body: `s${i}` })
    const rs = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        dav(s.port, 'MOVE', `/dav/s${i}`, { headers: { Destination: '/dav/t', Overwrite: 'F' } }),
      ),
    )
    expect(count(rs, 201)).toBe(1)
    expect(count(rs, 412)).toBe(11)
    expect((await readdir(s.root)).length).toBe(12) // 11 sources left + the target
  })

  it('a DELETE with If-Match and a PUT with If-Match cannot both win', async () => {
    const e = (await dav(s.port, 'PUT', '/dav/a', { body: 'v0' })).headers.etag as string
    const rs = await Promise.all([
      dav(s.port, 'DELETE', '/dav/a', { headers: { 'If-Match': e } }),
      dav(s.port, 'PUT', '/dav/a', { body: 'v1', headers: { 'If-Match': e } }),
    ])
    expect(rs.map((r) => r.status).sort()).toSatisfy(
      (x: number[]) => x[0] === 204 && (x[1] === 412 || x[1] === 404),
    )
  })
})

describe('atomic replace', () => {
  it('a reader never sees a half file while writers replace it', async () => {
    const size = 4 * 1024 * 1024
    const A = 'a'.repeat(size)
    const B = 'b'.repeat(size)
    await dav(s.port, 'PUT', '/dav/big', { body: A })
    let stop = false
    const writer = (async () => {
      for (let i = 0; !stop; i++) await dav(s.port, 'PUT', '/dav/big', { body: i % 2 ? A : B })
    })()
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const r = await dav(s.port, 'GET', '/dav/big')
      expect(r.status).toBe(200)
      expect(r.body.length).toBe(size)
      expect(r.text === A || r.text === B, 'torn read').toBe(true)
      expect(r.headers.etag).toBe(`"${createHash('sha256').update(r.body).digest('hex')}"`)
      seen.add(r.text[0] as string)
    }
    stop = true
    await writer
    expect(seen.size).toBeGreaterThan(0)
    expect((await readdir(s.root)).filter((n) => n.startsWith('.aurelia-store'))).toEqual([])
  })
})
