// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { saltmarchSample, SAMPLE_START } from '@/sample/saltmarch'
import { useWorkspaceStore } from '@/stores/workspace'
import { filterTree, idsOf, useNavigatorTree } from './useNavigatorTree'

beforeEach(() => localStorage.clear())

function open() {
  setActivePinia(createPinia())
  const ws = useWorkspaceStore()
  ws.loadSample()
  ws.select(SAMPLE_START.book, SAMPLE_START.scene)
  return { ws, tree: useNavigatorTree() }
}

describe('navigator tree', () => {
  it('lists Saltmarch’s three books with parts, chapters and scenes under The Lantern Gate', () => {
    const { tree } = open()
    expect(tree.books.value.map((n) => n.label)).toEqual([
      'The Lantern Gate',
      'Tidebound',
      'Salt & Ash',
    ])
    const lantern = tree.books.value[0]!
    expect(lantern.children!.map((n) => n.label)).toEqual([
      'Part One · Low Tide',
      'Part Two · Slack Water',
    ])
    const part = lantern.children![0]!
    expect(part.children!.map((n) => n.label)).toEqual([
      '5 · The Drowned Ledger',
      '6 · Ropewalk',
      '7 · The Lantern Gate',
      '8 · Salt in the Wound',
    ])
    const curfew = part.children![2]!.children![1]!
    expect(curfew).toMatchObject({ label: 'Curfew Bells', status: 'draft', meta: '1.2k' })
  })

  it('shows a branching book’s scene count, the standalone book and the library groups', () => {
    const { tree } = open()
    expect(tree.books.value[2]!.meta).toBe('6 sc.')
    expect(tree.standalone.value.map((n) => [n.label, n.meta])).toEqual([
      ['The Long Winter of 1709', 'history'],
    ])
    const lib = tree.library.value
    // Counts are what the groups hold, and a group with nothing in it is not shown.
    expect(lib.map((n) => [n.label, n.meta])).toEqual([
      ['Characters', '4'],
      ['Worlds & places', '2'],
      ['Arcs', '3'],
    ])
    expect(lib.every((n) => n.meta === String(n.children!.length))).toBe(true)
    expect(lib[0]!.children!.map((n) => n.label)).toEqual([
      'Elena Vasquez',
      'Tomas Brandt',
      'Mirela Constantin',
      'Corin Ashby',
    ])
  })

  it('skips a book the universe names but the workspace does not hold', () => {
    setActivePinia(createPinia())
    const ws = useWorkspaceStore()
    const data = saltmarchSample()
    data.universes = data.universes.map((u) =>
      u.kind === 'shared'
        ? { ...u, books: ['bok_zzzzzzzzzz', ...u.books] }
        : { ...u, books: [...u.books, 'bok_zzzzzzzzzy'] },
    )
    const other = data.universes.find((u) => u.kind === 'standalone')!
    data.universes.push({ ...other, id: 'unv_zzzzzzzzzz', books: ['bok_zzzzzzzzzx'] })
    ws.load(data)
    ws.select(SAMPLE_START.book, SAMPLE_START.scene)
    const tree = useNavigatorTree()
    expect(tree.books.value.map((n) => n.label)).toEqual([
      'The Lantern Gate',
      'Tidebound',
      'Salt & Ash',
    ])
    expect(tree.standalone.value.map((n) => n.id)).not.toContain('bok_zzzzzzzzzy')
  })

  it('keeps the open scene’s book, part and chapter open, and remembers it', async () => {
    const { tree } = open()
    expect(tree.expanded.value).toHaveLength(3)
    await nextTick()
    expect(JSON.parse(localStorage.getItem('aurelia.v1.navigator.expanded')!)).toHaveLength(3)
  })

  it('filters by title, keeping the parents of a match open', () => {
    const { tree } = open()
    tree.filter.value = 'warden'
    expect(tree.books.value.map((n) => n.label)).toEqual(['The Lantern Gate'])
    expect(idsOf(tree.books.value)).toHaveLength(4) // book, part, chapter, scene: no siblings
    expect(tree.expanded.value).toEqual(idsOf([...tree.books.value, ...tree.library.value]))
    tree.filter.value = ''
    expect(tree.books.value).toHaveLength(3)
  })

  it('filterTree ignores case and accents', () => {
    const nodes = [
      { id: 'a', label: 'Élodie' },
      { id: 'b', label: 'Other' },
    ]
    expect(filterTree(nodes, 'ELO').map((n) => n.id)).toEqual(['a'])
  })
})
