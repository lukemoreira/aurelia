// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  createBrowserWorkspace,
  firstScenePath,
  opfs,
  waitSaved,
} from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
const shots = 'test-results/m3a-screenshots'

const tree = (page: Page) => page.getByRole('tree', { name: 'Books' })
const row = (page: Page, label: string) =>
  tree(page).getByRole('treeitem', { name: label, exact: false }).first()
/** Titles of the rows under Books, in the order the screen shows them. */
const rows = (page: Page) =>
  tree(page)
    .getByRole('treeitem')
    .evaluateAll((els) =>
      els.map((e) => e.querySelector('span.truncate')?.textContent?.trim() ?? ''),
    )
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name })

async function serious(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

/** Open a row's actions menu and choose an item (the button shows on hover, focus and selection). */
async function rowAction(page: Page, label: string, item: string) {
  await row(page, label).hover()
  await page.getByRole('button', { name: `Actions for ${label}` }).click()
  // The name starts with the label (a shortcut hint follows it): "Delete" is not "Recently deleted…".
  const start = new RegExp(`^${item.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}`)
  await page.getByRole('menuitem', { name: start }).click()
}
async function rename(page: Page, label: string, to: string) {
  await rowAction(page, label, 'Rename…')
  const name = page.getByRole('dialog').getByLabel('Name', { exact: true })
  await name.fill(to)
  await name.press('Enter')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(row(page, to)).toBeVisible()
}
async function addFromPlus(page: Page, item: string) {
  await page.getByRole('button', { name: 'Add to the book' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

for (const scheme of ['light', 'dark'] as const) {
  test(`build a small book from nothing in the ${scheme} theme: chapters, scenes, reorder by drag and by keyboard, rename, delete, undo — and it all survives a reload`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page, 'My Writing')
    await expect(row(page, 'Untitled scene')).toBeVisible()

    // Scenes: rename the first, add two more.
    await rename(page, 'Untitled scene', 'Arrival')
    await addFromPlus(page, 'New scene in this chapter')
    await expect(row(page, 'Untitled scene 2')).toBeVisible()
    await rename(page, 'Untitled scene 2', 'Gate')
    await addFromPlus(page, 'New scene in this chapter')
    await rename(page, 'Untitled scene 3', 'Harbour')
    await expect
      .poll(() => rows(page))
      .toEqual(['My Writing', '1 · Chapter one', 'Arrival', 'Gate', 'Harbour'])
    await page.screenshot({ path: `${shots}/navigator-editing-${scheme}.png` })
    await page.screenshot({
      path: `${shots}/inspector-${scheme}.png`,
      clip: { x: 1120, y: 0, width: 320, height: 900 },
    })

    // Reorder by drag: Harbour before Arrival.
    await row(page, 'Harbour').dragTo(row(page, 'Arrival'), { targetPosition: { x: 40, y: 3 } })
    await expect
      .poll(() => rows(page))
      .toEqual(['My Writing', '1 · Chapter one', 'Harbour', 'Arrival', 'Gate'])

    // Reorder by keyboard: Alt+↑ on Gate.
    await row(page, 'Gate').click()
    await row(page, 'Gate').press('Alt+ArrowUp')
    await expect
      .poll(() => rows(page))
      .toEqual(['My Writing', '1 · Chapter one', 'Harbour', 'Gate', 'Arrival'])

    // A second chapter, renamed from the keyboard (F2), and a scene moved into it from the menu.
    await addFromPlus(page, 'New chapter')
    await expect(row(page, '2 · Chapter 2')).toBeVisible()
    await row(page, '2 · Chapter 2').focus()
    await row(page, '2 · Chapter 2').press('F2')
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('The Second')
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).press('Enter')
    await expect(row(page, '2 · The Second')).toBeVisible()
    await rowAction(page, 'Arrival', 'Move to chapter…')
    await expect(dialog(page, 'Move “Arrival”')).toBeVisible()
    await page.screenshot({ path: `${shots}/move-to-chapter-${scheme}.png` })
    await dialog(page, 'Move “Arrival”').getByRole('button', { name: 'Move' }).click()
    await expect(dialog(page, 'Move “Arrival”')).toBeHidden()
    await expect
      .poll(() => rows(page))
      .toEqual([
        'My Writing',
        '1 · Chapter one',
        'Harbour',
        'Gate',
        '2 · The Second',
        'Untitled scene',
        'Arrival',
      ])

    // Delete is a move to the trash, with Undo.
    await rowAction(page, 'Gate', 'Delete')
    const toast = page.getByRole('status').filter({ hasText: 'Moved “Gate” to Recently deleted.' })
    await expect(toast).toBeVisible()
    await expect(row(page, 'Gate')).toHaveCount(0)
    expect((await opfs.list(page)).some((p) => p.includes('.aurelia/trash/'))).toBe(true)
    await page.screenshot({ path: `${shots}/deleted-toast-${scheme}.png` })
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(row(page, 'Gate')).toBeVisible()
    await expect(toast).toBeHidden()

    // …and the same from the Recently deleted list.
    await rowAction(page, 'Harbour', 'Delete')
    await page.getByRole('button', { name: 'Add to the book' }).click()
    await page.getByRole('menuitem', { name: 'Recently deleted…' }).click()
    await expect(dialog(page, 'Recently deleted')).toContainText('Harbour')
    await page.screenshot({ path: `${shots}/recently-deleted-${scheme}.png` })
    await dialog(page, 'Recently deleted').getByRole('button', { name: 'Put back Harbour' }).click()
    await expect(dialog(page, 'Recently deleted')).toContainText('Nothing has been deleted.')
    await page.keyboard.press('Escape')
    await expect(row(page, 'Harbour')).toBeVisible()
    expect(await serious(page)).toEqual([])

    // Everything is on disk and survives a reload.
    await waitSaved(page)
    const expected = [
      'My Writing',
      '1 · Chapter one',
      'Harbour',
      'Gate',
      '2 · The Second',
      'Untitled scene',
      'Arrival',
    ]
    await expect.poll(() => rows(page)).toEqual(expected)
    await page.reload()
    await expect.poll(() => rows(page)).toEqual(expected)
    const files = await opfs.list(page)
    const outline = files.find((f) => f.endsWith('/OUTLINE.md'))!
    expect(await opfs.read(page, outline)).toContain('### 2. The Second')
    const book = JSON.parse(
      await opfs.read(
        page,
        files.find((f) => f.endsWith('/book.json'))!,
      ),
    )
    expect(book.outline.map((c: { scenes: string[] }) => c.scenes.length)).toEqual([2, 2])
  })
}

test('the inspector sets title, status, summary and point of view, and it survives a reload', async ({
  page,
}) => {
  await createBrowserWorkspace(page, 'My Writing')
  // A character to pick as the point of view.
  await page.getByRole('link', { name: 'World' }).click()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New character' }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Elena Vasquez')
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Elena Vasquez' })).toBeVisible()
  await page.getByRole('link', { name: 'Write' }).click()

  const inspector = page.getByRole('complementary', { name: 'Scene inspector' })
  await inspector.getByLabel('Title', { exact: true }).fill('The Lantern Gate')
  await inspector.getByLabel('Title', { exact: true }).press('Tab')
  await expect(row(page, 'The Lantern Gate')).toBeVisible()
  await inspector.getByRole('combobox', { name: 'Status' }).click()
  await page.getByRole('option', { name: 'Draft' }).click()
  await inspector.getByRole('combobox', { name: 'Point of view' }).click()
  await page.getByRole('option', { name: 'Elena Vasquez' }).click()
  await inspector.getByLabel('Summary', { exact: true }).fill('She gets through the gate.')
  await inspector.getByLabel('Summary', { exact: true }).press('Tab')
  await waitSaved(page)

  await inspector.getByRole('tab', { name: 'Chapter' }).click()
  await inspector.getByLabel('Title', { exact: true }).fill('Chapter the First')
  await inspector.getByLabel('Title', { exact: true }).press('Tab')
  await expect(row(page, '1 · Chapter the First')).toBeVisible()
  await inspector.getByRole('tab', { name: 'Book' }).click()
  await inspector.getByLabel('Summary', { exact: true }).fill('A smuggler’s daughter.')
  await inspector.getByLabel('Summary', { exact: true }).press('Tab')
  await waitSaved(page)

  await page.reload()
  await expect(inspector.getByRole('tab', { name: 'Scene' })).toBeVisible()
  await expect(inspector.getByLabel('Title', { exact: true })).toHaveValue('The Lantern Gate')
  await expect(inspector.getByRole('combobox', { name: 'Status' })).toContainText('Draft')
  await expect(inspector.getByRole('combobox', { name: 'Point of view' })).toContainText(
    'Elena Vasquez',
  )
  await expect(inspector.getByLabel('Summary', { exact: true })).toHaveValue(
    'She gets through the gate.',
  )
  await inspector.getByRole('tab', { name: 'Book' }).click()
  await expect(inspector.getByLabel('Summary', { exact: true })).toHaveValue(
    'A smuggler’s daughter.',
  )
  const files = await opfs.list(page)
  const scene = await opfs.read(
    page,
    files.find((f) => /\/scenes\/scn_\w+\.md$/.test(f))!,
  )
  expect(scene).toMatch(/title: "The Lantern Gate"[\s\S]*status: "draft"[\s\S]*pov: "chr_\w+"/)
})

for (const scheme of ['light', 'dark'] as const) {
  test(`characters and places in the ${scheme} theme: create, name, find, rename, delete and bring back — and a character is picked as POV`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page, 'My Writing')
    await page.getByRole('link', { name: 'World' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'World' })).toBeVisible()
    await expect(page.getByText('No characters or places yet.')).toBeVisible()

    const create = async (item: string, name: string) => {
      await page.getByRole('button', { name: 'New', exact: true }).click()
      await page.getByRole('menuitem', { name: item }).click()
      await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name)
      await page.getByRole('dialog').getByLabel('Name', { exact: true }).press('Enter')
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    }
    await create('New character', 'Elena Vasquez')
    const sheet = page.getByRole('region', { name: 'Record' })
    await sheet.getByLabel('Summary', { exact: true }).fill('A smuggler’s daughter.')
    await sheet.getByLabel('Summary', { exact: true }).press('Tab')
    await sheet.getByLabel('Role in the story', { exact: true }).fill('Protagonist')
    await sheet.getByLabel('Role in the story', { exact: true }).press('Tab')
    await sheet.getByRole('button', { name: 'Add a name' }).click()
    await sheet.getByLabel('Other name 1', { exact: true }).fill('Elena')
    await sheet.getByLabel('Other name 1', { exact: true }).press('Tab')
    await sheet.getByRole('button', { name: 'Add a name' }).click()
    await sheet.getByLabel('Other name 2', { exact: true }).fill('Vasquez')
    await sheet.getByRole('combobox', { name: 'Tagging for other name 2' }).click()
    await page.getByRole('option', { name: 'Ask me first' }).click()
    await sheet.getByLabel('Notes', { exact: true }).fill('Owes everyone.')
    await sheet.getByLabel('Notes', { exact: true }).blur()
    await waitSaved(page)
    await page.screenshot({ path: `${shots}/record-sheet-${scheme}.png` })

    await create('New place', 'The Lantern Gate')
    await expect(page.getByRole('heading', { level: 2, name: /Characters/ })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /Worlds & places/ })).toBeVisible()
    await page.screenshot({ path: `${shots}/world-list-${scheme}.png` })
    expect(await serious(page)).toEqual([])

    // Find by name.
    await page.getByLabel('Find a record by name').fill('lantern')
    await expect(page.getByRole('button', { name: 'The Lantern Gate' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Elena Vasquez' })).toHaveCount(0)
    await page.getByLabel('Find a record by name').fill('zzz')
    await expect(page.getByText('Nothing is called “zzz”.')).toBeVisible()
    await page.getByLabel('Find a record by name').fill('')

    // Rename, then delete and bring back.
    await sheet.getByRole('button', { name: 'Rename…' }).click()
    const name = page.getByRole('dialog').getByLabel('Name', { exact: true })
    await name.fill('The Old Gate')
    await name.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: 'The Old Gate' })).toBeVisible()
    await sheet.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const toast = page.getByRole('status').filter({ hasText: 'Moved “The Old Gate”' })
    await expect(toast).toBeVisible()
    await expect(page.getByRole('button', { name: 'The Old Gate' })).toHaveCount(0)
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('button', { name: 'The Old Gate' })).toBeVisible()

    // Pick the character as the point of view of the scene, then reload: everything persists.
    await page.getByRole('link', { name: 'Write' }).click()
    const inspector = page.getByRole('complementary', { name: 'Scene inspector' })
    await inspector.getByRole('combobox', { name: 'Point of view' }).click()
    await page.getByRole('option', { name: 'Elena Vasquez' }).click()
    await waitSaved(page)
    await page.reload()
    await expect(inspector.getByRole('combobox', { name: 'Point of view' })).toContainText(
      'Elena Vasquez',
    )
    await page.getByRole('link', { name: 'World' }).click()
    await page.getByRole('button', { name: 'Elena Vasquez' }).click()
    await expect(sheet.getByLabel('Summary', { exact: true })).toHaveValue('A smuggler’s daughter.')
    await expect(sheet.getByLabel('Role in the story', { exact: true })).toHaveValue('Protagonist')
    await expect(sheet.getByLabel('Other name 1', { exact: true })).toHaveValue('Elena')
    await expect(sheet.getByLabel('Other name 2', { exact: true })).toHaveValue('Vasquez')
    await expect(sheet.getByRole('combobox', { name: 'Tagging for other name 2' })).toContainText(
      'Ask me first',
    )
    await expect(sheet.getByLabel('Notes', { exact: true })).toHaveValue('Owes everyone.')
    const files = await opfs.list(page)
    expect(files.filter((f) => /\/records\/(characters|places)\//.test(f))).toHaveLength(2)
  })
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('on a phone the navigator and the World view still work: 44 px targets, no sideways scroll', async ({
    page,
  }) => {
    await createBrowserWorkspace(page, 'My Writing')
    await page
      .getByRole('button', { name: /navigator/i })
      .first()
      .click()
    const nav = page.getByRole('dialog', { name: 'Navigator' })
    await expect(nav).toBeVisible()
    await nav.getByRole('button', { name: 'Add to the book' }).click()
    await expect(page.getByRole('menuitem', { name: 'New chapter' })).toBeVisible()
    const box = await nav.getByRole('button', { name: 'Add to the book' }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await page.getByRole('menuitem', { name: 'New chapter' }).click()
    await expect(nav).toBeHidden() // the route changed to the new chapter's scene
    await page.screenshot({ path: `${shots}/phone-after-new-chapter.png` })

    await page.goto(page.url().replace(/\/w\/(bok_\w+)\/.*/, '/w/$1/world'))
    await expect(page.getByRole('heading', { level: 1, name: 'World' })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    expect(await serious(page)).toEqual([])
    await page.screenshot({ path: `${shots}/phone-world.png` })
  })
})

test('two files with one ID are shown to the author, who keeps one; the other goes to .aurelia/conflicts', async ({
  page,
}) => {
  await createBrowserWorkspace(page, 'My Writing')
  const path = await firstScenePath(page)
  const text = await opfs.read(page, path)
  const twin = path.replace(/scn_\w+\.md$/, 'scn_zzzzzzzzzz.md')
  await opfs.write(page, twin, `${text}A twin written by a sync tool.\n`)
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))) // the window is focused again
  const banner = page.locator('[aria-live="polite"] > *').filter({ hasText: 'has two files' })
  await expect(banner).toBeVisible()
  await page.screenshot({ path: `${shots}/duplicate-id-banner.png` })
  await banner.getByRole('button', { name: 'Choose' }).click()
  const files = page.getByRole('dialog', { name: 'Files to look at' })
  await expect(files).toContainText('Two files with one ID')
  await page.screenshot({ path: `${shots}/duplicate-id-dialog.png` })
  expect(await serious(page)).toEqual([])
  await files
    .getByRole('button', { name: /Keep this one/ })
    .nth(1)
    .click()
  await expect(banner).toBeHidden()
  expect(await opfs.list(page)).toEqual(
    expect.arrayContaining([expect.stringMatching(/\.aurelia\/conflicts\/.+scn_\w+\.md$/)]),
  )
  expect(await opfs.read(page, twin)).toContain('A twin written by a sync tool.')
  const conflicts = (await opfs.list(page)).filter((f) => f.includes('.aurelia/conflicts/'))
  expect(await opfs.read(page, conflicts[0]!)).toBe(text) // the one not kept, whole
})

test('the keyboard does it all: Backspace deletes and lands on Undo, Ctrl+Z undoes, Esc dismisses; moves are announced', async ({
  page,
}) => {
  await createBrowserWorkspace(page, 'My Writing')
  await addFromPlus(page, 'New scene in this chapter')
  await expect(row(page, 'Untitled scene 2')).toBeVisible()
  const said = page.locator('p[role="status"].sr-only')

  // A move by key is said aloud: nothing else tells a screen reader where the row went.
  await row(page, 'Untitled scene 2').press('Alt+ArrowUp')
  await expect(said).toHaveText('Moved “Untitled scene 2” before “Untitled scene”.')
  await expect
    .poll(() => rows(page))
    .toEqual(['My Writing', '1 · Chapter one', 'Untitled scene 2', 'Untitled scene'])

  // Backspace (a Mac's delete key) deletes; focus goes to Undo, since the row that had it is gone.
  await row(page, 'Untitled scene 2').press('Backspace')
  const toast = page
    .getByRole('status')
    .filter({ hasText: 'Moved “Untitled scene 2” to Recently deleted.' })
  await expect(toast).toBeVisible()
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeFocused()
  // The toast sits above the status bar, not over it.
  const toastBox = (await toast.boundingBox())!
  const barBox = (await page.getByRole('contentinfo').boundingBox())!
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(barBox.y)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(row(page, 'Untitled scene 2')).toBeVisible()
  await expect(toast).toBeHidden()

  // Esc dismisses the toast.
  await row(page, 'Untitled scene 2').press('Delete')
  await expect(toast).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(toast).toBeHidden()
  // …and it is still in Recently deleted, from the navigator's own link and from its row menu.
  await page.getByRole('button', { name: 'Recently deleted' }).click()
  await expect(dialog(page, 'Recently deleted')).toContainText('Untitled scene 2')
  await expect(dialog(page, 'Recently deleted')).toContainText('Scene')
  await expect(dialog(page, 'Recently deleted')).not.toContainText(/file/i)
  await page.keyboard.press('Escape')
  await rowAction(page, 'Untitled scene', 'Recently deleted…')
  await expect(dialog(page, 'Recently deleted')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('the last book stays, and says why; the inspector and breadcrumb follow the view; targets are 32 px', async ({
  page,
}) => {
  await createBrowserWorkspace(page, 'My Writing')
  await rowAction(page, 'My Writing', 'Delete')
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'A workspace keeps at least one book. Add another first.' }),
  ).toBeVisible()
  await expect(row(page, '1 · Chapter one')).toBeVisible()

  // A mouse target is 32 px: the "+", a row's menu, and the row itself.
  const add = (await page.getByRole('button', { name: 'Add to the book' }).boundingBox())!
  expect([add.width, add.height]).toEqual([32, 32])
  await row(page, 'Untitled scene').hover()
  const menu = (await page
    .getByRole('button', { name: 'Actions for Untitled scene' })
    .boundingBox())!
  expect([menu.width, menu.height]).toEqual([32, 32])
  expect((await row(page, 'Untitled scene').boundingBox())!.height).toBe(32)
  await expect(page.getByText('Drag to reorder, or use the row menu.')).toBeVisible()

  // World: no empty inspector, and the breadcrumb ends on the open record.
  await page.getByRole('link', { name: 'World' }).click()
  await expect(page.getByRole('complementary', { name: 'Scene inspector' })).toHaveCount(0)
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('listitem')
  await expect(crumbs).toHaveText(['My Writing', 'World'])
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New character' }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Elena Vasquez')
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).press('Enter')
  await expect(crumbs).toHaveText(['My Writing', 'World', 'Elena Vasquez'])
  // A standalone book has nothing to share with: no "Shared" anywhere, and no scope switch.
  await expect(page.getByText(/Shared/)).toHaveCount(0)
  await expect(page.getByText('In this book')).toBeVisible()
  await page.getByRole('link', { name: 'Plan' }).click()
  await expect(crumbs).toHaveText(['My Writing', 'Plan'])
})
