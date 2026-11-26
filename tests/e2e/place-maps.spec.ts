// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test'
import {
  createBrowserWorkspace,
  opfs,
  seriousViolations,
  waitSaved,
} from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
// Each test builds a world through the screens, so it takes longer than the default on a busy machine.
test.describe.configure({ timeout: 90_000 })
const shots = 'test-results/place-maps-screenshots'

const sheet = (page: Page) => page.getByRole('region', { name: 'Record' })

async function create(page: Page, item: string, name: string) {
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: item }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name)
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).press('Enter')
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** Put the open place inside another: the sheet's "Inside" choice, which lists places with where they sit. */
async function putInside(page: Page, where: string) {
  await sheet(page).getByRole('combobox', { name: 'Inside' }).click()
  await page.getByRole('option', { name: where, exact: true }).click()
  await waitSaved(page)
}

/** A real PNG drawn in the page (a map-ish picture, wider than tall). */
async function png(page: Page, label: string, pale = false): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ text, pale }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 800
      canvas.height = 500
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = pale ? '#f4f0e4' : '#9fc5a0'
      ctx.fillRect(0, 0, 800, 500)
      ctx.fillStyle = pale ? '#dfe8ee' : '#2f6690'
      ctx.fillRect(0, 380, 800, 120)
      ctx.fillStyle = '#1b1a1f'
      ctx.font = '48px serif'
      ctx.fillText(text, 40, 80)
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (const b of bytes) s += String.fromCharCode(b)
      return btoa(s)
    },
    { text: label, pale },
  )
  return Buffer.from(base64, 'base64')
}

/** A picture of the settled screen: toasts and tips put away, and no transition caught part-way. */
async function shoot(page: Page, path: string) {
  for (const name of ['Dismiss', 'Not now']) {
    const button = page.getByRole('button', { name, exact: true })
    if (await button.first().isVisible()) await button.first().click()
  }
  await page.screenshot({ path, animations: 'disabled' })
}

const mapFrame = (page: Page, place: string) =>
  sheet(page).getByRole('group', { name: `Map: ${place}` })

/** The Map tab of the open place, with a new picture added to it. */
async function addMap(page: Page, place: string, label: string, pale = false) {
  await sheet(page).getByRole('tab', { name: 'Map' }).click()
  await expect(sheet(page).getByText('No map yet.')).toBeVisible()
  await sheet(page)
    .getByLabel('Choose a map picture to add')
    .setInputFiles({
      name: `${label}.png`,
      mimeType: 'image/png',
      buffer: await png(page, label, pale),
    })
  const img = mapFrame(page, place).locator('img')
  await expect(img).toBeVisible()
  await expect
    .poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
}

for (const scheme of ['light', 'dark'] as const) {
  test(`a map with a pin: open it, see the scenes set there, open the inner place’s map, in the ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page, 'My Writing')
    await page.getByRole('link', { name: 'World' }).click()
    await create(page, 'New world', 'France')
    await create(page, 'New place', 'Paris')
    await putInside(page, 'France')
    await create(page, 'New place', 'The Louvre')
    await putInside(page, 'France › Paris')

    // A scene set in the Louvre.
    await page.getByRole('link', { name: 'Write' }).click()
    const inspector = page.getByRole('complementary', { name: 'Scene inspector' })
    await inspector.getByLabel('Title', { exact: true }).fill('The Lantern Gate')
    await inspector.getByLabel('Title', { exact: true }).press('Tab')
    await inspector.getByRole('combobox', { name: 'Location' }).click()
    await page.getByRole('option', { name: 'The Louvre' }).click()
    await waitSaved(page)

    // Paris gets a map first, so France's pin can open it.
    await page.getByRole('link', { name: 'World' }).click()
    await page.getByRole('treeitem', { name: /Paris/ }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Paris' })).toBeVisible()
    await addMap(page, 'Paris', 'Paris')
    await waitSaved(page)

    // France: a map, then a pin for Paris.
    await page
      .getByRole('navigation', { name: 'Where this is' })
      .getByRole('button', { name: 'France' })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: 'France' })).toBeVisible()
    await addMap(page, 'France', 'France')
    await expect(sheet(page).getByText('No pins yet. Press Edit pins, then Add pin')).toBeVisible()
    await sheet(page).getByRole('button', { name: 'Edit pins' }).click()
    await expect(sheet(page).getByRole('button', { name: 'Done' })).toBeVisible() // it says what it does now
    await sheet(page).getByRole('button', { name: 'Add pin' }).click()
    const picker = page.getByRole('dialog', { name: 'Add a pin' })
    await expect(picker.getByText('Inside France')).toBeVisible()
    await picker.getByRole('button', { name: /^Paris/ }).click()
    await expect(sheet(page).getByText('Click the map to put “Paris” there.')).toBeVisible()
    // The live region was on the page empty and is filled now; Escape cancels and goes back to Add pin.
    await expect(sheet(page).getByRole('status').filter({ hasText: 'Escape cancels' })).toHaveCount(
      1,
    )
    await page.keyboard.press('Escape')
    await expect(sheet(page).getByText('Click the map to put')).toHaveCount(0)
    await expect(sheet(page).getByRole('button', { name: 'Add pin' })).toBeFocused()
    await sheet(page).getByRole('button', { name: 'Add pin' }).click()
    await picker.getByRole('button', { name: /^Paris/ }).click()
    const frame = mapFrame(page, 'France')
    await frame.click({ position: { x: 300, y: 200 } })
    const pin = frame.getByRole('button', { name: 'Paris' })
    await expect(pin).toBeVisible()
    await waitSaved(page)
    await expect(sheet(page).getByRole('heading', { name: 'Pinned places' })).toBeVisible()

    // The pin survives a reload, as the file says.
    const files = await opfs.list(page)
    const record = files.find((f) => /records\/worlds\/wld_\w+\.md$/.test(f))!
    expect(await opfs.read(page, record)).toMatch(
      /pins:\n {2}- \{ place: "plc_\w+", x: 0\.\d+, y: 0\.\d+ \}/,
    )
    await page.reload()
    await page.getByRole('link', { name: 'World' }).click()
    await page
      .getByRole('treeitem', { name: /France/ })
      .first()
      .click()
    await sheet(page).getByRole('tab', { name: 'Map' }).click()
    await expect(frame.getByRole('button', { name: 'Paris' })).toBeVisible()

    // A plain wheel scrolls the page and leaves the zoom alone; Ctrl + wheel zooms.
    const scale = () =>
      frame
        .locator('div.origin-top-left')
        .first()
        .evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a)
    const box = (await frame.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -400)
    expect(await scale()).toBe(1)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -400)
    await page.keyboard.up('Control')
    await expect.poll(scale).toBeGreaterThan(1)
    await sheet(page).getByRole('button', { name: 'Fit' }).click()
    await expect.poll(scale).toBe(1)

    // View mode: the pin opens a card with the place and the scene set inside it.
    await frame.getByRole('button', { name: 'Paris' }).click()
    const card = sheet(page).getByRole('dialog', { name: 'Paris' })
    await expect(card.getByText('Scenes set here (1)')).toBeVisible()
    await expect(card.getByRole('button', { name: /The Lantern Gate/ })).toContainText(
      'in The Louvre',
    )
    await expect(card.getByRole('button', { name: 'Open its map' })).toBeVisible()
    await shoot(page, `${shots}/map-card-${scheme}.png`)
    expect(await seriousViolations(page)).toEqual([])

    // The inner place's own map, and the link back up.
    await card.getByRole('button', { name: 'Open its map' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Paris' })).toBeVisible()
    await expect(sheet(page).getByRole('tab', { name: 'Map', selected: true })).toBeVisible()
    await expect(mapFrame(page, 'Paris').locator('img')).toBeVisible()
    await expect(
      sheet(page).getByRole('button', { name: 'Inside France — open its map' }),
    ).toBeVisible()
    expect(await seriousViolations(page)).toEqual([])
    await sheet(page).getByRole('button', { name: 'Inside France — open its map' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'France' })).toBeVisible()

    // A scene opens in Write.
    await mapFrame(page, 'France').getByRole('button', { name: 'Paris' }).click()
    await sheet(page)
      .getByRole('dialog', { name: 'Paris' })
      .getByRole('button', { name: /The Lantern Gate/ })
      .click()
    await expect(page.getByRole('textbox', { name: 'Scene text' })).toBeVisible()
  })
}

test('drag and keyboard move a pin, remove it, and it all works at phone width', async ({
  page,
}) => {
  await createBrowserWorkspace(page, 'My Writing')
  await page.getByRole('link', { name: 'World' }).click()
  await create(page, 'New world', 'France')
  await create(page, 'New place', 'Paris')
  await putInside(page, 'France')
  await page
    .getByRole('treeitem', { name: /France/ })
    .first()
    .click()
  await addMap(page, 'France', 'France')
  await sheet(page).getByRole('button', { name: 'Edit pins' }).click()
  // "Not on the map yet" has an Add for Paris.
  await sheet(page).getByRole('button', { name: 'Add Paris to the map' }).click()
  await sheet(page).getByRole('button', { name: 'Drop it in the middle' }).click()
  const frame = mapFrame(page, 'France')
  const pin = frame.getByRole('button', { name: 'Paris' })
  await expect(pin).toBeFocused()
  const at = async () => (await pin.boundingBox())!

  // Arrow keys move it; Shift moves it further; one write when they stop.
  const start = await at()
  await pin.press('ArrowRight')
  await pin.press('Shift+ArrowRight')
  await expect.poll(async () => (await at()).x).toBeGreaterThan(start.x + 10)
  await waitSaved(page)
  const record = (await opfs.list(page)).find((f) => /records\/worlds\/wld_\w+\.md$/.test(f))!
  await expect.poll(() => opfs.read(page, record)).toMatch(/x: 0\.5[5-9]/)

  // Drag it.
  const before = await at()
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  // Grabbed by its body, it does not jump on the first small move: it follows the pointer by that much.
  await page.mouse.move(before.x + before.width / 2 + 6, before.y + before.height / 2)
  await expect.poll(async () => Math.abs((await at()).x - before.x - 6)).toBeLessThan(3)
  await page.mouse.move(before.x + 80, before.y + 40, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await at()).x).toBeGreaterThan(before.x + 40)
  await waitSaved(page)

  // Zoom in: the pin keeps its size on screen.
  const size = (await at()).width
  await sheet(page).getByRole('button', { name: 'Zoom in' }).click()
  await sheet(page).getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(async () => Math.abs((await at()).width - size)).toBeLessThan(2)
  await sheet(page).getByRole('button', { name: 'Fit' }).click()

  // Phone width: nothing spills sideways, and the places are still reachable as a list.
  await page.setViewportSize({ width: 390, height: 844 })
  const phone = new URL(page.url())
  phone.searchParams.set('tab', 'map') // a link that asks for the Map tab
  await page.goto(phone.toString())
  await expect(mapFrame(page, 'France').locator('img')).toBeVisible()
  // The whole page, from a fresh load at phone width: nothing in the app's own bars spills sideways either.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(sheet(page).getByRole('heading', { name: 'Pinned places' })).toBeVisible()
  // The Map tab fits the screen (the app's own top bar is not this tab's to judge).
  const tooWide = () =>
    sheet(page)
      .getByRole('tabpanel')
      .evaluate((panel) =>
        [panel, ...panel.querySelectorAll('*')]
          .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
          .map((e) => `${e.tagName} ${e.className}`),
      )
  expect(await tooWide()).toEqual([])
  expect(await seriousViolations(page)).toEqual([])
  await sheet(page)
    .getByRole('region', { name: 'Pinned places' })
    .getByRole('button', { name: /^Paris/ })
    .click()
  await expect(sheet(page).getByRole('dialog', { name: 'Paris' })).toBeVisible()
  expect(await tooWide()).toEqual([]) // with its card open too
  await shoot(page, `${shots}/map-phone.png`)

  // Remove the pin (editing starts off again after the reload); the place is listed under "Not on the map yet:" again.
  await sheet(page).getByRole('button', { name: 'Edit pins' }).click()
  await sheet(page).getByRole('button', { name: 'Remove pin' }).click()
  await expect(pin).toHaveCount(0)
  await expect(sheet(page).getByText('Not on the map yet:')).toBeVisible()
  await expect(sheet(page).getByRole('button', { name: 'Done' })).toBeFocused() // no pin left to move to
})

for (const scheme of ['light', 'dark'] as const) {
  test(`a cluster of pins on a pale picture stays readable: names on or off, desktop and phone, in the ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page, 'My Writing')
    await page.getByRole('link', { name: 'World' }).click()
    await create(page, 'New world', 'France')
    const names = ['Paris', 'Lyon', 'Nice', 'Brest', 'Lille', 'Metz', 'Dijon', 'Rennes', 'Nantes']
    for (const name of names) await create(page, 'New place', name)
    await page
      .getByRole('treeitem', { name: /France/ })
      .first()
      .click()
    await addMap(page, 'France', 'France', true)
    await sheet(page).getByRole('button', { name: 'Edit pins' }).click()
    const frame = mapFrame(page, 'France')
    // Nine pins a few pixels apart, the last ones at the right edge: dropped by clicking near the earlier ones.
    for (const [i, name] of names.entries()) {
      await sheet(page).getByRole('button', { name: 'Add pin' }).click()
      await page
        .getByRole('dialog', { name: 'Add a pin' })
        .getByRole('button', { name: new RegExp(`^${name}`) })
        .click()
      await frame.click({ position: { x: 300 + (i % 3) * 22, y: 160 + Math.floor(i / 3) * 18 } })
      await expect(frame.getByRole('button', { name })).toBeVisible()
    }
    await expect(frame.locator('[data-pin]')).toHaveCount(9)
    await frame.getByRole('button', { name: 'Names' }).click() // off: a name shows for the pin in hand
    await expect(frame.locator('[data-pin] span').first()).toBeHidden()
    expect(await seriousViolations(page)).toEqual([]) // every pin still has its name
    await frame.getByRole('button', { name: 'Names' }).click()
    await sheet(page).getByRole('button', { name: 'Done' }).click()
    await waitSaved(page)
    await shoot(page, `${shots}/cluster-${scheme}.png`)
    expect(await seriousViolations(page)).toEqual([])

    // The same on a phone.
    await page.setViewportSize({ width: 390, height: 844 })
    const phone = new URL(page.url())
    phone.searchParams.set('tab', 'map')
    await page.goto(phone.toString())
    await expect(mapFrame(page, 'France').locator('[data-pin]')).toHaveCount(9)
    await shoot(page, `${shots}/cluster-phone-${scheme}.png`)
    expect(await seriousViolations(page)).toEqual([])
  })
}

test('pins at the edges stay whole, and tabbing to a pin that is out of sight scrolls nothing but the map', async ({
  page,
}) => {
  await createBrowserWorkspace(page, 'My Writing')
  await page.getByRole('link', { name: 'World' }).click()
  await create(page, 'New world', 'France')
  for (const name of ['Paris', 'Lyon', 'Nice']) await create(page, 'New place', name)
  await page
    .getByRole('treeitem', { name: /France/ })
    .first()
    .click()
  await addMap(page, 'France', 'France', true)
  await sheet(page).getByRole('button', { name: 'Edit pins' }).click()
  const frame = mapFrame(page, 'France')
  const start = (await frame.boundingBox())!
  const spots = {
    Paris: { x: 120, y: 3 },
    Lyon: { x: start.width - 20, y: 200 },
    Nice: { x: 20, y: 200 },
  }
  for (const [name, position] of Object.entries(spots)) {
    await sheet(page).getByRole('button', { name: 'Add pin' }).click()
    await page
      .getByRole('dialog', { name: 'Add a pin' })
      .getByRole('button', { name: new RegExp(`^${name}`) })
      .click()
    await frame.click({ position })
    await expect(frame.getByRole('button', { name })).toBeVisible()
  }
  // Near the top it points up, so it is not cut off; names at the right edge go to the left of the pin.
  const inside = async (name: string) => {
    const box = (await frame.boundingBox())!
    const pin = (await frame.getByRole('button', { name }).boundingBox())!
    const label = (await frame.getByRole('button', { name }).locator('span').boundingBox())!
    for (const b of [pin, label]) {
      expect(b.x).toBeGreaterThanOrEqual(box.x - 1)
      expect(b.y).toBeGreaterThanOrEqual(box.y - 1)
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1)
    }
  }
  for (const name of Object.keys(spots)) await inside(name)

  // Zoomed in, the edge pins are out of sight. Tab to one from the controls: the page and the pane do not scroll
  // (the frame clips and does not scroll), and the map pans so the pin can be seen.
  for (let i = 0; i < 4; i++) await sheet(page).getByRole('button', { name: 'Zoom in' }).click()
  const scrolls = () =>
    page.evaluate(() => {
      const out: number[] = [window.scrollX, window.scrollY]
      for (let e = document.querySelector('[role=group]'); e; e = e.parentElement)
        out.push(e.scrollLeft, e.scrollTop)
      return out
    })
  await sheet(page).getByRole('button', { name: 'Names' }).focus()
  const out = (await frame.getByRole('button', { name: 'Paris' }).boundingBox())!
  expect(out.x + out.width).toBeLessThan((await frame.boundingBox())!.x) // Paris is off to the left, out of sight
  const before = await scrolls()
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    if (await frame.locator('[data-pin]:focus').count()) break
  }
  await expect(frame.locator('[data-pin]:focus')).toHaveCount(1)
  expect(await scrolls()).toEqual(before)
  const box = (await frame.boundingBox())!
  const focused = (await frame.locator('[data-pin]:focus').boundingBox())!
  expect(focused.x).toBeGreaterThanOrEqual(box.x - 1)
  expect(focused.x + focused.width).toBeLessThanOrEqual(box.x + box.width + 1)
  expect(focused.y).toBeGreaterThanOrEqual(box.y - 1)

  // A chip of "Pinned places" opens its card and brings the pin into view, so the card points at something.
  const lyonBefore = (await frame.getByRole('button', { name: 'Lyon' }).boundingBox())!
  expect(lyonBefore.x).toBeGreaterThan(box.x + box.width) // Lyon is off to the right, out of sight
  await sheet(page)
    .getByRole('region', { name: 'Pinned places' })
    .getByRole('button', { name: 'Lyon' })
    .click()
  await expect(sheet(page).getByRole('dialog', { name: 'Lyon' })).toBeVisible()
  const lyon = (await frame.getByRole('button', { name: 'Lyon' }).boundingBox())!
  expect(lyon.x).toBeGreaterThanOrEqual(box.x - 1)
  expect(lyon.x + lyon.width).toBeLessThanOrEqual(box.x + box.width + 1)
})
