// SPDX-License-Identifier: AGPL-3.0-or-later
// The story base (ADR-0016): written by hand on the Book tab, and set by the assistant's suggestions,
// each accepted alone in the Review inbox. The assistant server is played by page.route; a suggestion is
// a file in the workspace (as sync brings it in), so it is tested by writing one.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { recordFingerprint } from '@/domain/proposals'
import type { RecordDoc } from '@/domain/workspace-data'
import { parseFile } from '@/storage/entities'
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
  const genre = base.getByRole('textbox', { name: 'Genre' }) // a one-line field
  await genre.fill('Military history')
  await genre.blur()
  const subject = base.getByRole('textbox', { name: 'Subject area' })
  await subject.fill('WWII naval warfare')
  await subject.blur()
  const world = base.getByRole('textbox', { name: 'World and history' })
  await world.fill('An island.')
  await world.blur()
  const { path, bookId } = await bookFile(page)
  await expect
    .poll(async () => JSON.parse(await opfs.read(page, path)).storyBase)
    .toEqual({ genre: 'Military history', subject: 'WWII naval warfare', world: 'An island.' })
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
      volumes: { before: '', after: '3' },
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
  await expect(card).toContainText('Planned volumes')
  // In the base's own order: planned volumes, objectives, then the world.
  await expect(card.locator('ins')).toContainText(['3', 'A mystery for adults.', 'Two islands'])
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
  await expect(base.getByRole('textbox', { name: 'Planned volumes' })).toHaveValue('3')
  // The genre typed by hand before the reload is still there.
  await expect(base.getByRole('textbox', { name: 'Genre' })).toHaveValue('Military history')
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

test('a suggested record delete: the card says what goes and what links to it; Accept moves it to Recently deleted', async ({
  page,
}) => {
  await page.route('**/agent/status', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'signed-in' }) }),
  )
  await createBrowserWorkspace(page)
  const { bookId, home } = await bookFile(page)
  await suggest(page, {
    id: 'prp_charaaaaaa',
    kind: 'character',
    bookId,
    name: 'Archie Collins',
    fields: { role: 'Clerk' },
  })
  await page.reload()
  await tab(page, 'Assistant').click()
  await page
    .locator('[data-proposal="prp_charaaaaaa"]')
    .getByRole('button', { name: 'Accept' })
    .click()
  await expect(page.locator('[data-proposal="prp_charaaaaaa"]')).toHaveCount(0)

  // The record as the app wrote it, read as the server reads it; and a scene that links to it.
  const files = await opfs.list(page)
  const recordFile = files.find((f) => /^[^.]*\/records\/characters\/chr_\w+\.md$/.test(f))!
  const recordId = /(chr_\w+)\.md$/.exec(recordFile)![1]!
  const parsed = parseFile(
    recordFile.slice(home.length + 1),
    await opfs.read(page, recordFile),
    () => {},
  )
  const fingerprint = recordFingerprint((parsed as { doc: RecordDoc }).doc)
  const scene = files.find((f) => /^[^.]*\/scenes\/scn_\w+\.md$/.test(f))!
  await opfs.write(
    page,
    scene,
    `${(await opfs.read(page, scene)).trimEnd()}\n\n[[id:${recordId}|Archie]] waited.\n`,
  )
  const del = { kind: 'delete-record', recordId, recordType: 'character', title: 'Archie Collins' }
  await suggest(page, { id: 'prp_delaaaaaaa', ...del, fingerprint, why: 'A duplicate of Archie.' })
  // One made before the record last changed: it no longer applies.
  await suggest(page, { id: 'prp_delbbbbbbb', ...del, fingerprint: '00000000' })
  await page.reload()
  await tab(page, 'Assistant').click()

  const card = page.locator('[data-proposal="prp_delaaaaaaa"]')
  await expect(card).toContainText('Delete character: “Archie Collins”')
  await expect(card).toContainText('A duplicate of Archie.')
  await expect(card).toContainText('Accept moves it to Recently deleted')
  await expect(card).toContainText('1 scene links to it')
  const stale = page.locator('[data-proposal="prp_delbbbbbbb"]')
  await expect(stale).toContainText('Out of date: this record was changed or deleted')
  await expect(stale.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  const { violations } = await new AxeBuilder({ page }).include('[data-proposal]').analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  await card.getByRole('button', { name: 'Accept' }).click()
  await expect(card).toHaveCount(0)
  await expect(page.getByText('Moved “Archie Collins” to Recently deleted.')).toBeVisible()
  const after = await opfs.list(page)
  expect(after).not.toContain(recordFile)
  expect(after.some((f) => f.includes('/.aurelia/trash/') && f.endsWith(`${recordId}.md`))).toBe(
    true,
  )
  expect(after).toContain(scene) // the scene that linked to it stays
  await expect(stale.getByRole('button', { name: 'Accept' })).toHaveCount(0)
})
