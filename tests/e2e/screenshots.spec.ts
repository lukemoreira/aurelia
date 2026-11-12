// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test'

// Not assertions about looks: pictures to compare with docs/design by eye.
// They are written to test-results/, which git ignores.
const dir = 'test-results/shell-screenshots'

async function openSample(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Open the sample universe/ }).click()
  await expect(page.getByRole('heading', { name: 'Curfew Bells' })).toBeVisible()
}

test.use({ viewport: { width: 1440, height: 900 } })

for (const scheme of ['light', 'dark'] as const) {
  test(`screenshots in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/')
    await page.screenshot({ path: `${dir}/welcome-${scheme}.png` })
    await openSample(page)
    await page.screenshot({ path: `${dir}/write-${scheme}.png` })
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('tomas')
    await expect(page.getByRole('option').first()).toBeVisible()
    await page.screenshot({ path: `${dir}/palette-${scheme}.png` })
  })
}

test('screenshot of the tablet layout', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await openSample(page)
  await page.screenshot({ path: `${dir}/tablet-write.png` })
})

test('screenshot of the phone layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.screenshot({ path: `${dir}/phone-welcome.png` })
  await openSample(page)
  await page.screenshot({ path: `${dir}/phone-write.png` })
  await page.getByRole('button', { name: 'Open the navigator' }).click()
  await expect(page.getByRole('dialog', { name: 'Navigator' })).toBeVisible()
  await page.screenshot({ path: `${dir}/phone-navigator.png` })
})
