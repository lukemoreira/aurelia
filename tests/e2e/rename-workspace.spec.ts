// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { FakeDav } from '../helpers/fake-dav'
import { serveDav } from '../helpers/serve-dav'
import {
  createBrowserWorkspace,
  openBackupScreen,
  opfs,
  sceneText,
  statusBar,
  waitSaved,
} from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
const shots = 'test-results/rename-screenshots'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Rename workspace' })
const topBar = (page: Page) => page.getByRole('banner')
/** Open the dialog from the workspace menu in the top bar. */
async function renameFromMenu(page: Page, current: string) {
  await topBar(page).getByRole('button', { name: current, exact: true }).click()
  await page.getByRole('button', { name: 'Rename workspace…' }).click()
  await expect(dialog(page)).toBeVisible()
}
async function dialogViolations(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

test.describe('rename a workspace', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`from the workspace menu in the ${scheme} theme: prefilled and selected, Enter saves, and it is the new name after a reload and in recents`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await createBrowserWorkspace(page, 'My Writing')
      const before = await opfs.read(
        page,
        (await opfs.list(page)).find((f) => f.endsWith('/aurelia.json'))!,
      )
      await renameFromMenu(page, 'My Writing')

      const name = dialog(page).getByLabel('Name')
      await expect(name).toHaveValue('My Writing')
      await expect(name).toBeFocused()
      expect(
        await name.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
      ).toEqual([0, 10])
      await expect(dialog(page).getByRole('button', { name: 'Save' })).toBeDisabled() // unchanged
      expect(await dialogViolations(page)).toEqual([])
      await page.screenshot({ path: `${shots}/rename-${scheme}.png` })

      await name.fill('x'.repeat(81))
      await expect(dialog(page)).toContainText('under 80 letters')
      await expect(dialog(page).getByRole('button', { name: 'Save' })).toBeDisabled()
      await page.screenshot({ path: `${shots}/rename-invalid-${scheme}.png` })

      await name.fill('  The Saltmarch Draft ')
      await expect(dialog(page).getByRole('button', { name: 'Save' })).toBeEnabled()
      await name.press('Enter')
      await expect(dialog(page)).toBeHidden()
      // Focus is back on the menu button it came from.
      await expect(
        topBar(page).getByRole('button', { name: 'The Saltmarch Draft', exact: true }),
      ).toBeFocused()
      await expect(page.getByRole('navigation', { name: 'Workspace' })).toContainText(
        'The Saltmarch Draft',
      )
      await waitSaved(page)

      // Only the name changed in the file.
      const file = (await opfs.list(page)).find((f) => f.endsWith('/aurelia.json'))!
      expect(await opfs.read(page, file)).toBe(
        before.replace('"My Writing"', '"The Saltmarch Draft"'),
      )

      await page.reload()
      await expect(sceneText(page)).toBeVisible()
      await expect(
        topBar(page).getByRole('button', { name: 'The Saltmarch Draft', exact: true }),
      ).toBeVisible()
      await page.goto('/')
      await expect(page.getByRole('button', { name: /The Saltmarch Draft/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /My Writing/ })).toHaveCount(0)
      await page.getByRole('button', { name: /The Saltmarch Draft/ }).click()
      await expect(sceneText(page)).toBeVisible()
    })
  }

  test('from the command palette; Escape cancels and focus goes back to where it was', async ({
    page,
  }) => {
    await createBrowserWorkspace(page, 'My Writing')
    await sceneText(page).click()
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('rename work')
    await page.getByRole('option', { name: /Rename workspace…/ }).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByLabel('Name')).toBeFocused()
    await dialog(page).getByLabel('Name').fill('Nope')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(sceneText(page)).toBeFocused()
    await expect(
      topBar(page).getByRole('button', { name: 'My Writing', exact: true }),
    ).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('rename work')
    await page.keyboard.press('Enter')
    await dialog(page).getByLabel('Name').fill('Through the palette')
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(
      topBar(page).getByRole('button', { name: 'Through the palette', exact: true }),
    ).toBeVisible()
    await expect(sceneText(page)).toBeFocused()
  })

  test('is not offered in the sample', async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('button', { name: /sample/i })
      .first()
      .click()
    await expect(topBar(page)).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('rename')
    await expect(page.getByRole('option', { name: /Rename workspace/ })).toHaveCount(0)
  })

  test('a change to aurelia.json made outside Aurelia is a conflict named "Workspace settings", never overwritten', async ({
    page,
  }) => {
    await createBrowserWorkspace(page, 'My Writing')
    const file = (await opfs.list(page)).find((f) => f.endsWith('/aurelia.json'))!
    const outside = (await opfs.read(page, file)).replace('"My Writing"', '"Their Name"')
    await opfs.write(page, file, outside)
    await renameFromMenu(page, 'My Writing')
    await dialog(page).getByLabel('Name').fill('My Name')
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await expect(statusBar(page)).toContainText('Changed outside Aurelia', { timeout: 8000 })
    expect(await opfs.read(page, file)).toBe(outside)
    await page.getByRole('button', { name: 'Compare versions' }).click()
    const compare = page.getByRole('dialog', { name: /Workspace settings/ })
    await expect(compare).toContainText('Workspace name: My Name')
    await expect(compare).toContainText('Workspace name: Their Name')
    await expect(compare).not.toContainText('aurelia.json')
    await page.screenshot({ path: `${shots}/conflict.png` })
  })

  test('with backup on, the server folder keeps its name, backup.json says the new one, and the restore list shows it', async ({
    page,
    browser,
    context,
  }) => {
    const dav = new FakeDav()
    await serveDav(context, dav)
    await createBrowserWorkspace(page, 'My Writing')
    await waitSaved(page)
    await openBackupScreen(page)
    const backup = page.getByRole('dialog', { name: 'Backup and versions' })
    await backup.getByRole('switch', { name: 'Back up to your server' }).click()
    await expect(backup).toContainText('Backed up')
    await page.keyboard.press('Escape')
    await expect(backup).toBeHidden()
    const folder = dav
      .paths()
      .find((p) => p.endsWith('/backup.json'))!
      .replace('/backup.json', '')
    expect(folder).toContain('My Writing')

    await renameFromMenu(page, 'My Writing')
    await dialog(page).getByLabel('Name').fill('Renamed Book')
    await dialog(page).getByLabel('Name').press('Enter')
    await expect(dialog(page)).toBeHidden()
    await expect
      .poll(() => dav.json<{ name: string }>(`${folder}/backup.json`).name, { timeout: 15_000 })
      .toBe('Renamed Book')
    expect(dav.paths().filter((p) => p.endsWith('/backup.json'))).toEqual([`${folder}/backup.json`])
    expect(JSON.parse(dav.text(`${folder}/current/aurelia.json`)!).name).toBe('Renamed Book')

    // The Backup screen says the current name; the folder on the server did not move.
    await openBackupScreen(page)
    await expect(page.getByRole('dialog', { name: 'Backup and versions' })).toContainText(
      'Aurelia › Renamed Book',
    )
    await page.screenshot({ path: `${shots}/backup-screen.png` })
    await page.keyboard.press('Escape')

    const fresh = await browser.newContext({
      baseURL: `http://localhost:${process.env.E2E_PORT ?? 4173}`,
      serviceWorkers: 'block',
      viewport: { width: 1440, height: 900 },
    })
    await serveDav(fresh, dav)
    const other = await fresh.newPage()
    await other.goto('/')
    await other.getByRole('button', { name: /Restore from a backup/ }).click()
    const restore = other.getByRole('dialog', { name: 'Restore from a backup' })
    await expect(restore.getByRole('button', { name: /Renamed Book/ })).toBeVisible()
    await expect(restore.getByRole('button', { name: /My Writing/ })).toHaveCount(0)
    await other.screenshot({ path: `${shots}/restore-list.png` })
    await fresh.close()
  })
})
