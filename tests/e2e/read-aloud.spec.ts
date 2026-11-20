// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test'
import {
  createBrowserWorkspace,
  firstScenePath,
  opfs,
  sceneText,
  seriousViolations,
  waitSaved,
} from '../helpers/browser-workspace'
import { installFakeSpeech } from '../helpers/fake-speech'

const MOD = 'ControlOrMeta'
const marked = (page: Page) => page.locator('.reading-now')
const finishOne = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __fakeSpeech: { finish(): void } }).__fakeSpeech.finish(),
  )
const spoken = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __fakeSpeech: { texts(): string[] } }).__fakeSpeech.texts(),
  )

test('reads the scene aloud with a fake voice: marks the paragraph, then stops, and writes nothing', async ({
  page,
}) => {
  // The page gets a fake speechSynthesis (with a network voice among the local ones) before it starts.
  await page.addInitScript(`(${installFakeSpeech.toString()})(window)`)
  await createBrowserWorkspace(page)
  await sceneText(page).click()
  await page.keyboard.type('First line.\nSecond line.\nThird line.')
  await waitSaved(page)
  const path = await firstScenePath(page)
  const onDisk = await opfs.read(page, path)

  // From the second paragraph to the end, from the toolbar.
  await sceneText(page).getByText('Second line.').click()
  await page.getByRole('button', { name: 'Read aloud', exact: true }).click()
  await expect(marked(page)).toHaveText('Second line.')
  expect(await spoken(page)).toEqual(['Second line.', 'Third line.'])
  await expect(page.getByRole('group', { name: 'Reading aloud' })).toBeVisible()
  expect(await seriousViolations(page)).toEqual([])

  await finishOne(page)
  await expect(marked(page)).toHaveText('Third line.')

  await page.getByRole('button', { name: /^Pause/ }).click()
  await expect(page.getByRole('button', { name: /^Resume/ })).toBeVisible()
  await page.getByRole('button', { name: /^Stop/ }).click()
  await expect(marked(page)).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Reading aloud' })).toHaveCount(0)

  // Again with the shortcut, and Esc.
  await page.keyboard.press(`${MOD}+Alt+r`)
  await expect(marked(page)).toHaveText('Second line.')
  await page.keyboard.press('Escape')
  await expect(marked(page)).toHaveCount(0)

  // Reading never touched the scene: nothing was saved, the file is as it was.
  await page.waitForTimeout(1500)
  expect(await opfs.read(page, path)).toBe(onDisk)
})
