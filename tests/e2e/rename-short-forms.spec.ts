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

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
const shots = 'test-results/rename-short-forms-screenshots'

const VASQUEZ = 'chr_vasquez001'
const MOREAU = 'chr_moreau0001'
const SECOND = 'scn_moreau0001'

const character = (id: string, title: string) =>
  `---\ntitle: "${title}"\nschemaVersion: 1\nid: "${id}"\ntype: "character"\nscope: "universe"\n---\n\n`

/** Two characters called Elena, and two scenes: one names Vasquez, the other Moreau. */
async function seeded(page: Page) {
  await createBrowserWorkspace(page, 'Saltmarch')
  const first = await firstScenePath(page)
  const base = first.slice(0, first.indexOf('/books/'))
  const bookDir = first.slice(0, first.indexOf('/scenes/'))
  const file = await opfs.read(page, first)
  const head = file.slice(0, file.indexOf('\n---\n') + 5)
  await opfs.write(page, first, `${head}\nElena Vasquez opened the gate. Elena smiled.\n`)
  const scene = /scn_\w+/.exec(first)![0]
  const chapter = /chapter: "(chp_\w+)"/.exec(head)![1]!
  await opfs.write(
    page,
    `${bookDir}/scenes/${SECOND}.md`,
    `---\ntitle: "The Quay"\nschemaVersion: 1\nid: "${SECOND}"\nchapter: "${chapter}"\norder: "b"\n---\n\nElena Moreau waited on the quay. Elena waved.\n`,
  )
  const book = JSON.parse(await opfs.read(page, `${bookDir}/book.json`))
  if (book.outline)
    book.outline = book.outline.map((c: { chapter: string; scenes: string[] }) =>
      c.chapter === chapter ? { ...c, scenes: [scene, SECOND] } : c,
    )
  await opfs.write(page, `${bookDir}/book.json`, JSON.stringify(book))
  await opfs.write(
    page,
    `${base}/records/characters/${VASQUEZ}.md`,
    character(VASQUEZ, 'Elena Vasquez'),
  )
  await opfs.write(
    page,
    `${base}/records/characters/${MOREAU}.md`,
    character(MOREAU, 'Elena Moreau'),
  )
  await page.reload()
  await expect(sceneText(page)).toContainText('Elena Vasquez opened the gate')
  return { first, second: `${bookDir}/scenes/${SECOND}.md` }
}

test('a first name two characters share is renamed where the scene names only the renamed one', async ({
  page,
}) => {
  const { first, second } = await seeded(page)
  await waitSaved(page)
  const quay = await opfs.read(page, second)
  await page.getByRole('link', { name: 'World' }).click()
  await page.getByRole('button', { name: 'Elena Vasquez' }).click()
  await page
    .getByRole('region', { name: 'Record' })
    .getByRole('button', { name: 'Rename…' })
    .click()
  const name = page.getByRole('dialog').getByLabel('Name', { exact: true })
  await name.fill('Helena Vasquez')
  await name.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Change the name in your text too?' })
  await expect(dialog).toBeVisible()
  // The short form is listed with what it becomes.
  await expect(dialog.getByLabel('New form for Elena', { exact: true })).toHaveValue('Helena')

  const places = dialog.getByRole('region', { name: 'Places that would change' })
  // The full name, the guessed "Elena" in the gate scene, and the uncertain one on the quay.
  await expect(places.getByRole('listitem')).toHaveCount(3)
  const smiled = places.getByRole('listitem').filter({ hasText: 'Probably' })
  const waved = places.getByRole('listitem').filter({ hasText: 'quay' })
  await expect(smiled).toContainText('smiled')
  await expect(smiled).toContainText(
    'Probably Elena Vasquez: this scene names Elena Vasquez, not Elena Moreau.',
  )
  await expect(smiled.getByRole('checkbox')).toBeChecked()
  await expect(waved).toContainText('Uncertain — this scene names Elena Moreau.')
  await expect(waved.getByRole('checkbox')).not.toBeChecked()
  // "To check" lists the guess and the uncertain place.
  await dialog.getByRole('radio', { name: 'To check 2' }).click()
  await expect(places.getByRole('checkbox')).toHaveCount(2)
  await page.screenshot({ path: `${shots}/guess.png` })
  expect(await seriousViolations(page)).toEqual([])

  await dialog.getByRole('button', { name: 'Change 2 places' }).click()
  await expect(dialog).toContainText('Changed 2 places. 1 place was left as it is.')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toBeHidden()

  await waitSaved(page)
  expect(await opfs.read(page, first)).toContain('Helena Vasquez opened the gate. Helena smiled.')
  expect(await opfs.read(page, second)).toBe(quay)
})
