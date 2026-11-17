// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace'
import { sampleId } from '@/sample/ids'
import { id, story, type Sc } from '../../tests/helpers/continuity-fixture'
import ContinuityView from './ContinuityView.vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
beforeEach(() => {
  localStorage.clear()
  push.mockClear()
})

const names = { characters: ['ana', 'bob'] }
const die = { who: 'ana', kind: 'status', value: 'dead' }
const text = (w: { text(): string }) => w.text().replace(/\s+/g, ' ')

function open(scenes: Sc[], opts: Parameters<typeof story>[1] = {}) {
  setActivePinia(createPinia())
  const s = story(scenes, { names, ...opts })
  const ws = useWorkspaceStore()
  ws.load(s.data)
  ws.select(s.input.bookId)
  return { w: mount(ContinuityView, { attachTo: document.body }), s }
}
const radio = (w: VueWrapper, label: string) =>
  w.findAll('[role=radio]').find((r) => r.text() === label)!
const books: Sc[] = [
  { key: 'a1', book: 'one', ch: 'c1', pov: 'ana', at: '412-03-14' },
  { key: 'a2', book: 'one', ch: 'c2', pov: 'ana', at: '300', flashback: true, changes: [die] },
  { key: 'b1', book: 'two', ch: 'c1', pov: 'bob', add: ['ana'], at: '413' },
  { key: 'b2', book: 'two', ch: 'c2', pov: 'bob', at: '-10' },
]

describe('the scope of the Continuity view: this book, or the whole universe', () => {
  it('reads this book by default, and has no choice for a universe of one book', () => {
    const { w } = open(books)
    expect(radio(w, 'This book').attributes('aria-checked')).toBe('true')
    expect(text(w)).toContain('one · 2 chapters · 2 scenes')
    expect(
      open([{ key: 'a' }])
        .w.find('[aria-label="Read"]')
        .exists(),
    ).toBe(false)
  })

  it('lays every book of the universe end to end on the map, under its book’s title', async () => {
    const { w } = open(books)
    const table = () => w.find('table[aria-rowcount]')
    expect(table().findAll('thead th[scope="col"]')).toHaveLength(3) // "Characters" and two chapters
    await radio(w, 'Whole universe').trigger('click')
    expect(text(w)).toContain('2 books · 4 chapters · 4 scenes')
    expect(table().findAll('thead th[scope="col"]')).toHaveLength(5)
    // the books head their chapters, as parts do
    expect(text(table())).toContain('one')
    expect(text(table())).toContain('two')
    await radio(w, 'This book').trigger('click')
    expect(table().findAll('thead th[scope="col"]')).toHaveLength(3)
  })

  it('finds a death in one book and an appearance in the next, only across the universe, and says which book', async () => {
    const { w } = open(books)
    const findings = () => w.find('aside[aria-label="Findings"]')
    expect(text(findings())).not.toContain('Appears after death or exit')
    await radio(w, 'Whole universe').trigger('click')
    expect(text(findings())).toContain('Appears after death or exit')
    expect(text(findings())).toContain('ana is dead since one, 2.1 · a2, but appears in 1.1 · b1')
    expect(text(findings())).toContain('In two.')
    // it goes to the scene in its own book
    const go = findings()
      .findAll('button')
      .find((b) => b.text().startsWith('Go to'))!
    await go.trigger('click')
    expect(push).toHaveBeenCalled()
  })
})

describe('the timeline', () => {
  async function timeline(scenes = books, opts: Parameters<typeof story>[1] = {}) {
    const o = open(scenes, opts)
    await radio(o.w, 'Timeline').trigger('click')
    return o
  }
  const rows = (w: VueWrapper) => w.findAll('ol ol li button').map((b) => text(b))

  it('puts the scenes on story time, not reading order, and names a flashback in words', async () => {
    const { w } = await timeline()
    // one book: a2 is told second but happened first
    expect(rows(w)).toEqual(['300 TR 2.1 · a2 Flashback', '14 Heat 412 TR 1.1 · a1'])
  })

  it('shows the findings only with the checks, and goes back to them', async () => {
    const { w } = await timeline()
    expect(w.find('aside[aria-label="Findings"]').exists()).toBe(false)
    await radio(w, 'Checks').trigger('click')
    expect(w.find('aside[aria-label="Findings"]').exists()).toBe(true)
  })

  it('zooms by era, year, month and day, and groups open and close', async () => {
    const { w } = await timeline()
    const groups = () => w.findAll('h3 button[data-tl]').map((b) => text(b))
    expect(groups()).toEqual(['300 TR · 1 scene', '412 TR · 1 scene']) // year
    await radio(w, 'Era').trigger('click')
    expect(groups()).toEqual(['TR · 2 scenes'])
    await radio(w, 'Day').trigger('click')
    expect(groups()).toEqual([
      '300 TR · 1 scene · some do not say the day',
      '14 Heat 412 TR · 1 scene',
    ])
    const first = w.find('h3 button[data-tl]')
    expect(first.attributes('aria-expanded')).toBe('true')
    await first.trigger('click')
    expect(first.attributes('aria-expanded')).toBe('false')
    expect(rows(w)).toHaveLength(1)
  })

  it('puts the whole universe on one line of time, years before the epoch first, naming the books', async () => {
    const { w } = await timeline()
    await radio(w, 'Whole universe').trigger('click')
    expect(rows(w)).toEqual([
      '10 before TR 2.1 · b2 two',
      '300 TR 2.1 · a2 Flashback one',
      '14 Heat 412 TR 1.1 · a1 one',
      '413 TR 1.1 · b1 two',
    ])
  })

  it('lists the same rows in a plain table, and scenes with no time apart', async () => {
    const { w } = await timeline([...books, { key: 'free', book: 'one', ch: 'c3' }])
    expect(text(w)).toContain('No time listed (1)')
    await w
      .findAll('button')
      .find((b) => b.text() === 'Table view')!
      .trigger('click')
    const t = w.find('table')
    expect(t.findAll('thead th[scope="col"]').map((h) => h.text())).toEqual([
      'When',
      'What',
      'Kind',
      'Told',
      'Book',
    ])
    expect(t.findAll('tbody tr[aria-rowindex]')).toHaveLength(2)
    expect(text(t.findAll('tbody tr[aria-rowindex]')[0]!)).toContain('Flashback')
  })

  it('moves between the rows with the arrow keys', async () => {
    const { w } = await timeline()
    const all = w.findAll<HTMLElement>('[data-tl]')
    expect(all.length).toBe(4) // two group headers, two rows
    all[0]!.element.focus()
    await all[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(all[1]!.element)
    await all[1]!.trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(all[3]!.element)
    await all[3]!.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(all[3]!.element) // stops at the end
    await all[3]!.trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(all[0]!.element)
  })

  it('leaves the arrow keys alone in the table view, where there are no rows to walk', async () => {
    const { w } = await timeline()
    await w
      .findAll('button')
      .find((b) => b.text() === 'Table view')!
      .trigger('click')
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
    w.find('table').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    // and in the list they are the list's
    await w
      .findAll('button')
      .find((b) => b.text() === 'Table view')!
      .trigger('click')
    const inList = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
    w.find('[data-tl]').element.dispatchEvent(inList)
    expect(inList.defaultPrevented).toBe(true)
  })

  it('is one stop in the Tab order: only the row last focused (or the first) takes Tab', async () => {
    const { w } = await timeline()
    const stops = () => w.findAll('[data-tl]').filter((b) => b.attributes('tabindex') === '0')
    expect(w.findAll('[data-tl]')).toHaveLength(4)
    expect(stops()).toHaveLength(1)
    expect(stops()[0]!.text()).toContain('300 TR') // the first group
    const row = w.findAll('[data-tl]')[3]!
    await row.trigger('focus')
    expect(stops()).toHaveLength(1)
    expect(stops()[0]!.element).toBe(row.element)
    // a row that has closed with its group is not the stop: the first is again
    await w.find('h3 button[data-tl]').trigger('click')
    expect(stops()).toHaveLength(1)
  })

  it('says what a group holds: scenes, and events', async () => {
    const { w } = await timeline(
      [
        { key: 'a', at: '412-03-14' },
        { key: 'b', at: '412-03-15' },
      ],
      { events: [{ key: 'storm', at: '412-03-16' }] },
    )
    expect(text(w)).toContain('412 TR · 2 scenes, 1 event')
    expect(text(w)).toContain('2 scenes, 1 event in Tide')
    const only = await timeline([{ key: 'a', at: '412' }])
    expect(text(only.w)).toContain('412 TR · 1 scene')
  })

  it('is called the Timeline, and draws a closed list of scenes with no time as nothing at all', async () => {
    const many: Sc[] = Array.from({ length: 300 }, (_, i) => ({ key: `u${i}`, ch: `c${i}` }))
    const { w } = await timeline([{ key: 'a', at: '412' }, ...many])
    expect(w.find('h2#timeline-title').text()).toBe('Timeline')
    expect(text(w)).toContain('No time listed (300)')
    expect(w.text()).not.toContain('u17')
    // opened, it draws the rows near its window, not all 300
    const details = w.findAll('details').find((d) => d.text().startsWith('No time listed'))!
    details.element.open = true
    await details.trigger('toggle')
    expect(w.text()).toContain('u0')
    expect(details.findAll('li button').length).toBeLessThan(60)
    expect(details.findAll('li button').length).toBeGreaterThan(3)
  })

  it('lists a time in another calendar as the same kind of button, to open the scene', async () => {
    const moon = 'cal_moonxxxxxx'
    const { w, s } = await timeline(
      [
        { key: 'a', at: '412' },
        { key: 'b', at: '413' },
        { key: 'm', at: '9', calendar: moon },
      ],
      {
        calendars: [
          { id: 'cal_test000000', name: 'Tide' },
          { id: moon, name: 'Moon count' },
        ],
      },
    )
    const details = w.findAll('details').find((d) => d.text().startsWith('In another calendar'))!
    details.element.open = true
    await details.trigger('toggle')
    const open = details.findAll('li button').find((b) => b.text().includes('1.3 · m'))!
    await open.trigger('click')
    expect(push).toHaveBeenLastCalledWith(`/w/${s.input.bookId}/${id.scn('m')}`)
  })

  it('draws one huge group a window at a time, with the header as its one Tab stop and the arrows through its rows', async () => {
    const many: Sc[] = Array.from({ length: 300 }, (_, i) => ({
      key: `d${i}`,
      ch: `c${i}`,
      at: `${400 + i}`,
    }))
    const { w } = await timeline(many)
    await radio(w, 'Era').trigger('click')
    expect(text(w)).toContain('TR · 300 scenes')
    const stops = () => w.findAll('[data-tl]')
    // open (a long story opens its first group), and drawn a window at a time
    expect(w.find('[data-window]').exists()).toBe(true)
    expect(stops().length).toBeGreaterThan(5)
    expect(stops().length).toBeLessThan(80)
    // the header is the one Tab stop, before and after a row has the focus
    const tabbable = () => stops().filter((b) => b.attributes('tabindex') === '0')
    expect(tabbable()).toHaveLength(1)
    expect(tabbable()[0]!.element.closest('h3')).not.toBeNull()
    const [header, first] = stops()
    ;(header!.element as HTMLElement).focus()
    await header!.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(first!.element)
    await first!.trigger('focus')
    expect(tabbable()).toHaveLength(1)
    expect(tabbable()[0]!.element.closest('h3')).not.toBeNull()
    // a short group is drawn whole, with no window
    const few = await timeline([
      { key: 'a', at: '412' },
      { key: 'b', at: '413' },
    ])
    expect(few.w.find('[data-window]').exists()).toBe(false)
  })

  it('draws a long table view a window at a time, and still counts every row', async () => {
    const many: Sc[] = Array.from({ length: 200 }, (_, i) => ({
      key: `d${i}`,
      ch: `c${i}`,
      at: `${400 + i}`,
    }))
    const { w } = await timeline(many)
    await w
      .findAll('button')
      .find((b) => b.text() === 'Table view')!
      .trigger('click')
    expect(w.find('table').attributes('aria-rowcount')).toBe('201')
    const drawn = w.findAll('tbody tr[aria-rowindex]').length
    expect(drawn).toBeGreaterThan(5)
    expect(drawn).toBeLessThan(60)
  })

  it('never compares calendars: a second calendar is chosen, not mixed in', async () => {
    const moon = 'cal_moonxxxxxx'
    const { w } = await timeline(
      [
        { key: 'a', at: '412' },
        { key: 'b', at: '9', calendar: moon },
        { key: 'c', at: '2', calendar: moon },
      ],
      {
        calendars: [
          { id: 'cal_test000000', name: 'Tide' },
          { id: moon, name: 'Moon count' },
        ],
      },
    )
    // the calendar with most dated scenes
    expect(text(w)).toContain('2 scenes in Moon count')
    expect(rows(w)).toEqual(['2 1.3 · c', '9 1.2 · b'])
    expect(text(w)).toContain('In another calendar (1)')
    expect(w.find('[aria-label="Calendar shown"]').exists()).toBe(true)
  })

  it('opens a scene in its own book, and an event on its sheet', async () => {
    const { w, s } = await timeline(books, { events: [{ key: 'storm', at: '350' }] })
    await radio(w, 'Whole universe').trigger('click')
    const row = (what: string) => w.findAll('ol ol li button').find((b) => text(b).includes(what))!
    await row('2.1 · b2').trigger('click')
    expect(push).toHaveBeenLastCalledWith(`/w/${s.models[1]!.bookId}/${id.scn('b2')}`)
    await row('storm').trigger('click')
    expect(push).toHaveBeenLastCalledWith({
      path: `/w/${s.models[0]!.bookId}/world`,
      query: { record: sampleId('evt', 'storm') },
    })
    expect(text(row('storm'))).toContain('Event')
  })

  it('says what to do when nothing has a date yet', async () => {
    const { w } = await timeline([{ key: 'a' }])
    expect(text(w)).toContain('Nothing here has a date yet')
    expect(text(w)).toContain('No time listed (1)')
  })
})
