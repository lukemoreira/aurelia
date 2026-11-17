// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addChange } from '@/storage/continuity-actions'
import { setDetails } from '@/storage/outline-actions'
import { addRecord } from '@/storage/record-actions'
import { useEditsStore } from '@/stores/edits'
import { useReviewStore } from '@/stores/review'
import { useWorkspaceStore } from '@/stores/workspace'
import { story, type Sc } from '../../tests/helpers/continuity-fixture'
import { storyRig } from '../../tests/helpers/story-rig'
import ContinuityView from './ContinuityView.vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
beforeEach(() => {
  localStorage.clear()
  push.mockClear()
})

const names = { characters: ['ana', 'bob'], arcs: ['debt'] }
const die = { who: 'bob', kind: 'status', value: 'dead' }

/** A 30-chapter book in the workspace store (the sample's way: in memory, nothing to write to). */
function open(scenes: Sc[]) {
  setActivePinia(createPinia())
  const s = story(scenes, { names })
  const ws = useWorkspaceStore()
  ws.load(s.data)
  ws.select(s.input.bookId)
  return mount(ContinuityView, { global: { plugins: [] } })
}
const book = (n: number): Sc[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `s${i}`,
    ch: `c${String(i).padStart(2, '0')}`,
    pov: i % 2 ? 'bob' : 'ana',
    ...(i === 3 ? { changes: [die] } : {}),
  }))
const table = (w: VueWrapper) => w.find('table[aria-rowcount]')

describe('the presence map is a real table', () => {
  it('has a column header for each chapter in view, a row header for each person, and words in every cell', () => {
    const w = open(book(10))
    const t = table(w)
    expect(t.find('caption').text()).toContain('Who is on the page in each chapter')
    const heads = t.findAll('thead th[scope="col"]')
    expect(heads).toHaveLength(11) // "Characters" and ten chapters
    expect(heads[1]!.text()).toBe('Chapter 1')
    const rows = t.findAll('tbody tr[aria-rowindex]')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.find('th[scope="row"]').text()).toMatch(/ana|bob/)
      const cells = row.findAll('td')
      expect(cells).toHaveLength(10)
      for (const c of cells) expect(c.text().length).toBeGreaterThan(0)
    }
    expect(rows[0]!.findAll('td')[0]!.text()).toBe('Point of view')
  })

  it('says a death and a finding in words, not in colour alone', () => {
    // bob dies in chapter 4 (index 3) and is the point of view in chapter 6: an Error
    const text = open(book(10)).find('table[aria-rowcount]').text()
    expect(text).toContain('Point of view, dies')
    expect(text).toContain('finding')
    expect(text).toContain('Not present')
  })

  it('shows a book of 30 chapters a stretch at a time, with sticky headers, and pages through it', async () => {
    const w = open(book(30))
    expect(w.text()).toContain('Chapters 1–24 · 1–24 of 30')
    expect(table(w).findAll('thead th[scope="col"]')).toHaveLength(25)
    expect(table(w).find('thead th').classes()).toContain('sticky')
    expect(w.find('button[aria-label="Earlier chapters"]').attributes('disabled')).toBeDefined()
    await w.find('button[aria-label="Later chapters"]').trigger('click')
    expect(w.text()).toContain('Chapters 25–30 · 25–30 of 30')
    expect(table(w).findAll('thead th[scope="col"]')).toHaveLength(7)
    expect(w.find('button[aria-label="Later chapters"]').attributes('disabled')).toBeDefined()
  })

  it('lists the same data as plain lines under "Table view", and goes back', async () => {
    const w = open(book(10))
    const toggle = w.findAll('button').find((b) => b.text() === 'Table view')!
    await toggle.trigger('click')
    expect(table(w).exists()).toBe(false)
    const list = w.find('ul[aria-label="Who is on the page"]')
    expect(list.text()).toContain('ana')
    expect(list.text()).toContain('chapter 1: point of view · chapter 3: point of view')
    expect(list.text()).toContain('point of view')
    await toggle.trigger('click')
    expect(table(w).exists()).toBe(true)
  })

  it('draws only the rows near the window of a long list of people, and still counts them all', () => {
    const many: Sc[] = Array.from({ length: 60 }, (_, i) => ({
      key: `s${i}`,
      ch: 'c',
      pov: `p${i}`,
    }))
    setActivePinia(createPinia())
    const s = story(many, { names: { characters: many.map((m) => m.pov!) } })
    const ws = useWorkspaceStore()
    ws.load(s.data)
    ws.select(s.input.bookId)
    const w = mount(ContinuityView)
    expect(table(w).attributes('aria-rowcount')).toBe('61')
    const drawn = table(w).findAll('tbody tr[aria-rowindex]').length
    expect(drawn).toBeGreaterThan(5)
    expect(drawn).toBeLessThan(40)
  })
})

describe('the rest of the view', () => {
  it('shows arc lanes as a table with a word in every cell, POV balance and the numbers', () => {
    const w = open(
      book(10).map((s, i) =>
        i === 0
          ? { ...s, arcs: ['debt'] }
          : i === 9
            ? { ...s, changes: [{ who: 'debt', kind: 'beat', value: 'x' }] }
            : s,
      ),
    )
    const lanes = w.findAll('table').find((t) => t.find('caption').text().includes('arc moves'))!
    expect(lanes.find('tbody th[scope="row"]').text()).toContain('debt')
    const cells = lanes.findAll('tbody td')
    expect(cells).toHaveLength(10)
    const words = cells.map((c) => c.find('.sr-only').text())
    expect(words.every((x) => x.length > 0)).toBe(true)
    expect(words).toContain('Silent')
    expect(w.find('section[aria-labelledby="pov-title"]').text()).toContain('50%')
    expect(w.find('ul[aria-label="At a glance"]').text()).toContain('scenes have changes recorded')
  })

  it('says so when no scene has a story time, and charts the ones that do', () => {
    expect(open(book(3)).text()).toContain('No scene has a story time yet')
    const w = open(book(3).map((s, i) => ({ ...s, at: `412-01-1${i}` })))
    const svg = w.find('svg[role="img"]')
    expect(svg.attributes('aria-label')).toContain('3 scenes with a time')
  })
})

describe('the findings list', () => {
  /** A real workspace where bob dies in Start and is the point of view of Left, which reads after it. */
  async function withFinding() {
    setActivePinia(createPinia())
    const r = await storyRig()
    const { session } = r
    const unv = session.data.universes[0]!.id
    const bob = await addRecord(session, { type: 'character', title: 'Bob', universeId: unv })
    await setBookMode(r)
    await setDetails(session, r.left, { pov: bob })
    await addChange(session, r.start, { kind: 'status', who: bob, value: 'dead' })
    const w = mount(ContinuityView)
    await flushPromises()
    return { ...r, w, bob }
  }
  const setBookMode = (r: { session: Parameters<typeof setDetails>[0]; book: string }) =>
    setDetails(r.session, r.book, { mode: 'linear' })
  const items = (w: VueWrapper) => w.findAll('aside[aria-label="Findings"] ol > li')

  it('lists a finding with its severity as a word, where it is and what to do', async () => {
    const { w } = await withFinding()
    const [first] = items(w)
    expect(first!.text()).toContain('Error')
    expect(first!.text()).toContain('Appears after death or exit')
    expect(first!.text()).toContain('Bob is dead since 1.1 · Start, but appears in 1.2 · Left.')
    expect(w.find('aside[aria-label="Findings"] h2').text()).toContain('1')
    expect(first!.text()).toContain('Go to 1.2')
  })

  it('goes to the scene, and marks a finding intended in book.json, and brings it back with Undo', async () => {
    const { w, session, book, left } = await withFinding()
    await items(w)[0]!
      .findAll('button')
      .find((b) => b.text().startsWith('Go to'))!
      .trigger('click')
    expect(push).toHaveBeenCalledWith(`/w/${book}/${left}`)

    await items(w)[0]!
      .findAll('button')
      .find((b) => b.text() === 'Mark intended')!
      .trigger('click')
    await vi.waitFor(() => expect(session.data.books[0]!.dismissedFindings).toHaveLength(1))
    expect(session.data.books[0]!.dismissedFindings![0]).toMatch(/^appears-after-exit:/)
    await vi.waitFor(() => expect(items(w)).toHaveLength(0))
    expect(w.text()).toContain('Nothing to fix here')

    const marked = w.findAll('button').find((b) => b.text() === '1 marked as intended')!
    await marked.trigger('click')
    await w
      .find('ul[aria-label="Marked as intended"]')
      .findAll('button')
      .find((b) => b.text() === 'Undo')!
      .trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(session.data.books[0]!.dismissedFindings).toBeUndefined())
    await vi.waitFor(() => expect(items(w)).toHaveLength(1))
  })

  it('filters by group, and counts what is in each', async () => {
    const { w } = await withFinding()
    const group = w.find('[aria-label="Filter findings"]')
    expect(group.text()).toContain('Characters 1')
    await group
      .findAll('button')
      .find((b) => b.text().startsWith('Time'))!
      .trigger('click')
    expect(items(w)).toHaveLength(0)
    await group
      .findAll('button')
      .find((b) => b.text().startsWith('Characters'))!
      .trigger('click')
    expect(items(w)).toHaveLength(1)
  })

  it('offers no mark in a workspace that cannot be written to', async () => {
    const w = open(book(10))
    expect(items(w).length).toBeGreaterThan(0)
    expect(w.findAll('button').some((b) => b.text() === 'Mark intended')).toBe(false)
  })

  it('Go to opens the scene with the person as they are written there selected', async () => {
    const r = await withFinding()
    r.ws.editScene(r.left, 'They said it was Bob who walked in, as if nothing had happened.')
    await flushPromises()
    await vi.waitFor(() => expect(items(r.w)).toHaveLength(1))
    await items(r.w)[0]!
      .findAll('button')
      .find((b) => b.text().startsWith('Go to'))!
      .trigger('click')
    expect(useReviewStore().found).toEqual({ id: r.left, term: 'Bob' })
    expect(push).toHaveBeenCalledWith(`/w/${r.book}/${r.left}`)
  })

  it('shows one scene’s findings alone, from the inspector’s Review, until Show all', async () => {
    const r = await withFinding()
    useEditsStore().findingsScene = r.start // a scene the finding is not about, except as the place of the death
    await flushPromises()
    expect(r.w.text()).toContain('Findings for 1.1 · Start')
    expect(items(r.w)).toHaveLength(1) // the death is in Start: the finding is about it too
    useEditsStore().findingsScene = r.right
    await flushPromises()
    expect(items(r.w)).toHaveLength(0)
    await r.w
      .findAll('button')
      .find((b) => b.text() === 'Show all')!
      .trigger('click')
    expect(items(r.w)).toHaveLength(1)
  })

  it('a finding’s cell on the map is a button: it says what it is under the map and sends the keyboard to the finding', async () => {
    const r = await withFinding()
    const host = document.createElement('div')
    document.body.append(host)
    const w = mount(ContinuityView, { attachTo: host })
    await flushPromises()
    const cell = w
      .findAll('table[aria-rowcount] td button')
      .find((b) => b.text().includes('finding'))!
    await cell.trigger('click')
    expect(w.text()).toContain('Bob, chapter 1: Point of view, dies, finding. Bob is dead since')
    await flushPromises()
    expect(document.activeElement?.getAttribute('data-finding')).toBe('appears-after-exit')
    w.unmount()
    host.remove()
    expect(r.book).toBeTruthy()
  })
})

describe('numbering of a book whose chapters do not begin at 1', () => {
  it('says the chapters by their numbers and never "of" a smaller count', () => {
    setActivePinia(createPinia())
    const s = story(book(4), { names })
    const ws = useWorkspaceStore()
    ws.load({ ...s.data, chapters: s.data.chapters.map((c, i) => ({ ...c, number: 5 + i })) })
    ws.select(s.input.bookId)
    const w = mount(ContinuityView)
    expect(w.text()).toContain('Chapters 5–8')
    expect(w.find('[role="group"][aria-label="Chapters"] [role="status"]').text()).toBe(
      'Chapters 5–8',
    ) // not "of 4"
    expect(w.find('table[aria-rowcount]').findAll('thead th')[1]!.text()).toBe('Chapter 5')
  })
})

describe('the map on a phone', () => {
  it('keeps a narrow name column and puts the findings before the map', () => {
    const w = open(book(4))
    expect(w.find('table[aria-rowcount] thead th').classes()).toContain('w-[132px]')
    expect(w.find('aside[aria-label="Findings"]').classes()).toContain('order-first')
  })
})
