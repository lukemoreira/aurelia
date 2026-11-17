// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test'
import {
  createBrowserWorkspace,
  opfs,
  sceneText,
  seriousViolations,
  waitSaved,
} from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
const shots = 'test-results/delete-workspace-screenshots'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Delete “Duplicate”?' })
const deleteButtons = (page: Page) => page.getByRole('button', { name: 'Delete Duplicate…' })
const workspaceDirs = (page: Page) =>
  opfs.list(page).then((files) => new Set(files.map((f) => f.split('/')[0])))

/** Two browser workspaces with one name, each with its own words; the Welcome screen open. */
async function twoDuplicates(page: Page) {
  await createBrowserWorkspace(page, 'Duplicate')
  await sceneText(page).fill('The first one, which will be deleted.')
  await waitSaved(page)
  await createBrowserWorkspace(page, 'Duplicate') // reloads the page: a new workspace, a new session
  await sceneText(page).fill('The second one, which must survive.')
  await waitSaved(page)
  await page.goto('/')
  await expect(deleteButtons(page)).toHaveCount(2)
}

test.describe('delete a workspace', () => {
  test('one of two duplicates is deleted from the Welcome screen; the other still opens with its text', async ({
    page,
  }) => {
    await twoDuplicates(page)
    expect((await workspaceDirs(page)).size).toBe(2)

    // The list is newest first: the second row is the first workspace made.
    await deleteButtons(page).nth(1).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page)).toContainText('1 book · 7 words · last opened today')
    await expect(dialog(page)).toContainText('cannot be undone')
    await expect(dialog(page).getByRole('button', { name: 'Download a copy first' })).toBeVisible()
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
    expect(await seriousViolations(page)).toEqual([])
    await page.screenshot({ path: `${shots}/confirm-desktop.png` })

    // Cancel changes nothing and gives focus back to the button that opened the dialog.
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(deleteButtons(page).nth(1)).toBeFocused()
    expect((await workspaceDirs(page)).size).toBe(2)

    await deleteButtons(page).nth(1).click()
    await dialog(page).getByRole('button', { name: 'Delete workspace' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'Deleted Duplicate.' })).toBeVisible()
    await expect(deleteButtons(page)).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Recent' })).toBeFocused()
    expect((await workspaceDirs(page)).size).toBe(1)
    expect(await seriousViolations(page)).toEqual([])

    // It stays deleted after a reload, and the one left still opens with its words.
    await page.reload()
    await expect(deleteButtons(page)).toHaveCount(1)
    await page
      .getByRole('button', { name: /Duplicate/ })
      .first()
      .click()
    await expect(sceneText(page)).toContainText('The second one, which must survive.')
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`the confirm dialog fits a phone in the ${scheme} theme and passes the accessibility check`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 390, height: 844 })
      await createBrowserWorkspace(page, 'Duplicate')
      await page.goto('/')
      await expect(deleteButtons(page)).toHaveCount(1)
      const box = await deleteButtons(page).boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(390)
      await deleteButtons(page).click()
      await expect(dialog(page)).toBeVisible()
      // The phone layout can cancel an animation (the dialog's Reading… state): settle, do not throw.
      await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)))
      expect(await seriousViolations(page)).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      )
      await page.screenshot({ path: `${shots}/confirm-phone-${scheme}.png` })
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toBeHidden()
      await expect(page.getByRole('button', { name: /Duplicate/ }).first()).toBeVisible()
    })
  }

  test('deleting the only workspace leaves an empty Welcome screen with focus on the page', async ({
    page,
  }) => {
    await createBrowserWorkspace(page, 'Duplicate')
    await page.goto('/')
    await deleteButtons(page).click()
    await dialog(page).getByRole('button', { name: 'Delete workspace' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Deleted Duplicate.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeFocused()
  })
})
