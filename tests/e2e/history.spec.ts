// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  createBrowserWorkspace,
  opfs,
  sceneText,
  seriousViolations,
  waitSaved,
} from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
test.setTimeout(60_000)
const shots = 'test-results/m7a-screenshots'

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Scene inspector' })
const tab = (page: Page, name: string) => inspector(page).getByRole('tab', { name })
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name })

/** Serious problems inside the open dialog, once it has finished fading in. */
async function dialogViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  )
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

async function takeSnapshot(page: Page, name: string) {
  await page.getByLabel('Name (optional)').fill(name)
  await page.getByRole('button', { name: 'Take snapshot' }).click()
  await expect(page.getByRole('list', { name: /Snapshots of this/ })).toContainText(name)
  // the button was disabled while it worked: focus must not fall to the page
  await expect(page.getByLabel('Name (optional)')).toBeFocused()
}

for (const scheme of ['light', 'dark'] as const) {
  test(`a scene: take a snapshot, edit, compare, restore, reload — in the ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page)
    await sceneText(page).fill('The bells had already started.')
    await waitSaved(page)

    await expect(inspector(page)).toContainText('No snapshots of this scene yet.')
    await takeSnapshot(page, 'First draft')
    await expect(page.getByRole('status').filter({ hasText: 'saved' })).toBeVisible()
    // the snapshot is a plain, readable file in the folder, byte for byte the scene
    const files = await opfs.list(page)
    expect(files.some((f) => /\.aurelia\/snapshots\/snp_\w+\/snapshot\.json$/.test(f))).toBe(true)
    const copy = files.find((f) => f.includes('/snapshots/') && f.endsWith('.md'))!
    const [home, rest] = copy.split('/.aurelia/snapshots/')
    const original = `${home}/${rest!.split('/files/')[1]}`
    expect(await opfs.read(page, copy)).toBe(await opfs.read(page, original))

    await sceneText(page).fill('The bells started. Elena ran to the gate.')
    await waitSaved(page)

    // compare with the text now: removed and added words are marked in words, not colour alone
    await inspector(page).getByRole('button', { name: 'Compare' }).click()
    const compare = dialog(page, 'Compare')
    await expect(compare.locator('ins')).toContainText('Elena ran to the gate.')
    await expect(compare.locator('del')).toContainText('had already')
    await expect(compare.locator('del .sr-only').first()).toHaveText('[Removed: ')
    await expect(compare).toContainText('words added')
    expect(await dialogViolations(page)).toEqual([])
    await page.screenshot({ path: `${shots}/compare-${scheme}.png` })
    await page.keyboard.press('Escape')

    // restore: asks first, then the words come back, and what was there is kept as "Before restore"
    await inspector(page).getByRole('button', { name: 'Restore' }).click()
    const confirm = dialog(page, 'Restore this scene?')
    await expect(confirm).toContainText('Before restore')
    expect(await dialogViolations(page)).toEqual([])
    await page.screenshot({ path: `${shots}/restore-${scheme}.png` })
    await confirm.getByRole('button', { name: 'Restore' }).click()
    await expect(sceneText(page)).toHaveText('The bells had already started.')
    const list = page.getByRole('list', { name: 'Snapshots of this scene' })
    await expect(list).toContainText('Before restore')
    await expect(list).toContainText('First draft')
    expect(await seriousViolations(page)).toEqual([])
    await page.screenshot({ path: `${shots}/history-${scheme}.png` })

    // the words that were replaced are in the "Before restore" snapshot: compare them with the text now
    await list
      .getByRole('listitem')
      .filter({ hasText: 'Before restore' })
      .getByRole('button', { name: 'Compare' })
      .click()
    await expect(dialog(page, 'Compare').locator('del')).toContainText('Elena ran to the gate.')
    await page.keyboard.press('Escape')

    await waitSaved(page)
    await page.reload()
    await expect(sceneText(page)).toHaveText('The bells had already started.')
    await expect(page.getByRole('list', { name: 'Snapshots of this scene' })).toContainText(
      'First draft',
    )
  })
}

test('a book: snapshot, change, add a scene, restore — the new scene stays and the result says so', async ({
  page,
}) => {
  await createBrowserWorkspace(page)
  await sceneText(page).fill('Scene one, as it was.')
  await waitSaved(page)
  await tab(page, 'Book').click()
  await takeSnapshot(page, 'Whole book v1')
  await expect(inspector(page).getByRole('list', { name: 'Snapshots of this book' })).toContainText(
    'The whole book · 1 scene',
  )

  await sceneText(page).fill('Scene one, rewritten.')
  await waitSaved(page)
  await page.getByRole('button', { name: 'New scene in this chapter' }).click()
  await expect(sceneText(page)).toHaveText('') // the new scene is open
  await sceneText(page).fill('A scene written after the snapshot.')
  await waitSaved(page)

  await tab(page, 'Book').click()
  await inspector(page).getByRole('button', { name: 'Compare' }).click()
  const compare = dialog(page, 'Compare')
  await expect(compare.getByRole('list', { name: 'Scenes that differ' })).toContainText(
    'Only in the text now',
  )
  await compare.getByRole('button', { name: /Untitled scene Changed/ }).click()
  await expect(compare.locator('ins')).toContainText('rewritten')
  await page.keyboard.press('Escape')

  await inspector(page).getByRole('button', { name: 'Restore' }).click()
  await expect(dialog(page, 'Restore this book?')).toContainText('Scenes you wrote since stay')
  await dialog(page, 'Restore this book?').getByRole('button', { name: 'Restore' }).click()
  await expect(inspector(page).getByRole('status')).toContainText('Put back the words of 1 scene.')
  await expect(inspector(page).getByRole('status')).toContainText('stays as it is')
  await expect(inspector(page).getByRole('status')).toContainText('Before restore')
  // the scene written since was not deleted and not changed
  await expect(sceneText(page)).toHaveText('A scene written after the snapshot.')
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByText('Untitled scene', { exact: true })
    .first()
    .click()
  await expect(sceneText(page)).toHaveText('Scene one, as it was.')
  await waitSaved(page)
  await page.reload()
  await expect(sceneText(page)).toHaveText('Scene one, as it was.')
})

test('the command palette takes a snapshot of the scene or the book', async ({ page }) => {
  await createBrowserWorkspace(page)
  await sceneText(page).fill('Words for the palette.')
  await waitSaved(page)
  for (const what of ['scene', 'book']) {
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByPlaceholder('Search or run a command…').fill(`Take snapshot of this ${what}`)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: 'saved' })).toBeVisible()
  }
  await expect(
    page.getByRole('list', { name: 'Snapshots of this scene' }).getByRole('listitem'),
  ).toHaveCount(2) // its own, and the book's that holds it
  await tab(page, 'Book').click()
  await expect(
    page.getByRole('list', { name: 'Snapshots of this book' }).getByRole('listitem'),
  ).toHaveCount(1)
})

test('on a phone the History tab fits, and passes axe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createBrowserWorkspace(page)
  await sceneText(page).fill('A few words on a small screen.')
  await waitSaved(page)
  await page.getByRole('button', { name: 'Scene details' }).click()
  await takeSnapshot(page, 'On my phone')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  expect(await seriousViolations(page)).toEqual([])
  await page.screenshot({ path: `${shots}/history-phone.png` })
})
