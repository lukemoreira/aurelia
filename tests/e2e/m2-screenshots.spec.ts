// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test'
import {
  createBrowserWorkspace,
  firstScenePath,
  opfs,
  sceneText,
  statusBar,
  waitSaved,
} from '../helpers/browser-workspace'

// Not assertions about looks: pictures to compare with docs/design by eye (written to test-results/).
const dir = 'test-results/m2-screenshots'
test.use({ viewport: { width: 1440, height: 900 } })

const PROSE =
  'The bells had already started when Elena reached the Lantern Gate.\n\nShe counted them the way her mother had taught her: one for the curfew, one for the tide, one for anyone still out on the salt.\n\n* * *\n\nThe warden knew her face.'

for (const scheme of ['light', 'dark'] as const) {
  test(`screenshots of storage in the ${scheme} theme: welcome, a saved scene, the conflict banner and dialog`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page, 'The Saltmarch Draft')
    await sceneText(page).fill(PROSE)
    await waitSaved(page)
    await page.screenshot({ path: `${dir}/saved-scene-${scheme}.png` })

    await page.goto('/')
    await expect(page.getByRole('button', { name: /The Saltmarch Draft/ })).toBeVisible()
    await page.screenshot({ path: `${dir}/welcome-${scheme}.png` })
    await page.getByRole('button', { name: /The Saltmarch Draft/ }).click()
    await expect(sceneText(page)).toBeVisible()

    const path = await firstScenePath(page)
    const saved = await opfs.read(page, path)
    await sceneText(page).press('End')
    await page.keyboard.type(' She said nothing.')
    await opfs.write(
      page,
      path,
      saved.replace('The warden knew her face.', 'The warden knew her face, and her name.'),
    )
    await expect(statusBar(page)).toContainText('Changed outside Aurelia', { timeout: 8000 })
    await page.screenshot({ path: `${dir}/conflict-banner-${scheme}.png` })
    await page.getByRole('button', { name: 'Compare versions' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.screenshot({ path: `${dir}/conflict-dialog-${scheme}.png` })
  })
}

test('screenshot of the phone header while saved', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createBrowserWorkspace(page, 'The Saltmarch Draft')
  await sceneText(page).fill(PROSE)
  await waitSaved(page)
  await page.screenshot({ path: `${dir}/phone-saved-light.png` })
})
