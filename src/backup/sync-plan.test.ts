// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { copyNameFor, planSync, type Base, type SyncAction } from './sync-plan'

const P = 'universes/u/books/b/scenes/scn_a.md'
const plan = (
  local: Record<string, string>,
  remote: Record<string, string>,
  base: Record<string, Base> = {},
  tombstones: Record<string, { hash: string; at: string }> = {},
): SyncAction[] =>
  planSync({
    local: new Map(Object.entries(local)),
    remote: new Map(Object.entries(remote)),
    base,
    tombstones,
  })
const b = (etag: string, hash: string): Base => ({ etag, hash })

describe('what a round does with one file (ADR-0012)', () => {
  it('nothing when neither side moved', () => {
    expect(plan({ [P]: 'h1' }, { [P]: 'e1' }, { [P]: b('e1', 'h1') })).toEqual([])
  })

  it('pushes a local change against the tag it last saw', () => {
    expect(plan({ [P]: 'h2' }, { [P]: 'e1' }, { [P]: b('e1', 'h1') })).toEqual([
      { kind: 'push', path: P, ifMatch: 'e1' },
    ])
  })

  it('pulls a server change onto a file that is still what it was', () => {
    expect(plan({ [P]: 'h1' }, { [P]: 'e2' }, { [P]: b('e1', 'h1') })).toEqual([
      { kind: 'pull', path: P, expect: 'h1' },
    ])
  })

  it('looks at both when both changed', () => {
    expect(plan({ [P]: 'h2' }, { [P]: 'e2' }, { [P]: b('e1', 'h1') })).toEqual([
      { kind: 'compare', path: P },
    ])
  })

  it('a file on one side only is new: pushed as new, or pulled', () => {
    expect(plan({ [P]: 'h1' }, {})).toEqual([{ kind: 'push', path: P, ifMatch: null }])
    expect(plan({}, { [P]: 'e1' })).toEqual([{ kind: 'pull', path: P, expect: null }])
  })

  it('a file on both sides with no base is compared, never assumed', () => {
    expect(plan({ [P]: 'h1' }, { [P]: 'e1' })).toEqual([{ kind: 'compare', path: P }])
  })

  it('deleted there (a tombstone says so) and untouched here: deleted here; gone with no word of it: put back', () => {
    const base = { [P]: b('e1', 'h1'), 'o.md': b('e9', 'h9') }
    const local = { [P]: 'h1', 'o.md': 'h9' }
    expect(
      plan(local, { 'o.md': 'e9' }, base, { [P]: { hash: 'h1', at: '2026-11-12T00:00:00Z' } }),
    ).toEqual([{ kind: 'remove-local', path: P, expect: 'h1' }])
    expect(plan(local, { 'o.md': 'e9' }, base)).toEqual([{ kind: 'push', path: P, ifMatch: null }])
  })

  it('deleted there but edited here: the edit wins and goes back', () => {
    expect(plan({ [P]: 'h2' }, {}, { [P]: b('e1', 'h1') })).toEqual([
      { kind: 'push', path: P, ifMatch: null },
    ])
  })

  it('deleted here and untouched there: deleted there', () => {
    expect(plan({}, { [P]: 'e1' }, { [P]: b('e1', 'h1') })).toEqual([
      { kind: 'remove-remote', path: P, ifMatch: 'e1' },
    ])
  })

  it('deleted here but edited there: the edit wins and comes back', () => {
    expect(plan({}, { [P]: 'e2' }, { [P]: b('e1', 'h1') })).toEqual([
      { kind: 'pull', path: P, expect: null },
    ])
  })

  it('deleted on both: the base is forgotten', () => {
    expect(plan({}, {}, { [P]: b('e1', 'h1') })).toEqual([{ kind: 'forget', path: P }])
  })

  it('a file with no base is the author’s: it goes up, whatever the tombstones say', () => {
    const tombstones = { [P]: { hash: 'h1', at: '2026-11-12T00:00:00Z' } }
    for (const hash of ['h1', 'h2'])
      expect(plan({ [P]: hash }, {}, {}, tombstones)).toEqual([
        { kind: 'push', path: P, ifMatch: null },
      ])
  })

  it('a file gone from the server with a tombstone and untouched here is a decision, however many go at once', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f']
    const base = Object.fromEntries(names.map((n) => [n, b(`E${n}`, `h${n}`)]))
    const local = Object.fromEntries(names.map((n) => [n, `h${n}`]))
    const tombstones = Object.fromEntries(
      names.slice(1).map((n) => [n, { hash: `h${n}`, at: '2026-11-12T00:00:00Z' }]),
    )
    const actions = plan(local, { a: 'Ea' }, base, tombstones)
    expect(actions.filter((x) => x.kind === 'push')).toEqual([])
    expect(actions.filter((x) => x.kind === 'remove-local')).toHaveLength(5)
  })

  it('a device that was behind (its bytes are older than the deleted ones) follows the delete too, and an edited file is kept', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f']
    const base = Object.fromEntries(names.map((n) => [n, b(`E${n}`, `h${n}`)]))
    const local = Object.fromEntries(names.map((n) => [n, `h${n}`]))
    const tombstones = Object.fromEntries(
      names.slice(1).map((n) => [n, { hash: 'newer bytes', at: '2026-11-12T00:00:00Z' }]),
    )
    const actions = plan(local, { a: 'Ea' }, base, tombstones)
    expect(actions.filter((x) => x.kind === 'push')).toEqual([])
    expect(actions.filter((x) => x.kind === 'remove-local')).toHaveLength(5)
    // The same, with one of them edited here since: that one is the author's and goes back up.
    const edited = plan({ ...local, c: 'edited' }, { a: 'Ea' }, base, tombstones)
    expect(edited.filter((x) => x.kind === 'push')).toEqual([
      { kind: 'push', path: 'c', ifMatch: null },
    ])
  })

  it('a tombstone does not touch a file that has a base (the base already says it)', () => {
    const tombstones = { [P]: { hash: 'h1', at: '2026-11-12T00:00:00Z' } }
    expect(plan({ [P]: 'h1' }, { [P]: 'e1' }, { [P]: b('e1', 'h1') }, tombstones)).toEqual([])
  })
})

describe('a file gone from the server', () => {
  const many = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.md`, `h${i}`]))
  const based = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.md`, b(`e${i}`, `h${i}`)]))

  it('with no word of a delete, is a loss at the server: it goes back up, whether one file or all of them', () => {
    for (const remaining of [0, 1, 4]) {
      const remote = Object.fromEntries(
        Object.entries(many(6))
          .slice(0, remaining)
          .map(([p], i) => [p, `e${i}`]),
      )
      const actions = plan(many(6), remote, based(6))
      expect(actions.filter((a) => a.kind === 'remove-local')).toEqual([])
      expect(actions.filter((a) => a.kind === 'push')).toHaveLength(6 - remaining)
      expect(actions.every((a) => a.kind !== 'push' || a.ifMatch === null)).toBe(true)
    }
  })

  it('with a tombstone, is a delete, however few or many', () => {
    const remote = { 'f0.md': 'e0' }
    const tombstones = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`f${i + 1}.md`, { hash: 'x', at: 'then' }]),
    )
    const actions = plan(many(6), remote, based(6), tombstones)
    expect(actions.filter((a) => a.kind === 'push')).toEqual([])
    expect(actions.filter((a) => a.kind === 'remove-local')).toHaveLength(5)
  })
})

describe('the copy that keeps the other text', () => {
  it('is named from the text, beside the file, and reads as a conflicted copy', () => {
    expect(copyNameFor('scenes/scn_a.md', 'abcdef0123456789')).toBe(
      'scenes/scn_a (Aurelia copy abcdef01).md',
    )
    expect(copyNameFor('aurelia.json', 'abcdef0123')).toBe('aurelia (Aurelia copy abcdef01).json')
  })
})
