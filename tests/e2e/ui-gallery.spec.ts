// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

for (const scheme of ['light', 'dark'] as const) {
  test(`/ui has no serious accessibility violations in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/ui')
    await expect(page.getByRole('heading', { name: 'Aurelia components' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
    expect(await serious(page)).toEqual([])
  })
}

test('an open dialog has no serious accessibility violations', async ({ page }) => {
  await page.goto('/ui')
  await page.getByRole('button', { name: 'Dialog 480' }).click()
  await expect(page.getByRole('dialog', { name: 'Delete this scene?' })).toBeVisible()
  expect(await serious(page)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Dialog 480' })).toBeFocused()
})

test('the theme switch persists across a reload', async ({ page }) => {
  await page.goto('/ui')
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('the tree works from the keyboard', async ({ page }) => {
  await page.goto('/ui')
  const tree = page.getByRole('tree', { name: 'Workspace' })
  const first = tree.getByRole('treeitem').first()
  await first.focus()
  await page.keyboard.press('End')
  await expect(tree.getByRole('treeitem').last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(first).toBeFocused()
  await page.keyboard.press('ArrowLeft') // collapse the book
  await expect(first).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowRight')
  await expect(first).toHaveAttribute('aria-expanded', 'true')
  await page.waitForTimeout(1100) // Reka's type-ahead buffer also records arrow keys for 1 s
  await page.keyboard.type('Tide') // type-ahead jumps to "Tidewrack"
  await expect(tree.getByRole('treeitem', { name: /Tidewrack/ })).toBeFocused()
})
