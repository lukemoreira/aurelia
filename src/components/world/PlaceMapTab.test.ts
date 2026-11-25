// SPDX-License-Identifier: AGPL-3.0-or-later
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { importMedia } from '@/storage/media-actions'
import { setDetails } from '@/storage/outline-actions'
import { addRecord } from '@/storage/record-actions'
import { movePlace } from '@/storage/world-actions'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { outlineRig } from '../../../tests/helpers/outline-rig'
import PlaceMapTab from './PlaceMapTab.vue'
import RecordSheet from './RecordSheet.vue'

const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x80]) as Uint8Array<ArrayBuffer>
const text = (w: { text(): string }) => w.text().replace(/\s+/g, ' ')

beforeEach(() => localStorage.clear())

/** France (a world with a map) holding Paris (a city, with the Louvre inside it) and Lyon; one scene in the Louvre. */
async function open(opts: { map?: boolean; pins?: boolean } = { map: true, pins: true }) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const rig = await outlineRig()
  const ws = useWorkspaceStore(pinia) // by name: work left over from an earlier test may have moved the active one
  ws.attach(rig.session)
  ws.select(rig.session.data.books[0]!.id)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  const { session } = rig
  const unv = session.data.universes[0]!.id
  const make = (type: 'world' | 'place', title: string) =>
    addRecord(session, { type, title, universeId: unv })
  const france = await make('world', 'France')
  const paris = await make('place', 'Paris')
  const louvre = await make('place', 'The Louvre')
  const lyon = await make('place', 'Lyon')
  await make('world', 'Mars')
  await movePlace(session, paris, france)
  await movePlace(session, lyon, france)
  await movePlace(session, louvre, paris)
  await setDetails(session, paris, { kind: 'City' })
  const scene = session.data.scenes[0]!.meta.id
  await setDetails(session, scene, { location: louvre })
  const picture = await importMedia(session, unv, { name: 'france.png', bytes: IMAGE })
  if (opts.map) await setDetails(session, france, { map: picture })
  if (opts.pins)
    await setDetails(session, france, {
      pins: [{ place: paris, x: 0.25, y: 0.5 }],
    })
  const read = async (id: string) => {
    await session.flush()
    return (await rig.adapter.read(session.pathOf(id)!))!.text
  }
  return {
    ...rig,
    ws,
    router,
    unv,
    france,
    paris,
    louvre,
    lyon,
    scene,
    picture,
    read,
    mount: (c: Parameters<typeof mount>[0], props = {}) =>
      mount(c, { props, global: { plugins: [pinia, router] }, attachTo: document.body }),
  }
}
const button = (w: { findAll(s: string): { text(): string }[] }, name: string) =>
  w.findAll('button').find((b) => b.text() === name) as ReturnType<typeof mount>

const has = (w: { findAll(s: string): { text(): string }[] }, name: string) =>
  w.findAll('button').some((b) => b.text() === name)

describe('a place with no map', () => {
  it('says so, and offers the gallery and a new picture; choosing one sets the map', async () => {
    const { france, picture, read, mount: mountIt } = await open({})
    const w = mountIt(PlaceMapTab, { id: france })
    expect(text(w)).toContain('No map yet.')
    expect(w.find('[role=group]').exists()).toBe(false)
    expect(has(w, 'Choose a picture')).toBe(true)
    expect(has(w, 'Add a picture…')).toBe(true)
    await button(w, 'Choose a picture').trigger('click')
    await flushPromises()
    await document.body.querySelector<HTMLElement>(`[aria-label^="Use "]`)!.click()
    await flushPromises()
    expect(await read(france)).toContain(`map: "${picture}"`)
    expect(w.find('[role=group]').exists()).toBe(true)
    w.unmount()
  })
})

describe('a map with a pin', () => {
  it('draws the pin with its place’s name, and lists it beside the places not on the map yet', async () => {
    const { france, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    expect(w.find('[data-pin]').text()).toBe('Paris')
    expect(w.find('[data-pin]').element.closest('div')!.getAttribute('style')).toContain(
      'left: 25%',
    )
    const pinned = w.get('section[aria-labelledby="pinned-title"]')
    expect(text(pinned)).toMatch(/Paris\s*· City/)
    const rest = w.get('section[aria-labelledby="unpinned-title"]')
    expect(text(rest)).toContain('Lyon')
    expect(text(rest)).not.toContain('Paris')
    expect(rest.findAll('button')).toHaveLength(0) // Add is for editing
    w.unmount()
  })

  it('opens a card on click: the place, its level, and the scenes set there including inside places', async () => {
    const { france, paris, router, scene, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await w.get('[data-pin]').trigger('click')
    const card = w.get('[role=dialog]')
    expect(card.get('h3').text()).toBe('Paris')
    expect(text(card)).toContain('City')
    expect(text(card)).toContain('Scenes set here (1)')
    expect(text(card)).toContain('in The Louvre')
    expect(has(card, 'Open its map')).toBe(false) // Paris has no map
    expect(has(card, 'Remove pin')).toBe(false) // not editing
    await button(card, 'Open place').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.record).toBe(paris)
    await w.get('[data-pin]').trigger('click')
    await w.get('[role=dialog] ul button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toContain(scene)
    w.unmount()
  })

  it('offers "Open its map" when that place has one, and links up from an inner map', async () => {
    const { france, paris, unv, session, router, mount: mountIt } = await open()
    const other = await importMedia(session, unv, { name: 'paris.png', bytes: IMAGE })
    await setDetails(session, paris, { map: other })
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await w.get('[data-pin]').trigger('click')
    await button(w.get('[role=dialog]'), 'Open its map').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ record: paris, tab: 'map' })
    w.unmount()
    const inner = mountIt(PlaceMapTab, { id: paris })
    await flushPromises()
    expect(has(inner, 'Inside France — open its map')).toBe(true)
    inner.unmount()
  })

  it('hides a pin whose place was deleted but keeps it in the file, and it comes back with the place', async () => {
    const { france, paris, lyon, session, read, mount: mountIt } = await open()
    const { deleteItem, restoreDeleted } = await import('@/storage/outline-actions')
    await setDetails(session, france, {
      pins: [
        { place: paris, x: 0.25, y: 0.5 },
        { place: lyon, x: 0.6, y: 0.6 },
      ],
    })
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    expect(w.findAll('[data-pin]')).toHaveLength(2)
    const stamp = (await deleteItem(session, lyon)).stamp
    await flushPromises()
    expect(w.findAll('[data-pin]').map((p) => p.text())).toEqual(['Paris'])
    expect(await read(france)).toContain(lyon)
    await restoreDeleted(session, stamp)
    await flushPromises()
    expect(w.findAll('[data-pin]')).toHaveLength(2)
    w.unmount()
  })

  it('says the picture is gone, keeps the pins in the file, and lists none of them', async () => {
    const { france, picture, session, read, mount: mountIt } = await open()
    const { deleteItem } = await import('@/storage/outline-actions')
    await deleteItem(session, picture)
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    expect(text(w)).toContain('This map’s picture is gone. Choose another picture.')
    expect(w.find('[role=group]').exists()).toBe(false)
    expect(text(w)).not.toContain('Pinned places') // a button that opens nothing is not offered
    expect(await read(france)).toContain('pins:')
    w.unmount()
  })
})

describe('a picture the browser cannot draw', () => {
  it('says so, with Choose another picture, and lists no pins', async () => {
    const { france, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await vi.waitFor(() => expect(w.find('img').exists()).toBe(true))
    await w.get('img').trigger('error')
    expect(text(w)).toContain('This map’s picture cannot be shown. Choose another picture.')
    expect(has(w, 'Choose a picture')).toBe(true)
    expect(w.find('[role=group]').exists()).toBe(false)
    expect(text(w)).not.toContain('Pinned places')
    w.unmount()
  })
})

describe('editing pins', () => {
  it('adds a pin: pick a place, drop it in the middle, one write, and the pin has focus', async () => {
    const { france, lyon, read, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    expect(has(w, 'Add pin')).toBe(false)
    await button(w, 'Edit pins').trigger('click')
    expect(has(w, 'Done')).toBe(true) // the button says what it does now
    expect(has(w, 'Edit pins')).toBe(false)
    await button(w, 'Add pin').trigger('click')
    await flushPromises()
    const picker = document.body.querySelector('[role=dialog]')!
    expect(picker.textContent).toContain('Inside France')
    expect(picker.textContent).toContain('Elsewhere in this universe')
    expect(picker.textContent).toContain('On the map. Choosing it moves its pin.') // Paris
    const choose = [...picker.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Lyon'),
    )!
    choose.click()
    await flushPromises()
    expect(text(w)).toContain('Click the map to put “Lyon” there.')
    await button(w, 'Drop it in the middle').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-pin]').map((p) => p.text())).toEqual(['Paris', 'Lyon'])
    expect(await read(france)).toMatch(new RegExp(`place: "${lyon}", x: 0.5, y: 0.5`))
    expect(document.activeElement?.getAttribute('data-pin')).toBe(lyon)
    expect(text(w)).not.toContain('Click the map to put')
    w.unmount()
  })

  it('moves a focused pin with the arrow keys (Shift further) and saves once when the keys stop', async () => {
    const { france, paris, read, mount: mountIt } = await open()
    vi.useFakeTimers()
    try {
      const w = mountIt(PlaceMapTab, { id: france })
      await vi.advanceTimersByTimeAsync(0)
      await button(w, 'Edit pins').trigger('click')
      const pin = w.get('[data-pin]')
      await pin.trigger('keydown', { key: 'ArrowRight' })
      await pin.trigger('keydown', { key: 'ArrowRight' })
      await pin.trigger('keydown', { key: 'ArrowDown', shiftKey: true })
      expect(w.get('[data-pin]').element.closest('div')!.getAttribute('style')).toContain(
        'left: 27%',
      )
      expect(await read(france)).toContain('x: 0.25, y: 0.5') // nothing written yet
      await vi.advanceTimersByTimeAsync(700)
      expect(await read(france)).toContain(`place: "${paris}", x: 0.27, y: 0.55`)
      w.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes a pin from its card, and takes the pin and the map off together after asking', async () => {
    const { france, paris, read, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    await w.get('[data-pin]').trigger('click')
    await button(w.get('[role=dialog]'), 'Remove pin').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-pin]')).toHaveLength(0)
    expect(await read(france)).not.toContain(paris)
    const rest = w.get('section[aria-labelledby="unpinned-title"]')
    expect(rest.findAll('button').map((b) => b.text())).toEqual(['Add', 'Add']) // Paris and Lyon, in edit mode

    await button(w, 'Remove map').trigger('click')
    await flushPromises()
    const ask = document.body.querySelector('[role=dialog]')!
    expect(ask.textContent).toContain('every pin on it')
    expect(await read(france)).toContain('map:') // asked, not yet done
    ;[...ask.querySelectorAll('button')].find((b) => b.textContent === 'Remove map')!.click()
    await flushPromises()
    expect(await read(france)).not.toContain('map:')
    expect(text(w)).toContain('No map yet.')
    w.unmount()
  })
})

describe('a save lands on the record it was made on', () => {
  it('a nudge still waiting when another record opens is saved to the first record, not the second', async () => {
    const { france, paris, read, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    await w.get('[data-pin]').trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    await (w as unknown as { setProps(p: object): Promise<void> }).setProps({ id: paris }) // "Open its map", Back, Forward: the same tab, another record
    await flushPromises()
    expect(await read(france)).toContain(`place: "${paris}", x: 0.3, y: 0.5`)
    expect(await read(paris)).not.toContain('pins:')
    w.unmount()
  })
})

describe('when the tab is reused for another record', () => {
  it('a slow import becomes the map of the record it was started on', async () => {
    const { france, paris, read, mount: mountIt } = await open({})
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    const input = w.get('input[type=file]').element as HTMLInputElement
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'slow.png', {
      type: 'image/png',
    })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await w.get('input[type=file]').trigger('change')
    await (w as unknown as { setProps(p: object): Promise<void> }).setProps({ id: paris }) // before the import ends
    await vi.waitFor(async () => expect(await read(france)).toContain('map: "med_'))
    expect(await read(paris)).not.toContain('map:')
    w.unmount()
  })

  it('does not carry the zoom state, Names or a refusal of the first record to the second', async () => {
    const { france, paris, unv, session, ws, mount: mountIt } = await open()
    const other = await importMedia(session, unv, { name: 'paris.png', bytes: IMAGE })
    await setDetails(session, paris, { map: other })
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Names').trigger('click')
    expect(button(w, 'Names').attributes('aria-pressed')).toBe('false')
    await button(w, 'Edit pins').trigger('click')
    ;(session as unknown as { otherTab: boolean }).otherTab = true
    await w.get('[data-pin]').trigger('keydown', { key: 'ArrowRight' })
    await vi.waitFor(() => expect(w.find('[role=alert]').exists()).toBe(true), { timeout: 3000 })
    ;(session as unknown as { otherTab: boolean }).otherTab = false
    await (w as unknown as { setProps(p: object): Promise<void> }).setProps({ id: paris })
    await flushPromises()
    expect(button(w, 'Names').attributes('aria-pressed')).toBe('true') // a fresh map
    expect(w.find('[role=alert]').exists()).toBe(false) // the other record's refusal is not shown here
    expect(ws.data).toBeTruthy()
    w.unmount()
  })

  it('a refused move sends the pin back to where the file has it, and nothing retries it', async () => {
    const { france, session, read, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    ;(session as unknown as { otherTab: boolean }).otherTab = true
    await w.get('[data-pin]').trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(w.get('[data-pin]').element.parentElement!.getAttribute('style')).toContain('left: 30%')
    await vi.waitFor(
      () =>
        expect(w.get('[data-pin]').element.parentElement!.getAttribute('style')).toContain(
          'left: 25%',
        ),
      { timeout: 3000 },
    )
    ;(session as unknown as { otherTab: boolean }).otherTab = false
    w.unmount() // flush on the way out must not write the unsaved spot
    expect(await read(france)).toContain('x: 0.25, y: 0.5')
  })
})

describe('a pin cancelled mid-drag and a pin with names off', () => {
  it('a cancelled drag does not swallow the next click on a pin', async () => {
    const { france, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    const pin = w.get('[data-pin]')
    const at = { pointerId: 3, pointerType: 'touch', button: 0 }
    await pin.trigger('pointerdown', { ...at, clientX: 10, clientY: 10 })
    await pin.trigger('pointermove', { ...at, clientX: 40, clientY: 40 })
    await pin.trigger('pointercancel', at) // the browser took the touch for a scroll
    await pin.trigger('click')
    expect(w.find('[role=dialog]').exists()).toBe(true)
    w.unmount()
  })

  it('a pin is named by its place with Names off, and takes the finger only while editing', async () => {
    const { france, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Names').trigger('click')
    expect(w.get('[data-pin]').attributes('aria-label')).toBe('Paris')
    expect(w.get('[data-pin]').classes()).not.toContain('touch-none')
    await button(w, 'Edit pins').trigger('click')
    expect(w.get('[data-pin]').classes()).toContain('touch-none')
    w.unmount()
  })
})

describe('final checks on cards, drags and keys', () => {
  const setProps = (w: unknown, id: string) =>
    (w as { setProps(p: object): Promise<void> }).setProps({ id })

  it('a write that fails after another record opened shows its refusal nowhere', async () => {
    const { france, paris, session, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    ;(session as unknown as { otherTab: boolean }).otherTab = true
    await w.get('[data-pin]').trigger('keydown', { key: 'ArrowRight' })
    await setProps(w, paris) // the waiting move is flushed now, and refused a moment later
    await new Promise((r) => setTimeout(r, 300))
    await flushPromises()
    expect(w.find('[role=alert]').exists()).toBe(false)
    ;(session as unknown as { otherTab: boolean }).otherTab = false
    w.unmount()
  })

  it('a drag that ends with no click, then a press and click, opens the card (the press clears the drag)', async () => {
    const { france, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    const pin = w.get('[data-pin]')
    const at = { pointerId: 4, pointerType: 'mouse', button: 0 }
    await pin.trigger('pointerdown', { ...at, clientX: 10, clientY: 10 })
    await pin.trigger('pointermove', { ...at, clientX: 40, clientY: 40 })
    await pin.trigger('pointerup', at) // a drag ends; the click that follows it never comes
    expect(w.find('[role=dialog]').exists()).toBe(false)
    await pin.trigger('pointerdown', { ...at, clientX: 10, clientY: 10 })
    await pin.trigger('click')
    expect(w.find('[role=dialog]').exists()).toBe(true)
    w.unmount()
  })

  it('a card closes when its pin stops being shown, and does not come back with it', async () => {
    const { france, paris, session, mount: mountIt } = await open()
    const { deleteItem, restoreDeleted } = await import('@/storage/outline-actions')
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await w.get('[data-pin]').trigger('click')
    expect(w.find('[role=dialog]').exists()).toBe(true)
    const { stamp } = await deleteItem(session, paris)
    await flushPromises()
    expect(w.find('[role=dialog]').exists()).toBe(false)
    await restoreDeleted(session, stamp)
    await flushPromises()
    expect(w.findAll('[data-pin]')).toHaveLength(1)
    expect(w.find('[role=dialog]').exists()).toBe(false)
    w.unmount()
  })

  it('says once that a pin moved after the arrow keys are saved', async () => {
    const { france, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    await w.get('[data-pin]').trigger('keydown', { key: 'ArrowRight' })
    await w.get('[data-pin]').trigger('keydown', { key: 'ArrowRight' })
    expect(useEditsStore().announcement).toBe('')
    await vi.waitFor(() => expect(useEditsStore().announcement).toBe('“Paris” moved.'), {
      timeout: 3000,
    })
    w.unmount()
  })

  it('a second finger on another pin does not take over the drag', async () => {
    const { france, paris, lyon, session, mount: mountIt } = await open()
    await setDetails(session, france, {
      pins: [
        { place: paris, x: 0.25, y: 0.5 },
        { place: lyon, x: 0.6, y: 0.6 },
      ],
    })
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    const [a, b] = w.findAll('[data-pin]')
    const style = (pin: typeof a) => pin!.element.parentElement!.getAttribute('style')
    const touch = (pointerId: number) => ({ pointerId, pointerType: 'touch', button: 0 })
    await a!.trigger('pointerdown', { ...touch(1), clientX: 0, clientY: 0 })
    await b!.trigger('pointerdown', { ...touch(2), clientX: 0, clientY: 0 })
    await b!.trigger('pointermove', { ...touch(2), clientX: 9, clientY: 9 }) // the second finger moves: nothing drags
    expect(style(a)).toContain('left: 25%')
    expect(style(b)).toContain('left: 60%')
    await a!.trigger('pointermove', { ...touch(1), clientX: 9, clientY: 9 })
    expect(style(a)).not.toContain('left: 25%')
    expect(style(b)).toContain('left: 60%')
    w.unmount()
  })
})

describe('a refused write is not announced as done', () => {
  it('shows the reason, adds no pin, announces nothing and focuses nothing', async () => {
    const { france, lyon, session, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    await button(w, 'Add pin').trigger('click')
    await flushPromises()
    ;[...document.body.querySelectorAll('[role=dialog] button')]
      .find((b) => b.textContent?.includes('Lyon'))!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    ;(session as unknown as { otherTab: boolean }).otherTab = true // another tab holds the folder
    await button(w, 'Drop it in the middle').trigger('click')
    await flushPromises()
    expect(w.get('[role=alert]').text()).not.toBe('')
    expect(w.findAll('[data-pin]').map((p) => p.text())).toEqual(['Paris'])
    expect(useEditsStore().announcement).toBe('')
    expect(document.activeElement?.getAttribute('data-pin')).not.toBe(lyon)
    ;(session as unknown as { otherTab: boolean }).otherTab = false
    w.unmount()
  })

  it('does not pin a place that was deleted meanwhile, nor a place on its own map', async () => {
    const { france, lyon, session, mount: mountIt } = await open()
    const { deleteItem } = await import('@/storage/outline-actions')
    const { pinPlace } = await import('@/storage/place-map-actions')
    await deleteItem(session, lyon)
    await expect(pinPlace(session, france, lyon, 0.5, 0.5)).rejects.toThrow('no longer')
    await expect(pinPlace(session, france, france, 0.5, 0.5)).rejects.toThrow('own map')
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    expect(w.findAll('[data-pin]')).toHaveLength(1)
    w.unmount()
  })
})

describe('scenes set here', () => {
  it('lists only scenes of this universe’s books', async () => {
    const { france, paris, ws, mount: mountIt } = await open()
    const here = ws.data!.scenes[0]!
    ws.data!.scenes.push({
      ...here,
      meta: { ...here.meta, id: 'scn_zzzzzzzzzz', title: 'Another universe', location: paris },
      book: 'bok_zzzzzzzzzz',
    })
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await w.get('[data-pin]').trigger('click')
    const card = w.get('[role=dialog]')
    expect(text(card)).toContain('Scenes set here (1)')
    expect(text(card)).not.toContain('Another universe')
    w.unmount()
  })
})

describe('placing a pin', () => {
  async function placing() {
    const o = await open()
    const w = o.mount(PlaceMapTab, { id: o.france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    await button(w, 'Add pin').trigger('click')
    await flushPromises()
    ;[...document.body.querySelectorAll('[role=dialog] button')]
      .find((b) => b.textContent?.includes('Lyon'))!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    return { ...o, w }
  }
  const tap = async (w: ReturnType<typeof mount>, init: PointerEventInit) => {
    const frame = w.get('[role=group]')
    await frame.trigger('pointerdown', { pointerId: 1, pointerType: 'mouse', ...init })
    await frame.trigger('pointerup', { pointerId: 1, pointerType: 'mouse', ...init })
    await flushPromises()
  }

  it('drops on a main-button click on the picture, and not on a right-click or a click beside it', async () => {
    const { w, lyon, france, read } = await placing()
    await tap(w, { button: 2, clientX: 0, clientY: 0 }) // a right-click or Ctrl-click
    expect(await read(france)).not.toContain(lyon)
    expect(w.findAll('[data-pin]')).toHaveLength(1)
    await tap(w, { button: 0, ctrlKey: true, clientX: 0, clientY: 0 }) // a Ctrl-click can arrive as button 0 on a Mac
    expect(w.findAll('[data-pin]')).toHaveLength(1)
    await tap(w, { button: 0, clientX: 500, clientY: 500 }) // in the margin beside the picture
    expect(w.findAll('[data-pin]')).toHaveLength(1)
    await tap(w, { button: 0, clientX: 0, clientY: 0 })
    expect(w.findAll('[data-pin]')).toHaveLength(2)
    w.unmount()
  })

  it('gives the pins no pointer while waiting, so a click near one drops there', async () => {
    const { w } = await placing()
    expect(w.get('[data-pin]').element.parentElement!.className).toContain('pointer-events-none')
    w.unmount()
  })

  it('keeps one live region on the page, filled when placing starts, and Escape cancels and returns to Add pin', async () => {
    const { w } = await placing()
    const region = w.get('p[role=status]')
    expect(region.text()).toContain('Click the map to put “Lyon” there')
    await w.get('[role=group]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(text(w)).not.toContain('Drop it in the middle')
    expect(w.get('p[role=status]').text()).toBe('')
    expect(document.activeElement?.textContent).toContain('Add pin')
    w.unmount()
  })
})

describe('the tab for someone who is learning it', () => {
  it('says how to add the first pin, and the pin card closes with an icon, with Remove pin last', async () => {
    const { france, paris, session, mount: mountIt } = await open()
    const { setDetails: set } = await import('@/storage/outline-actions')
    await set(session, france, { pins: undefined })
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    expect(text(w)).toContain('No pins yet. Press Edit pins, then Add pin, then click the map.')
    await set(session, france, { pins: [{ place: paris, x: 0.3, y: 0.3 }] })
    await flushPromises()
    expect(text(w)).not.toContain('No pins yet.')
    await button(w, 'Edit pins').trigger('click')
    await w.get('[data-pin]').trigger('click')
    const card = w.get('[role=dialog]')
    expect(card.find('button[aria-label=Close]').exists()).toBe(true)
    expect(has(card, 'Close')).toBe(false) // no text Close button
    const buttons = card.findAll('button').map((b) => b.text() || b.attributes('aria-label'))
    expect(buttons.at(-1)).toBe('Remove pin')
    w.unmount()
  })

  it('moves focus to the next pin after Remove pin, and to the edit button when none is left', async () => {
    const { france, paris, lyon, session, mount: mountIt } = await open()
    const { setDetails: set } = await import('@/storage/outline-actions')
    await set(session, france, {
      pins: [
        { place: paris, x: 0.2, y: 0.2 },
        { place: lyon, x: 0.6, y: 0.6 },
      ],
    })
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    await button(w, 'Edit pins').trigger('click')
    await w.get('[data-pin]').trigger('click')
    await button(w.get('[role=dialog]'), 'Remove pin').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('data-pin')).toBe(lyon))
    await w.get('[data-pin]').trigger('click')
    await button(w.get('[role=dialog]'), 'Remove pin').trigger('click')
    await vi.waitFor(() => expect(document.activeElement?.textContent).toContain('Done'))
    w.unmount()
  })

  it('has the zoom buttons and Names before the pins in the page order, and names are on until switched off', async () => {
    const { france, mount: mountIt } = await open()
    const w = mountIt(PlaceMapTab, { id: france })
    await flushPromises()
    const all = [...w.get('[role=group]').element.querySelectorAll('button')]
    expect(
      all.map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim()).slice(0, 4),
    ).toEqual(['Zoom in', 'Zoom out', 'Fit', 'Names'])
    expect(all.at(-1)?.hasAttribute('data-pin')).toBe(true)
    const names = button(w, 'Names')
    expect(names.attributes('aria-pressed')).toBe('true')
    await names.trigger('click')
    expect(names.attributes('aria-pressed')).toBe('false')
    expect(w.get('[data-pin] span').classes()).toContain('hidden') // shown only on hover, focus or open
    w.unmount()
  })
})

describe('the Map tab on the record sheet', () => {
  it('is there for a place and a world, not for a character, and a link can open on it', async () => {
    const { france, session, unv, router, mount: mountIt } = await open()
    const elena = await addRecord(session, { type: 'character', title: 'Elena', universeId: unv })
    const tabs = async (id: string) => {
      const w = mountIt(RecordSheet, { id })
      await flushPromises()
      return { w, names: w.findAll('[role=tab]').map((t) => t.text()) }
    }
    const place = await tabs(france)
    expect(place.names).toEqual(['Overview', 'Senses', 'Map', 'Notes'])
    const character = await tabs(elena)
    expect(character.names).not.toContain('Map')
    place.w.unmount()
    character.w.unmount()
    await router.push({ path: '/', query: { record: france, tab: 'map' } })
    const sheet = mountIt(RecordSheet, { id: france })
    await flushPromises()
    expect(sheet.get('[role=tab][data-state=active]').text()).toBe('Map')
    // A tab the author picked is kept through a navigation that changes nothing about the record or the tab.
    await sheet.findAll('[role=tab]')[0]!.trigger('mousedown', { button: 0 })
    await sheet.findAll('[role=tab]')[0]!.trigger('click')
    await router.push({ path: '/', query: { record: france, tab: 'map', other: '1' } })
    await flushPromises()
    expect(sheet.get('[role=tab][data-state=active]').text()).toBe('Overview')
    sheet.unmount()
  })
})
