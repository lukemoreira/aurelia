// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createBrowserWorkspace, sceneText, waitSaved } from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
test.setTimeout(60_000)
const shots = 'test-results/find-replace-screenshots'

const nav = (page: Page) => page.getByRole('navigation', { name: 'Workspace' })

/** Serious problems inside the open dialog, once it has finished fading in. */
async function dialogViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  )
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => v.id)
}

for (const scheme of ['light', 'dark'] as const) {
  test(`find and replace in two scenes, then undo — in the ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page)
    await sceneText(page).fill('The lamp went out. A [[lamp]] stays.')
    await waitSaved(page)
    await page.getByRole('button', { name: 'New scene in this chapter' }).click()
    await expect(sceneText(page)).toHaveText('')
    await sceneText(page).fill('LAMP oil for the lamp.')
    await waitSaved(page)

    await page.keyboard.press('ControlOrMeta+Shift+h')
    const dialog = page.getByRole('dialog', { name: 'Find and replace in this book' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Find')).toBeFocused()
    await dialog.getByLabel('Find').fill('lamp')
    await dialog.getByLabel('Replace with').fill('torch')
    await expect(dialog).toContainText('3 places')
    await expect(dialog).toContainText('1 inside links, not changed.')
    await expect(dialog.getByRole('region', { name: 'Places that would change' })).toContainText(
      'TORCH',
    )
    expect(await dialogViolations(page)).toEqual([])
    await page.screenshot({ path: `${shots}/dialog-${scheme}.png` })

    await dialog.getByRole('button', { name: 'Replace 3 places' }).click()
    await expect(dialog).toBeHidden()
    const toast = page.getByRole('status').filter({ hasText: 'Replaced 3 places in 2 scenes.' })
    await expect(toast).toBeVisible()
    await expect(sceneText(page)).toHaveText('TORCH oil for the torch.')
    await nav(page).getByText('Untitled scene', { exact: true }).first().click()
    await expect(sceneText(page)).toContainText('The torch went out.')
    await expect(sceneText(page)).toContainText('lamp') // the link is left as it is

    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Put 2 files back.' })).toBeVisible()
    await expect(sceneText(page)).toContainText('The lamp went out.')
    await waitSaved(page)
  })
}

test('on a phone the dialog fits and passes axe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createBrowserWorkspace(page)
  await sceneText(page).fill('The lamp went out.')
  await waitSaved(page)
  await page.keyboard.press('ControlOrMeta+Shift+h')
  const dialog = page.getByRole('dialog', { name: 'Find and replace in this book' })
  await dialog.getByLabel('Find').fill('lamp')
  await dialog.getByLabel('Replace with').fill('torch')
  await expect(dialog.getByRole('button', { name: 'Replace 1 place' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  expect(await dialogViolations(page)).toEqual([])
  await page.screenshot({ path: `${shots}/dialog-phone.png` })
})
