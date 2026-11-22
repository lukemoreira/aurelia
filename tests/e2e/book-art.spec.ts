// SPDX-License-Identifier: AGPL-3.0-or-later
// A book's website, logo and cover art, on the Book tab (ADR-0003, ADR-0014).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createBrowserWorkspace, opfs, waitSaved } from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
test.setTimeout(60_000)

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Scene inspector' })
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHPzzSQAAAABJRU5ErkJggg==',
  'base64',
)
const bookJson = async (page: Page) => {
  const path = (await opfs.list(page)).find((f) => /\/books\/bok_\w+\/book\.json$/.test(f))!
  return JSON.parse(await opfs.read(page, path)) as Record<string, unknown>
}

test('the website links only to a web address, and the logo and cover art are chosen from the gallery', async ({
  page,
}) => {
  await createBrowserWorkspace(page)
  await inspector(page).getByRole('tab', { name: 'Book', exact: true }).click()
  const details = inspector(page).getByRole('form', { name: 'Book', exact: true })

  const website = details.getByLabel('Website', { exact: true })
  await website.fill('javascript:alert(1)')
  await website.blur()
  await expect(details.getByRole('link')).toHaveCount(0)
  await website.fill('example.com/book')
  await website.blur()
  const link = details.getByRole('link', { name: 'Open example.com/book' })
  await expect(link).toHaveAttribute('href', 'https://example.com/book')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

  for (const [noun, label] of [
    ['cover art', 'Cover art'],
    ['logo', 'Logo'],
  ] as const) {
    await details.getByRole('button', { name: `Add ${noun}` }).click()
    const picker = page.getByRole('dialog', { name: `Choose ${noun}` })
    await picker
      .getByLabel('Choose images to add')
      .setInputFiles({ name: `${label}.png`, mimeType: 'image/png', buffer: PNG })
    await expect(picker).toBeHidden()
    await expect(details.getByRole('button', { name: `Change ${noun}` })).toBeVisible()
  }
  await waitSaved(page)
  expect(await bookJson(page)).toMatchObject({
    website: 'example.com/book',
    logo: expect.stringMatching(/^med_/),
    cover: expect.stringMatching(/^med_/),
  })
  expect(
    await new AxeBuilder({ page })
      .analyze()
      .then((r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')),
  ).toEqual([])

  await page.reload()
  await inspector(page).getByRole('tab', { name: 'Book', exact: true }).click()
  await expect(details.getByRole('button', { name: 'Change cover art' })).toBeVisible()
  await details.getByRole('button', { name: 'Remove cover art' }).click()
  await expect(details.getByRole('button', { name: 'Add cover art' })).toBeVisible()
  await waitSaved(page)
  const saved = await bookJson(page)
  expect(saved).not.toHaveProperty('cover')
  expect(saved).toHaveProperty('logo')
})
