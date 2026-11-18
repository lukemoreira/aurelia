// SPDX-License-Identifier: AGPL-3.0-or-later
// The story base (ADR-0016): written by hand on the Book tab, and set by the assistant's suggestions,
// each accepted alone in the Review inbox. The assistant server is played by page.route; a suggestion is
// a file in the workspace (as sync brings it in), so it is tested by writing one.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createBrowserWorkspace, opfs } from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
test.setTimeout(60_000)

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Scene inspector' })
const tab = (page: Page, name: string) => inspector(page).getByRole('tab', { name, exact: true })

/** The book's `book.json` and the workspace folder it sits in. */
async function bookFile(page: Page) {
  const path = (await opfs.list(page)).find((f) => /^[^.]*\/books\/bok_\w+\/book\.json$/.test(f))!
  return {
    path,
    home: path.split('/universes/')[0]!,
    bookId: /(bok_\w+)\/book\.json$/.exec(path)![1]!,
  }
}

async function suggest(page: Page, proposal: { id: string; [key: string]: unknown }) {
  const { home } = await bookFile(page)
  await opfs.write(
    page,
    `${home}/.aurelia/proposals/${proposal.id}.json`,
    JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      by: 'Claude',
      why: 'From your answers.',
      ...proposal,
    }),
  )
}

test('the story base: written by hand, then a section and a main character suggested and accepted one at a time', async ({
  page,
}) => {
  await page.route('**/agent/status', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'signed-in' }) }),
  )
  await createBrowserWorkspace(page)
  await tab(page, 'Book').click()
  const base = inspector(page).getByRole('form', { name: 'Story base' })
  await expect(base.getByRole('heading', { name: 'Story base' })).toBeVisible()
  await expect(base).toContainText('No characters yet')
  // Not synced with the server: the assistant cannot read the book, so the guided start is not offered.
  await expect(base.getByRole('button', { name: /Set up the story base/ })).toHaveCount(0)
  const world = base.getByRole('textbox', { name: 'World and history' })
  await world.fill('An island.')
  await world.blur()
  const { path, bookId } = await bookFile(page)
  await expect
    .poll(async () => JSON.parse(await opfs.read(page, path)).storyBase)
    .toEqual({ world: 'An island.' })
  const { violations } = await new AxeBuilder({ page })
    .include('[aria-label="Scene inspector"]')
    .analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  await suggest(page, {
    id: 'prp_baseaaaaaa',
    kind: 'base',
    bookId,
    bookTitle: 'My Writing',
    sections: {
      world: { before: 'An island.', after: 'Two islands at war.' },
      objectives: { before: '', after: 'A mystery for adults.' },
    },
  })
  await suggest(page, {
    id: 'prp_charaaaaaa',
    kind: 'character',
    bookId,
    name: 'Tomas Brandt',
    fields: { role: 'Protagonist', goal: 'To leave the islands' },
  })
  await page.reload()
  await tab(page, 'Assistant').click()
  const card = page.locator('[data-proposal="prp_baseaaaaaa"]')
  await expect(card).toContainText('Story base of')
  await expect(card).toContainText('World and history')
  // In the base's own order: objectives first.
  await expect(card.locator('ins')).toContainText(['A mystery for adults.', 'Two islands'])
  const person = page.locator('[data-proposal="prp_charaaaaaa"]')
  await expect(person).toContainText('New character: “Tomas Brandt”')
  await expect(person).toContainText('Protagonist')
  // No "accept all": each suggestion has its own buttons.
  await expect(page.getByRole('button', { name: /accept all/i })).toHaveCount(0)

  await card.getByRole('button', { name: 'Accept' }).click()
  await expect(card).toHaveCount(0)
  await person.getByRole('button', { name: 'Accept' }).click()
  await expect(person).toHaveCount(0)

  await tab(page, 'Book').click()
  await expect(base.getByRole('textbox', { name: 'World and history' })).toHaveValue(
    'Two islands at war.',
  )
  await expect(base.getByRole('textbox', { name: 'Objectives' })).toHaveValue(
    'A mystery for adults.',
  )
  await expect(base).toContainText('Tomas Brandt · Protagonist')
  await page.screenshot({ path: 'test-results/m8-screenshots/story-base.png' })
  const files = await opfs.list(page)
  expect(files.some((f) => f.includes('/.aurelia/proposals/'))).toBe(false)
  // It replaced the author's own text: a snapshot of the book was taken first.
  const manifests = files.filter((f) => /\.aurelia\/snapshots\/snp_\w+\/snapshot\.json$/.test(f))
  expect(manifests).toHaveLength(1)
  expect(await opfs.read(page, manifests[0]!)).toContain('"reason": "before-assistant"')
  expect(files.some((f) => /\/records\/characters\/chr_\w+\.md$/.test(f))).toBe(true)
})
