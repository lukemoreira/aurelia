// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test'

test('the app loads', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Aurelia')
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()
})
