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
const deleteButtons = (page: Page) =>
  page.getByRole('button', { name: /^Delete Duplicate, opened / })
const message = (page: Page) => page.locator('#welcome-message')
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
  // Two rows of one name must be told apart by when they were opened: make the first one yesterday morning.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('aurelia-device')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const store = open.result.transaction('recent', 'readwrite').objectStore('recent')
          store.getAll().onsuccess = (e) => {
            const rows = (e.target as IDBRequest<{ lastOpened: number }[]>).result
            const oldest = rows.reduce((a, b) => (a.lastOpened < b.lastOpened ? a : b))
            const d = new Date()
            oldest.lastOpened = new Date(
              d.getFullYear(),
              d.getMonth(),
              d.getDate() - 1,
              9,
              10,
            ).getTime()
            store.put(oldest).onsuccess = () => resolve()
          }
        }
      }),
  )
  await page.goto('/')
  await expect(deleteButtons(page)).toHaveCount(2)
}
const yesterdayOne = (page: Page) =>
  page.getByRole('button', { name: 'Delete Duplicate, opened yesterday at 9:10 AM…' })

test.describe('delete a workspace', () => {
  test('one of two duplicates is deleted from the Welcome screen; the other still opens with its text', async ({
    page,
  }) => {
    await twoDuplicates(page)
    expect((await workspaceDirs(page)).size).toBe(2)

    // The row is picked by the time in its name, not by its place in the list.
    await yesterdayOne(page).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page)).toContainText('1 book · 7 words · last opened yesterday at 9:10 AM')
    await expect(dialog(page)).toContainText('It cannot be undone.')
    await expect(dialog(page)).toHaveAccessibleDescription(/cannot be undone/)
    await expect(dialog(page).getByRole('button', { name: 'Download a copy first' })).toBeVisible()
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
    expect(await seriousViolations(page)).toEqual([])
    await page.screenshot({ path: `${shots}/confirm-desktop.png` })

    // Cancel changes nothing and gives focus back to the button that opened the dialog.
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(yesterdayOne(page)).toBeFocused()
    expect((await workspaceDirs(page)).size).toBe(2)

    await yesterdayOne(page).click()
    await dialog(page).getByRole('button', { name: 'Delete workspace' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(message(page)).toHaveText('Deleted Duplicate.')
    await expect(message(page)).toBeFocused()
    await expect(deleteButtons(page)).toHaveCount(1)
    await expect(yesterdayOne(page)).toHaveCount(0)
    expect((await workspaceDirs(page)).size).toBe(1)
    expect(await seriousViolations(page)).toEqual([])

    // It stays deleted after a reload, and the one left still opens with its words.
    await page.reload()
    await expect(deleteButtons(page)).toHaveCount(1)
    await page
      .getByRole('button', { name: /^Duplicate/ })
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
      await expect(page.getByRole('button', { name: /^Duplicate/ }).first()).toBeVisible()
    })
  }

  test('deleting the only workspace leaves an empty Welcome screen with focus on the page', async ({
    page,
  }) => {
    await createBrowserWorkspace(page, 'Duplicate')
    await page.goto('/')
    await deleteButtons(page).click()
    await dialog(page).getByRole('button', { name: 'Delete workspace' }).click()
    await expect(message(page)).toHaveText('Deleted Duplicate.')
    await expect(page.getByRole('heading', { name: 'Recent' })).toHaveCount(0)
    await expect(message(page)).toBeFocused()
  })
})
