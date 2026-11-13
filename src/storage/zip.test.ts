// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readZip } from '../../tests/helpers/read-zip'
import { crc32, zipFiles } from './zip'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('zipFiles', () => {
  it('has the standard CRC-32 of "123456789"', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926)
  })

  it('stores every file with its path and a matching CRC, UTF-8 names included', async () => {
    const files = [
      { path: 'My Book/aurelia.json', data: bytes('{"a":1}\n') },
      { path: 'My Book/scenes/é.md', data: bytes('héllo ✓') },
      { path: 'My Book/empty.md', data: bytes('') },
    ]
    const buf = new Uint8Array(await zipFiles(files).arrayBuffer())
    expect(readZip(buf)).toEqual([
      { path: 'My Book/aurelia.json', text: '{"a":1}\n', crcOk: true },
      { path: 'My Book/scenes/é.md', text: 'héllo ✓', crcOk: true },
      { path: 'My Book/empty.md', text: '', crcOk: true },
    ])
  })

  it('is a zip the system unzip accepts', async () => {
    const buf = new Uint8Array(
      await zipFiles([{ path: 'a/b.txt', data: bytes('hello') }]).arrayBuffer(),
    )
    const file = join(mkdtempSync(join(tmpdir(), 'aurelia-zip-')), 'x.zip')
    writeFileSync(file, buf)
    let out: string
    try {
      out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' })
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return // no unzip on this machine
      throw e
    }
    expect(out).toContain('No errors detected')
    expect(readFileSync(file).length).toBe(buf.length)
  })
})
