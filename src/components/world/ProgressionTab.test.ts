// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace'
import { id, story, type Sc } from '../../../tests/helpers/continuity-fixture'
import ProgressionTab from './ProgressionTab.vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
beforeEach(() => {
  localStorage.clear()
  push.mockClear()
})

const names = { characters: ['ana', 'bob'] }
const text = (w: { text(): string }) => w.text().replace(/\s+/g, ' ')

function open(scenes: Sc[], opts: Parameters<typeof story>[1] = {}, who = 'ana') {
  setActivePinia(createPinia())
  const s = story(scenes, { names, ...opts })
  const ws = useWorkspaceStore()
  ws.load(s.data)
  ws.select(s.input.bookId)
  return { w: mount(ProgressionTab, { props: { id: id.chr(who), name: who } }), s }
}
const straight: Sc[] = [
  {
    key: 'a',
    ch: 'c1',
    pov: 'ana',
    changes: [{ who: 'ana', kind: 'goal', value: 'Find the key' }],
  },
  {
    key: 'b',
    ch: 'c2',
    pov: 'ana',
    changes: [{ who: 'ana', kind: 'condition', value: 'Injured — left hand' }],
  },
  { key: 'c', ch: 'c3', pov: 'bob', named: ['bob'] },
  {
    key: 'd',
    ch: 'c4',
    add: ['ana'],
    changes: [{ who: 'ana', kind: 'knows', value: 'Her mother lives' }],
  },
  { key: 'e', ch: 'c5', pov: 'bob', named: ['bob'] },
]
const scrub = (w: VueWrapper) => w.find('#progression-scrub')
const stateOf = (w: VueWrapper) =>
  text(w.findAll('section').find((s) => s.attributes('aria-labelledby') === 'state-title')!)
const logOf = (w: VueWrapper) => w.findAll('ol > li')

describe('the progression table is a real table', () => {
  it('has column headers, a row header for each chapter, and words in every cell', () => {
    const { w } = open(straight)
    const t = w.find('table[aria-rowcount]')
    expect(t.find('caption').text()).toContain('on the page in each chapter')
    expect(t.findAll('thead th[scope="col"]').map((h) => h.text())).toEqual([
      'Chapter',
      'On the page',
      'Point of view',
      'Changes',
    ])
    const rows = t.findAll('tbody tr[aria-rowindex]')
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.find('th[scope="row"]').text()).toMatch(/^Chapter \d/)
      for (const c of row.findAll('td')) expect(c.text().length).toBeGreaterThan(0)
    }
    const cells = (i: number) => rows[i]!.findAll('td').map((c) => c.text())
    expect(cells(0)).toEqual(['1 scene, 100 words, point of view', 'Yes', '1'])
    expect(cells(2)).toEqual(['Not on the page', 'No', 'None'])
    expect(cells(3)).toEqual(['1 scene, 100 words', 'No', '1'])
  })

  it('lists the same rows as plain lines under "Table view", and goes back', async () => {
    const { w } = open(straight)
    const toggle = w.findAll('button').find((b) => b.text() === 'Table view')!
    await toggle.trigger('click')
    expect(w.find('table').exists()).toBe(false)
    expect(text(w.find('ul[aria-label="ana chapter by chapter"]'))).toContain('Chapter 1 · c1')
    expect(text(w.find('ul[aria-label="ana chapter by chapter"]'))).toContain(
      '1 scene, 100 words, point of view, 1 change',
    )
    await toggle.trigger('click')
    expect(w.find('table').exists()).toBe(true)
  })

  it('reads 120 chapters a stretch at a time with the Continuity pager, and draws only the rows near the window', async () => {
    const long: Sc[] = Array.from({ length: 120 }, (_, i) => ({
      key: `s${i}`,
      ch: `c${String(i).padStart(3, '0')}`,
      pov: 'ana',
    }))
    const { w } = open(long)
    const t = () => w.find('table[aria-rowcount]')
    expect(t().attributes('aria-rowcount')).toBe('25') // the header, and 24 chapters
    expect(t().find('thead th').classes()).toContain('sticky')
    expect(t().findAll('tbody tr[aria-rowindex]').length).toBeLessThanOrEqual(24)
    // the scrubber starts on the last chapter, so the table is on the last stretch
    expect(text(w)).toContain('Chapters 97–120 of 120')
    expect(w.find('[aria-label="Chapters shown"]').exists()).toBe(false) // not a new control: the ← → of the map
    const earlier = w.find('button[aria-label="Earlier chapters"]')
    const later = w.find('button[aria-label="Later chapters"]')
    expect(later.attributes('disabled')).toBeDefined()
    await earlier.trigger('click')
    expect(text(w)).toContain('Chapters 73–96 of 120')
    expect(text(t())).toContain('Chapter 73')
    expect(text(t())).not.toContain('Chapter 97')
  })

  it('turns the table to the stretch that holds the scene the scrubber is moved to', async () => {
    const long: Sc[] = Array.from({ length: 60 }, (_, i) => ({
      key: `s${i}`,
      ch: `c${String(i).padStart(3, '0')}`,
      pov: 'ana',
    }))
    const { w } = open(long)
    expect(text(w)).toContain('Chapters 49–60 of 60')
    await scrub(w).setValue('0')
    expect(text(w)).toContain('Chapters 1–24 of 60')
    expect(w.find('tr[aria-current="true"]').text()).toContain('Chapter 1')
    await scrub(w).setValue('30')
    expect(text(w)).toContain('Chapters 25–48 of 60')
    expect(w.find('tr[aria-current="true"]').text()).toContain('Chapter 31')
    // the current chapter says so in words, not only in a tint
    expect(w.find('tr[aria-current="true"]').text()).toContain('Here')
  })

  it('says point of view in the words of a cell, for a phone that has no room for the column', () => {
    const { w } = open(straight)
    const first = w.findAll('tbody tr[aria-rowindex]')[0]!
    expect(first.findAll('td')[0]!.text()).toContain('point of view')
    expect(w.findAll('thead th')[2]!.classes()).toContain('hidden')
    expect(first.find('span[aria-hidden="true"]').classes()).toContain('hidden') // the bar gives way below sm
  })
})

describe('the scrubber', () => {
  it('starts on the last scene they are on the page in, and shows the state there', () => {
    const { w } = open(straight)
    expect((scrub(w).element as HTMLInputElement).value).toBe('3')
    expect(text(w)).toContain('4.1 · d')
    expect(stateOf(w)).toContain('State at 4.1')
    expect(stateOf(w)).toContain('Has learned')
    expect(stateOf(w)).toContain('Her mother lives')
    expect(stateOf(w)).toContain('Find the key')
  })

  it('moves through the scenes in reading order, and the state changes with it', async () => {
    const { w } = open(straight)
    await scrub(w).setValue('0')
    expect(stateOf(w)).toContain('State at 1.1')
    expect(stateOf(w)).toContain('Find the key')
    expect(stateOf(w)).not.toContain('Injured')
    expect(stateOf(w)).not.toContain('Her mother lives')
    await scrub(w).setValue('1')
    expect(stateOf(w)).toContain('Injured — left hand')
    await scrub(w).setValue('3')
    expect(stateOf(w)).toContain('Her mother lives')
    // a screen reader hears where it is
    expect(scrub(w).attributes('aria-valuetext')).toBe('4.1 · d')
  })

  it('has buttons for the next and the earlier scene, stopping at both ends', async () => {
    const { w } = open(straight)
    const earlier = w.find('button[aria-label="Earlier scene"]')
    const later = w.find('button[aria-label="Later scene"]')
    await scrub(w).setValue('0')
    expect(earlier.attributes('disabled')).toBeDefined()
    await later.trigger('click')
    expect(text(w)).toContain('2.1 · b')
    await scrub(w).setValue('4')
    expect(later.attributes('disabled')).toBeDefined()
    await earlier.trigger('click')
    expect(text(w)).toContain('4.1 · d')
  })

  it('marks the changes that come after it as later in the story, in words', async () => {
    const { w } = open(straight)
    await scrub(w).setValue('0')
    const items = logOf(w)
    expect(items.map((i) => i.text().includes('later in the story'))).toEqual([false, true, true])
    await scrub(w).setValue('3')
    expect(logOf(w).map((i) => i.text().includes('later in the story'))).toEqual([
      false,
      false,
      false,
    ])
  })

  it('goes to the end of a chapter from its row', async () => {
    const { w } = open(straight)
    await w.findAll('tbody th[scope="row"] button')[1]!.trigger('click')
    expect((scrub(w).element as HTMLInputElement).value).toBe('1')
    expect(stateOf(w)).toContain('State at 2.1')
    expect(w.find('tr[aria-current="true"]').text()).toContain('Chapter 2')
  })

  it('lists every change in reading order, linking to its scene', async () => {
    const { w, s } = open(straight)
    expect(logOf(w).map((i) => i.text().replace(/\s+/g, ' '))).toEqual([
      '1.1 a Goal ana now wants: Find the key',
      '2.1 b Condition ana: Injured — left hand',
      '4.1 d Learns ana learns: Her mother lives',
    ])
    await logOf(w)[1]!.find('button').trigger('click')
    expect(push).toHaveBeenCalledWith(`/w/${s.input.bookId}/${id.scn('b')}`)
  })

  it('says so when nobody is on the page and nothing has changed', () => {
    const { w } = open(straight, {}, 'bob')
    expect(w.find('table').exists()).toBe(true) // bob is on the page in two chapters
    const none = open([{ key: 'a', pov: 'bob' }], {}, 'ana').w
    expect(text(none)).toContain('ana is not on the page of any scene yet')
    expect(none.find('table').exists()).toBe(false)
    expect(none.find('#progression-scrub').exists()).toBe(false)
  })
})

describe('in a branching book', () => {
  // start → left | right → end. Only the left path hurts her.
  const branching: Sc[] = [
    {
      key: 's',
      ch: 'c1',
      pov: 'ana',
      choices: [
        ['left', 'l'],
        ['right', 'r'],
      ],
    },
    {
      key: 'l',
      ch: 'c2',
      pov: 'ana',
      changes: [{ who: 'ana', kind: 'condition', value: 'Hurt' }],
      choices: [['on', 'z']],
    },
    { key: 'r', ch: 'c3', pov: 'ana', choices: [['on', 'z']] },
    { key: 'z', ch: 'c4', pov: 'ana', ending: true },
  ]
  it('says "on some paths" where only one way leads to a fact, and not where all do', async () => {
    const { w } = open(branching, { mode: 'branching', start: 's' })
    expect(stateOf(w)).toContain('State at 4.1')
    expect(stateOf(w)).toContain('Hurt · since 2.1 · on some paths')
    await scrub(w).setValue('1')
    expect(stateOf(w)).toContain('Hurt · since 2.1')
    expect(stateOf(w)).not.toContain('on some paths')
  })
})

describe('across a universe', () => {
  const books: Sc[] = [
    {
      key: 'a1',
      book: 'one',
      ch: 'c1',
      pov: 'ana',
      changes: [{ who: 'ana', kind: 'goal', value: 'Find the key' }],
    },
    {
      key: 'a2',
      book: 'one',
      ch: 'c2',
      pov: 'ana',
      changes: [{ who: 'ana', kind: 'status', value: 'missing' }],
    },
    { key: 'b1', book: 'two', ch: 'c1', pov: 'ana' },
  ]
  const choose = (w: VueWrapper, label: string) =>
    w
      .findAll('[role=radio]')
      .find((r) => r.text() === label)!
      .trigger('click')

  it('reads this book first, with the one control the Continuity view has: This book, then Whole universe', () => {
    const { w } = open(books)
    expect(w.find('[aria-label="Scope"]').exists()).toBe(true)
    expect(w.findAll('[role=radio]').map((r) => r.text())).toEqual(['This book', 'Whole universe'])
    expect(w.find('[role=radio][aria-checked="true"]').text()).toBe('This book')
    expect(w.find('table[aria-rowcount]').attributes('aria-rowcount')).toBe('3')
    expect(text(w.find('table'))).toContain('one:c1')
    expect(text(w.find('table'))).not.toContain('two:c1')
    expect((scrub(w).element as HTMLInputElement).value).toBe('1')
    expect(text(w)).toContain('State at 2.1') // no book named: there is one
    expect(stateOf(w)).toContain('Missing · since 2.1')
  })

  it('follows them across the books, with the state carried on, and names the book of every place', async () => {
    const { w } = open(books)
    await choose(w, 'Whole universe')
    expect(w.find('table[aria-rowcount]').attributes('aria-rowcount')).toBe('4')
    expect((scrub(w).element as HTMLInputElement).value).toBe('2')
    // the scene that made it so is named with its book: two books have a 2.1
    expect(stateOf(w)).toContain('Missing · since one · 2.1')
    // two books have a "Chapter 1": the book says which
    const rows = w.findAll('tbody th[scope="row"]').map((r) => r.text())
    expect(rows[0]).toContain('one · Chapter 1')
    expect(rows[2]).toContain('two · Chapter 1')
    // the scrubber, the state and the log name it too
    expect(scrub(w).attributes('aria-valuetext')).toBe('two · 1.1 · b1')
    expect(stateOf(w)).toContain('State at two · 1.1')
    expect(logOf(w).map((i) => i.text())[0]).toContain('one · 1.1')
    // back to this book
    await choose(w, 'This book')
    expect(w.find('table[aria-rowcount]').attributes('aria-rowcount')).toBe('3')
    expect((scrub(w).element as HTMLInputElement).value).toBe('1')
  })

  it('has no choice of scope for a universe of one book', () => {
    const { w } = open(straight)
    expect(w.find('[aria-label="Scope"]').exists()).toBe(false)
  })

  it('opens a scene of another book in that book', async () => {
    const { w, s } = open(books)
    await choose(w, 'Whole universe')
    await w
      .findAll('[class*="underline"]')
      .find((b) => b.text() === 'Open scene')!
      .trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalledWith(`/w/${s.models[1]!.bookId}/${id.scn('b1')}`)
  })
})

describe('a book of one scene', () => {
  it('has no scrubber to move, and still says where they are and opens the scene', () => {
    const { w } = open([
      { key: 'a', pov: 'ana', changes: [{ who: 'ana', kind: 'goal', value: 'x' }] },
    ])
    expect(w.find('#progression-scrub').exists()).toBe(false)
    expect(w.find('button[aria-label="Earlier scene"]').exists()).toBe(false)
    expect(text(w)).toContain('1.1 · a')
    expect(text(w)).toContain('Open scene')
    expect(stateOf(w)).toContain('State at 1.1')
  })
})
