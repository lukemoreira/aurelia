// SPDX-License-Identifier: AGPL-3.0-or-later
// What every StorageAdapter must do. Plain functions with no test framework, so the same cases
// run in Vitest (memory) and inside a real browser (OPFS, and an OPFS handle standing in for a
// real folder) through the end-to-end test hook.
import type { StorageAdapter } from './adapter'
import { encode, hashText } from './hash'

export interface ContractCase {
  name: string
  /** `make` gives a fresh, empty adapter. Throw to fail. */
  run: (make: () => Promise<StorageAdapter>) => Promise<void>
}

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message)
}
const same = (a: unknown, b: unknown, what: string) =>
  check(
    JSON.stringify(a) === JSON.stringify(b),
    `${what}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`,
  )

export const ADAPTER_CONTRACT: ContractCase[] = [
  {
    name: 'a file that is not there reads as null, and listing an empty store gives nothing',
    run: async (make) => {
      const a = await make()
      same(await a.read('nope.md'), null, 'read')
      same(await a.read('deep/er/nope.md'), null, 'read in a missing folder')
      same(await a.readBytes('nope.md'), null, 'readBytes')
      same(await a.list(), [], 'list')
    },
  },
  {
    name: 'a written file reads back as the same text, with the hash of its bytes',
    run: async (make) => {
      const a = await make()
      await a.write('aurelia.json', '{"a":1}\n')
      const file = await a.read('aurelia.json')
      same(file?.text, '{"a":1}\n', 'text')
      same(file?.hash, await hashText('{"a":1}\n'), 'hash')
      same(
        Array.from((await a.readBytes('aurelia.json')) ?? []),
        Array.from(encode('{"a":1}\n')),
        'bytes',
      )
    },
  },
  {
    name: 'writing makes the folders it needs, and paths use /',
    run: async (make) => {
      const a = await make()
      await a.write('universes/unv_a/books/bok_b/scenes/scn_c.md', 'x')
      same(await a.list(), ['universes/unv_a/books/bok_b/scenes/scn_c.md'], 'list')
    },
  },
  {
    name: 'a write replaces the whole file, with no old text left over',
    run: async (make) => {
      const a = await make()
      await a.write('a.md', 'a much longer first version')
      await a.write('a.md', 'short')
      same((await a.read('a.md'))?.text, 'short', 'text')
      same(await a.list(), ['a.md'], 'list')
    },
  },
  {
    name: 'text round-trips exactly: accents, emoji, line endings, a leading BOM and an empty file',
    run: async (make) => {
      const a = await make()
      const texts = ['héllo ✓ 😀\r\nline two\n', '﻿---\ntitle: x\n---\n', '']
      for (const [i, text] of texts.entries()) {
        await a.write(`t${i}.md`, text)
        same((await a.read(`t${i}.md`))?.text, text, `text ${i}`)
        same((await a.read(`t${i}.md`))?.hash, await hashText(text), `hash ${i}`)
      }
    },
  },
  {
    name: 'the hash changes when the text does, and only then',
    run: async (make) => {
      const a = await make()
      await a.write('a.md', 'one')
      const first = (await a.read('a.md'))!.hash
      await a.write('a.md', 'one')
      same((await a.read('a.md'))!.hash, first, 'same text, same hash')
      await a.write('a.md', 'two')
      check((await a.read('a.md'))!.hash !== first, 'different text must hash differently')
    },
  },
  {
    name: 'list gives every file below the root; shallow gives the top level, folders ending in /',
    run: async (make) => {
      const a = await make()
      for (const p of [
        'aurelia.json',
        'universes/u/universe.md',
        'universes/u/books/b/book.json',
        '.aurelia/x',
      ])
        await a.write(p, 'x')
      same(
        (await a.list()).sort(),
        ['.aurelia/x', 'aurelia.json', 'universes/u/books/b/book.json', 'universes/u/universe.md'],
        'list',
      )
      same(
        (await a.list({ shallow: true })).sort(),
        ['.aurelia/', 'aurelia.json', 'universes/'],
        'shallow',
      )
    },
  },
  {
    name: 'names with spaces and brackets work, as conflicted copies have',
    run: async (make) => {
      const a = await make()
      await a.write('scenes/scn_a (Aurelia copy 2).md', 'copy')
      same((await a.read('scenes/scn_a (Aurelia copy 2).md'))?.text, 'copy', 'text')
    },
  },
  {
    name: 'remove deletes a file, and removing what is not there is not an error',
    run: async (make) => {
      const a = await make()
      await a.write('a/b.md', 'x')
      await a.remove('a/b.md')
      await a.remove('a/b.md')
      await a.remove('nothing/here.md')
      same(await a.read('a/b.md'), null, 'read after remove')
    },
  },
  {
    name: 'files written at the same time all arrive',
    run: async (make) => {
      const a = await make()
      await Promise.all(Array.from({ length: 12 }, (_, i) => a.write(`d/f${i}.md`, `text ${i}`)))
      same((await a.list()).length, 12, 'count')
      same((await a.read('d/f7.md'))?.text, 'text 7', 'text')
    },
  },
  {
    name: 'access is granted for a store that is ours to use',
    run: async (make) => {
      const a = await make()
      same(await a.access(), 'granted', 'access')
      same(await a.requestAccess(), true, 'requestAccess')
    },
  },
]
