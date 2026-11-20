// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test'
import {
  createBrowserWorkspace,
  opfs,
  sceneText,
  seriousViolations,
  statusBar,
  waitSaved,
} from '../helpers/browser-workspace'

test('a daily goal is set from the status bar and the count follows what is typed', async ({
  page,
}) => {
  await createBrowserWorkspace(page)
  const chip = statusBar(page).getByRole('button', { name: /words today/ })
  await expect(chip).toHaveText('0 words today')

  await chip.click()
  const popover = page.getByRole('dialog')
  await popover.getByLabel('Daily goal').fill('500')
  await popover.getByLabel('Daily goal').press('Tab')
  await expect(popover).toContainText('Write today to start a streak.')
  expect(await seriousViolations(page)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(chip).toHaveText('0 / 500 words today')

  await sceneText(page).click()
  await page.keyboard.type('One two three four five.')
  await expect(chip).toHaveText('5 / 500 words today')

  // The log holds the goal and the day's start, and survives a reload with the day's words.
  await waitSaved(page)
  const log = (await opfs.list(page)).find((p) => p.endsWith('.aurelia/writing-log.json'))!
  expect(JSON.parse(await opfs.read(page, log))).toMatchObject({ schemaVersion: 1, dailyGoal: 500 })
  await page.reload()
  await expect(chip).toHaveText('5 / 500 words today')
})
