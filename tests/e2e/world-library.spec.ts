// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createBrowserWorkspace, opfs, sceneText, waitSaved } from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
const shots = 'test-results/m6a-screenshots'

async function serious(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

/** Before a picture: the install tip put away and every scrolled area back at its top, so the picture shows the screen, not where a test last looked. */
async function tidy(page: Page) {
  const tip = page.getByRole('button', { name: 'Not now' })
  if (await tip.isVisible()) await tip.click()
  await page.evaluate(() =>
    document.querySelectorAll('*').forEach((e) => e.scrollTop > 0 && (e.scrollTop = 0)),
  )
}

const sheet = (page: Page) => page.getByRole('region', { name: 'Record' })

async function create(page: Page, item: string, name: string) {
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: item }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name)
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).press('Enter')
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** A picture to import: drawn in the page, so it is a real PNG, with bytes a text decoder would refuse. */
async function png(page: Page, label: string): Promise<{ bytes: Buffer }> {
  const base64 = await page.evaluate(async (text) => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 500
    const ctx = canvas.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 400, 500)
    g.addColorStop(0, '#2f6690')
    g.addColorStop(1, '#c9a227')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 400, 500)
    ctx.fillStyle = '#fffdf9'
    ctx.font = '48px serif'
    ctx.fillText(text, 40, 260)
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s)
  }, label)
  return { bytes: Buffer.from(base64, 'base64') }
}

/** The bytes of a file in browser storage, read from the test side. */
const opfsBytes = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    let dir = await navigator.storage.getDirectory()
    const parts = ['workspaces', ...p.split('/')]
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
    const file = await (await dir.getFileHandle(parts.at(-1)!)).getFile()
    return Array.from(new Uint8Array(await file.arrayBuffer()))
  }, path)

/** Every file of the thumbnail cache, which sits beside `workspaces/`, never inside it. */
const thumbnailFiles = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = []
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`)
        else out.push(`${prefix}${name}`)
      }
    }
    const root = await navigator.storage.getDirectory()
    try {
      await walk(await root.getDirectoryHandle('thumbnails'), '')
    } catch {
      return []
    }
    return out
  })

for (const scheme of ['light', 'dark'] as const) {
  test(`a character with relationships on both sheets and a portrait, in the ${scheme} theme — and the image is kept exactly, outside the thumbnail cache`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page, 'My Writing')
    await page.getByRole('link', { name: 'World' }).click()
    await create(page, 'New character', 'Mirela Constantin')
    await create(page, 'New character', 'Elena Vasquez')

    // Identity, inner life and voice, in plain words.
    const s = sheet(page)
    await s
      .getByLabel('Summary', { exact: true })
      .fill('A smuggler’s daughter who came back owing everyone.')
    await s.getByLabel('Role in the story', { exact: true }).fill('Protagonist')
    await s
      .getByLabel('What they want', { exact: true })
      .fill('To pay the warden back before the spring tide.')
    await s.getByLabel('What they are afraid of', { exact: true }).fill('Deep water.')
    await s.getByLabel('What they are afraid of', { exact: true }).press('Tab')
    await s.getByRole('tab', { name: 'Voice' }).click()
    await s
      .getByLabel('How they speak', { exact: true })
      .fill('Short sentences. Never swears in front of the sea.')
    await s.getByLabel('How they speak', { exact: true }).press('Tab')
    await s.getByRole('tab', { name: 'Overview' }).click()

    // A portrait: a file chosen, kept exactly as it is.
    await s.getByRole('button', { name: 'Add portrait' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose portrait' })
    const picture = await png(page, 'Elena')
    await picker.getByLabel('Choose images to add').setInputFiles({
      name: 'Elena (portrait).PNG',
      mimeType: 'image/png',
      buffer: picture.bytes,
    })
    await expect(picker).toBeHidden()
    const portrait = s.getByRole('button', { name: 'Change portrait' }).locator('img')
    await expect(portrait).toBeVisible()
    // The page's policy lets a picture of the file be drawn, and it decoded (a broken image is also "complete").
    await expect
      .poll(() => portrait.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
    await waitSaved(page)

    const files = await opfs.list(page)
    const image = files.find((f) => /\/media\/med_\w+\.png$/.test(f))!
    expect(image).toBeTruthy() // the extension is the original's
    expect(files).toContain(image.replace(/\.png$/, '.json'))
    expect(await opfsBytes(page, image)).toEqual([...picture.bytes])
    // The thumbnail is a cache on this device: it is not a file of the project.
    await expect.poll(() => thumbnailFiles(page)).toHaveLength(1)
    expect((await opfs.list(page)).filter((f) => f.includes('thumb'))).toEqual([])
    expect(await opfs.read(page, image.replace(/\.png$/, '.json'))).toContain(
      '"name": "Elena (portrait).PNG"',
    )

    // A relationship, made from Elena's sheet…
    await s.getByRole('tab', { name: 'Relationships' }).click()
    await s.getByRole('combobox', { name: 'With' }).click()
    await page.getByRole('option', { name: /Mirela Constantin/ }).click()
    await s.getByLabel('What they are', { exact: true }).fill('mentor, estranged')
    await s.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(s.getByText('mentor, estranged')).toBeVisible()
    await waitSaved(page)

    // …is on Mirela's sheet too.
    await page.getByRole('button', { name: 'Mirela Constantin' }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Mirela Constantin' })).toBeVisible()
    await s.getByRole('tab', { name: 'Relationships' }).click()
    await expect(s.getByRole('button', { name: 'Elena Vasquez', exact: true })).toBeVisible()
    await expect(s.getByText('mentor, estranged')).toBeVisible()
    await expect(s.getByText('lists Mirela Constantin as “mentor, estranged”')).toBeVisible()

    // Back to Elena: her sheet and her portrait come back after a reload.
    await page.getByRole('button', { name: 'Elena Vasquez' }).first().click()
    await s.getByRole('tab', { name: 'Relationships' }).click()
    await s.getByRole('button', { name: 'Mirela Constantin', exact: true }).waitFor()
    await tidy(page)
    await page.screenshot({ path: `${shots}/character-relationships-${scheme}.png` })
    await s.getByRole('tab', { name: 'Overview' }).click()
    await tidy(page)
    await page.screenshot({ path: `${shots}/character-sheet-${scheme}.png` })
    expect(await serious(page)).toEqual([])

    await page.reload()
    await page.getByRole('link', { name: 'World' }).click()
    await page.getByRole('button', { name: 'Elena Vasquez' }).first().click()
    await expect(s.getByRole('button', { name: 'Change portrait' }).locator('img')).toBeVisible()
    await expect(s.getByLabel('What they want', { exact: true })).toHaveValue(
      'To pay the warden back before the spring tide.',
    )
    await s.getByRole('tab', { name: 'Relationships' }).click()
    await expect(s.getByText('mentor, estranged')).toBeVisible()

    // The gallery: the image, its caption and credit, and delete to the trash.
    await page.getByRole('button', { name: /^Media/ }).click()
    const gallery = page.getByRole('region', { name: 'Record' })
    await gallery.getByRole('button', { name: /Open Elena \(portrait\)/ }).click()
    await gallery.getByLabel('Caption').fill('Elena at the Lantern Gate')
    await gallery.getByLabel('Caption').press('Tab')
    await gallery.getByLabel('Credit').fill('Igor Moreira')
    await gallery.getByLabel('Credit').press('Tab')
    await waitSaved(page)
    await tidy(page)
    await page.screenshot({ path: `${shots}/gallery-${scheme}.png` })
    expect(await serious(page)).toEqual([])
    expect(await opfs.read(page, image.replace(/\.png$/, '.json'))).toContain(
      '"caption": "Elena at the Lantern Gate"',
    )
    await gallery.getByRole('button', { name: 'Delete image' }).click()
    const toast = page.getByRole('status').filter({ hasText: 'Moved “Elena at the Lantern Gate”' })
    await expect(toast).toBeVisible()
    expect(
      (await opfs.list(page)).filter((f) => /\/media\//.test(f) && !f.includes('.aurelia')),
    ).toEqual([])
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(gallery.getByRole('button', { name: /Elena at the Lantern Gate/ })).toBeVisible()
    await expect.poll(async () => opfsBytes(page, image)).toEqual([...picture.bytes])
  })
}

for (const scheme of ['light', 'dark'] as const) {
  test(`places in a hierarchy that starts from Earth: move by "Move to…", by the keyboard and by drag, in the ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page, 'My Writing')
    await page.getByRole('link', { name: 'World' }).click()

    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Start from Earth' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Earth' })).toBeVisible()
    // Earth is made once: the choice goes away.
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Start from Earth' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await expect(page.getByText('Drag onto a place to put it inside')).toBeVisible()
    await create(page, 'New place', 'France')
    await create(page, 'New place', 'Paris')
    await create(page, 'New place', 'The Louvre')
    const tree = page.getByRole('tree', { name: 'Worlds and places' })
    const item = (name: string) => tree.getByRole('treeitem', { name, exact: false }).first()
    const level = async (name: string) => Number(await item(name).getAttribute('aria-level'))

    // "Move to…": France inside Earth.
    const moveTo = async (name: string, where: string) => {
      await item(name).hover()
      await page.getByRole('button', { name: `Actions for ${name}` }).click()
      await page.getByRole('menuitem', { name: /^Move to…/ }).click()
      const dialog = page.getByRole('dialog', { name: 'Move to…' })
      await dialog.getByRole('combobox', { name: 'Inside' }).click()
      await page.getByRole('option', { name: where, exact: true }).click()
      await dialog.getByRole('button', { name: 'Move', exact: true }).click()
      await expect(dialog).toBeHidden()
    }
    await moveTo('France', 'Earth')
    await expect.poll(() => level('France')).toBe(2)

    // The keyboard: Alt+↓ puts Paris (at the top) inside the place above it, Alt+↑ takes it out.
    await item('Paris').focus()
    await item('Paris').press('Alt+ArrowDown')
    await expect.poll(() => level('Paris')).toBe(2)
    await item('Paris').focus()
    await item('Paris').press('Alt+ArrowDown') // France is above it now: Paris goes inside France
    await expect.poll(() => level('Paris')).toBe(3)
    await item('Paris').focus()
    await item('Paris').press('Alt+ArrowUp')
    await expect.poll(() => level('Paris')).toBe(2)
    await item('Paris').press('Alt+ArrowDown')
    await expect.poll(() => level('Paris')).toBe(3)

    // Drag: the Louvre onto Paris.
    await item('The Louvre').dragTo(item('Paris'))
    await expect.poll(() => level('The Louvre')).toBe(4)

    // Breadcrumbs: the Louvre's sheet says where it is, and each step opens.
    await item('The Louvre').click()
    const crumbs = page.getByRole('navigation', { name: 'Where this is' })
    await expect(crumbs.getByRole('button')).toHaveText(['Earth', 'France', 'Paris'])
    await tidy(page)
    await page.screenshot({ path: `${shots}/place-tree-${scheme}.png` })
    expect(await serious(page)).toEqual([])
    await crumbs.getByRole('button', { name: 'Paris' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Paris' })).toBeVisible()

    // Sensory details and the author's own level name.
    const s = sheet(page)
    await s.getByLabel('Kind of place', { exact: true }).fill('City')
    await s.getByLabel('Kind of place', { exact: true }).press('Tab')
    await s.getByRole('tab', { name: 'Senses' }).click()
    await s.getByLabel('What you smell', { exact: true }).fill('Bread and river mud.')
    await s.getByLabel('What you smell', { exact: true }).press('Tab')
    await waitSaved(page)

    await page.reload()
    await page.getByRole('link', { name: 'World' }).click()
    await expect.poll(() => level('The Louvre')).toBe(4)
    await expect(item('Paris')).toContainText('City')
  })
}

test('a research note with sources, and the other kinds of record', async ({ page }) => {
  await createBrowserWorkspace(page, 'My Writing')
  await page.getByRole('link', { name: 'World' }).click()
  await create(page, 'New research', 'Tidal ports')
  const s = sheet(page)
  await s.getByLabel('Topic', { exact: true }).fill('How harbours worked before engines')
  await s.getByLabel('Topic', { exact: true }).press('Tab')
  await s.getByRole('tab', { name: 'Sources' }).click()
  await s.getByRole('button', { name: 'Add a source' }).click()
  const source = s.getByRole('group', { name: 'Source 1' })
  await source.getByLabel('Title').fill('The Ledger of Tides')
  await source.getByLabel('Author').fill('Corvin Hale')
  await source.getByLabel('Web address').fill('https://example.org/ledger')
  await source.getByLabel('Note').fill('Chapter 4, the spring tide table')
  await source.getByLabel('Note').press('Tab')
  await waitSaved(page)
  await expect(s.getByRole('link', { name: /Open the page/ })).toHaveAttribute(
    'href',
    'https://example.org/ledger',
  )
  const files = await opfs.list(page)
  const file = files.find((f) => /\/records\/research\//.test(f))!
  const text = await opfs.read(page, file)
  expect(text).toContain('sources:')
  expect(text).toContain('Corvin Hale')

  // The other kinds are made from the same menu, each with its own basic fields.
  await create(page, 'New faction', 'The Salt Guild')
  await expect(sheet(page).getByLabel('Who leads it', { exact: true })).toBeVisible()
  await create(page, 'New culture', 'The Reed People')
  await expect(sheet(page).getByLabel('Customs', { exact: true })).toBeVisible()
  await create(page, 'New system', 'Tide-calling')
  await expect(sheet(page).getByLabel('How it works', { exact: true })).toBeVisible()
  await create(page, 'New item', 'The Lantern Key')
  await create(page, 'New event', 'The Spring Tide')
  await create(page, 'New lore', 'The Drowned Bell')

  await page.reload()
  await page.getByRole('link', { name: 'World' }).click()
  await page.getByRole('button', { name: 'Tidal ports' }).click()
  await sheet(page).getByRole('tab', { name: 'Sources' }).click()
  const kept = sheet(page).getByRole('group', { name: 'Source 1' })
  await expect(kept.getByLabel('Title')).toHaveValue('The Ledger of Tides')
  await expect(kept.getByLabel('Note')).toHaveValue('Chapter 4, the spring tide table')
})

for (const scheme of ['light', 'dark'] as const) {
  test(`find new names in the ${scheme} theme: a word that comes back is offered, made a character, and a not-a-name is remembered`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page, 'My Writing')
    await sceneText(page).fill(
      'They sailed to Greywater at dusk. The bells of Greywater rang, and Greywater slept.\n\nLater Wren Ashby ran, and Wren said nothing, and Wren left, and Wren wept. Ashby watched.',
    )
    await waitSaved(page)

    await page.getByRole('link', { name: 'World' }).click()
    await page.getByRole('button', { name: /^New names/ }).click()
    const panel = page.getByRole('region', { name: 'Record' })
    await expect(panel.getByRole('heading', { name: 'New names in this book' })).toBeVisible()
    await expect(panel.getByText('Greywater', { exact: true })).toBeVisible()
    await expect(panel.getByText('Wren', { exact: true })).toBeVisible()
    await tidy(page)
    await page.screenshot({ path: `${shots}/new-names-${scheme}.png` })
    expect(await serious(page)).toEqual([])

    // Create a character from a found name: it is a record now, and leaves the list.
    await panel.getByRole('button', { name: 'Create character Wren' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Made “Wren” a character' }),
    ).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Create character Wren' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Wren' }).first()).toBeVisible()

    // "Not a name" is remembered in the book, on this device and any other.
    await panel
      .getByRole('button', { name: 'Not a name: stop offering Greywater in this book' })
      .click()
    await expect(panel.getByRole('button', { name: 'Create place Greywater' })).toHaveCount(0)
    await expect(panel.getByText('No new names.')).toBeVisible()
    await waitSaved(page)
    const book = (await opfs.list(page)).find((f) => f.endsWith('/book.json'))!
    expect(await opfs.read(page, book)).toContain('"notNames"')
    // Not one word of the writing changed.
    const scene = (await opfs.list(page)).find((f) => /\/scenes\/scn_\w+\.md$/.test(f))!
    expect(await opfs.read(page, scene)).toContain(
      'The bells of Greywater rang, and Greywater slept.',
    )
    await page.reload()
    await page.getByRole('link', { name: 'World' }).click()
    await page.getByRole('button', { name: /^New names/ }).click()
    const again = page.getByRole('region', { name: 'Record' })
    await expect(again.getByText('No new names.')).toBeVisible()

    // The answer can be taken back later, not only from the toast.
    await again.getByText('Words you said are not names (1)').click()
    await again.getByRole('button', { name: 'Give back Greywater: offer it again' }).click()
    await expect(again.getByRole('button', { name: 'Create place Greywater' })).toBeVisible()
    await expect(again.getByText('Words you said are not names')).toHaveCount(0)
  })
}
