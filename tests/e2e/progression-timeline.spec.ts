// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test'
import {
  createBrowserWorkspace,
  firstScenePath,
  opfs,
  seriousViolations,
  waitSaved,
} from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
const shots = 'test-results/m6b-screenshots'
test.setTimeout(60_000) // seeds a two-book workspace and walks four screens

const ELENA = 'chr_elena00001'
const TOMAS = 'chr_tomas00001'
const CAL = 'cal_tide000001'
const BOOK2 = 'bok_second0001'
const CHAPTER2 = 'chp_second0001'
const SCENE_B = 'scn_first00002'
const SCENE_C = 'scn_second0001'

/** A record file, as the app writes one. */
const record = (id: string, type: string, title: string, extra = '') =>
  `---\ntitle: "${title}"\nschemaVersion: 1\nid: "${id}"\ntype: "${type}"\nscope: "universe"\n${extra}---\n\n`
const scene = (
  id: string,
  chapter: string,
  title: string,
  order: string,
  extra: string,
  body: string,
) =>
  `---\ntitle: "${title}"\nschemaVersion: 1\nid: "${id}"\nchapter: "${chapter}"\norder: "${order}"\n${extra}---\n\n${body}\n`

/**
 * A shared universe with a calendar and two books, put in place the way another app would: Elena gains a
 * goal in the first scene, is hurt in the second, and walks into the second book, whose scene has no time.
 */
async function seeded(page: Page) {
  await createBrowserWorkspace(page, 'Saltmarch')
  const path = await firstScenePath(page)
  const base = path.slice(0, path.indexOf('/books/'))
  const chapterFile = (await opfs.list(page)).find((f) => /\/chapters\/chp_\w+\.md$/.test(f))!
  const [unv, book1, chapter1, scene1] = [
    /universes\/(unv_\w+)/.exec(path)![1]!,
    /books\/(bok_\w+)\//.exec(path)![1]!,
    /chp_\w+/.exec(chapterFile)![0],
    /scn_\w+/.exec(path)![0],
  ]
  const put = (file: string, text: string) => opfs.write(page, `${base}/${file}`, text)
  await put(
    'universe.md',
    `---\ntitle: "Saltmarch"\nschemaVersion: 1\nid: "${unv}"\nkind: "shared"\nbooks:\n  - "${book1}"\n  - "${BOOK2}"\ncalendars:\n  - id: "${CAL}"\n    name: "Tidal Reckoning"\n    era: "TR"\n    months: ["Thaw", "Bloom", "Heat"]\n---\n\n`,
  )
  await put(
    'records/characters/' + ELENA + '.md',
    record(ELENA, 'character', 'Elena Vasquez', 'color: "ember"\n'),
  )
  await put(
    'records/characters/' + TOMAS + '.md',
    record(TOMAS, 'character', 'Tomas Brandt', 'color: "tide"\n'),
  )
  const first = `books/${book1}`
  await put(
    `${first}/scenes/${scene1}.md`,
    scene(
      scene1,
      chapter1,
      'The Lantern Gate',
      'a',
      `pov: "${ELENA}"\ntime:\n  calendar: "${CAL}"\n  at: "412-03-14"\nchanges:\n  - { who: "${ELENA}", kind: "goal", value: "Find the key" }\n`,
      'Elena Vasquez reached the gate.',
    ),
  )
  await put(
    `${first}/scenes/${SCENE_B}.md`,
    scene(
      SCENE_B,
      chapter1,
      'Broken Glass',
      'b',
      `pov: "${ELENA}"\ntime:\n  calendar: "${CAL}"\n  at: "412-03-20"\nchanges:\n  - { who: "${ELENA}", kind: "condition", value: "Injured — left hand" }\n  - { who: "${TOMAS}", kind: "relation", with: "${ELENA}", value: "stranger → creditor" }\n`,
      'Elena Vasquez cut her hand on the glass. Tomas Brandt watched.',
    ),
  )
  await put(
    `${first}/book.json`,
    JSON.stringify({
      title: 'Saltmarch',
      schemaVersion: 1,
      id: book1,
      mode: 'linear',
      outline: [{ chapter: chapter1, scenes: [scene1, SCENE_B] }],
    }),
  )
  const second = `books/${BOOK2}`
  await put(
    `${second}/book.json`,
    JSON.stringify({
      title: 'Tidebound',
      schemaVersion: 1,
      id: BOOK2,
      mode: 'linear',
      outline: [{ chapter: CHAPTER2, scenes: [SCENE_C] }],
    }),
  )
  await put(
    `${second}/chapters/${CHAPTER2}.md`,
    `---\ntitle: "The Return"\nschemaVersion: 1\nid: "${CHAPTER2}"\nbook: "${BOOK2}"\norder: "a"\n---\n\n`,
  )
  await put(
    `${second}/scenes/${SCENE_C}.md`,
    scene(
      SCENE_C,
      CHAPTER2,
      'Home Water',
      'a',
      `pov: "${TOMAS}"\n`,
      'Tomas Brandt rowed home. Elena Vasquez sat in the bow.',
    ),
  )
  await page.reload()
  await expect(page.getByRole('link', { name: 'Continuity' })).toBeVisible()
  return { base, book1, scene1 }
}

const tidy = async (page: Page) => {
  const tip = page.getByRole('button', { name: 'Not now' })
  if (await tip.isVisible()) await tip.click()
  await page.evaluate(() =>
    document.querySelectorAll('*').forEach((e) => e.scrollTop > 0 && (e.scrollTop = 0)),
  )
}
const sheet = (page: Page) => page.getByRole('region', { name: 'Record' })

for (const scheme of ['light', 'dark'] as const) {
  test(`a character’s progression: the scrubber moves through the story and the state changes, in the ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await seeded(page)
    await page.getByRole('link', { name: 'World' }).click()
    await page.getByRole('button', { name: 'Elena Vasquez' }).first().click()
    await sheet(page).getByRole('tab', { name: 'Progression' }).click()

    // This book first: one chapter. The control is the Continuity view's: This book, then Whole universe.
    const scope = sheet(page).getByRole('radiogroup', { name: 'Scope' })
    await expect(scope.getByRole('radio')).toHaveText(['This book', 'Whole universe'])
    await expect(scope.getByRole('radio', { name: 'This book' })).toBeChecked()
    await expect(sheet(page).getByRole('table').getByRole('rowheader')).toHaveCount(1)
    await scope.getByRole('radio', { name: 'Whole universe' }).click()

    // The table: a row for each chapter of both books, each naming its book, words in every cell.
    const table = sheet(page).getByRole('table')
    await expect(table.getByRole('columnheader')).toHaveText([
      'Chapter',
      'On the page',
      'Point of view',
      'Changes',
    ])
    await expect(table.getByRole('rowheader')).toHaveCount(2)
    await expect(table.getByRole('rowheader').nth(1)).toContainText('Tidebound · Chapter 1')
    await expect(table.getByRole('rowheader').nth(0)).toContainText('Saltmarch · Chapter 1')

    // The scrubber starts on the last scene she is on the page in (book two), and the whole story is her state.
    const scrub = sheet(page).getByRole('slider', { name: 'Story position' })
    await expect(scrub).toHaveAttribute('aria-valuetext', /Tidebound · 1\.1 · Home Water/)
    const state = sheet(page).getByRole('region', { name: /State at/ })
    await expect(state).toContainText('Injured — left hand')
    await expect(state).toContainText('Find the key')

    // Home goes to the first scene: the goal, and not yet the injury.
    await scrub.focus()
    await page.keyboard.press('Home')
    await expect(scrub).toHaveAttribute('aria-valuetext', /The Lantern Gate/)
    await expect(state).toContainText('Find the key')
    await expect(state).not.toContainText('Injured')
    const log = sheet(page).getByRole('region', { name: 'What changes, scene by scene' })
    await expect(log.getByText('later in the story')).toHaveCount(2)
    await tidy(page)
    await page.screenshot({ path: `${shots}/progression-start-${scheme}.png` })
    // One step on: hurt, and what Tomas now thinks of her is in her log, not her state.
    await page.keyboard.press('ArrowRight')
    await expect(scrub).toHaveAttribute('aria-valuetext', /Broken Glass/)
    await expect(state).toContainText('Injured — left hand')
    await expect(log.getByText('later in the story')).toHaveCount(0)
    await expect(log).toContainText('Tomas Brandt sees Elena Vasquez as creditor (was: stranger)')
    expect(await seriousViolations(page)).toEqual([])
    await page.screenshot({ path: `${shots}/progression-${scheme}.png` })

    // A chapter's row takes the scrubber to the end of it.
    await table
      .getByRole('button', { name: /Chapter 1.*The Lantern Gate|Chapter 1/ })
      .first()
      .click()
    await expect(scrub).toHaveAttribute('aria-valuetext', /Broken Glass/)

    // This book only: one chapter. And back to the whole universe.
    await scope.getByRole('radio', { name: 'This book' }).click()
    await expect(table.getByRole('rowheader')).toHaveCount(1)
    await expect(table).not.toContainText('Tidebound')
    await scope.getByRole('radio', { name: 'Whole universe' }).click()
    await expect(table.getByRole('rowheader')).toHaveCount(2)
    await tidy(page)
    await page.screenshot({ path: `${shots}/progression-scope-${scheme}.png` })

    // The plain list says the same.
    await sheet(page).getByRole('button', { name: 'Table view' }).click()
    await expect(
      sheet(page).getByRole('list', { name: 'Elena Vasquez chapter by chapter' }),
    ).toContainText('1 scene')
    expect(await seriousViolations(page)).toEqual([])
  })

  test(`the timeline: scenes on story time with a year before the calendar starts, zoom, and the whole universe, in the ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    const { base } = await seeded(page)
    await page.getByRole('link', { name: 'Continuity' }).click()
    await page.getByRole('radio', { name: 'Timeline' }).click()

    // This book: two scenes in order, by the day. Zoom out to the year and the era, and back in.
    await expect(page.getByRole('status').filter({ hasText: 'in Tidal Reckoning' })).toContainText(
      '2 scenes',
    )
    await expect(
      page.getByRole('button', { name: /14 Heat 412 TR.*The Lantern Gate/ }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /20 Heat 412 TR.*Broken Glass/ })).toBeVisible()
    await page.getByRole('radio', { name: 'Day' }).click()
    await expect(page.getByRole('button', { name: /^14 Heat 412 TR · / })).toBeVisible()
    await page.getByRole('radio', { name: 'Era' }).click()
    await expect(page.getByRole('button', { name: /TR · 2 scenes/ })).toBeVisible()
    await page.getByRole('radio', { name: 'Year' }).click()
    // Down moves from a group to its first row.
    await page.getByRole('button', { name: /^412 TR · / }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('button', { name: /1\.1 · The Lantern Gate/ })).toBeFocused()

    // The whole universe: the second book's scene has no time, so it is listed apart.
    await page.getByRole('radio', { name: 'Whole universe' }).click()
    await expect(page.getByText(/^2 books · 2 chapters/)).toBeVisible()
    await page.getByText('No time listed (1)').click()
    await tidy(page)
    await page.screenshot({ path: `${shots}/timeline-${scheme}.png` })
    expect(await seriousViolations(page)).toEqual([])

    // Give that scene a date 44 years before the calendar starts, from its inspector: the file holds "-44".
    await page.getByRole('button', { name: /Home Water/ }).click()
    await expect(page).toHaveURL(new RegExp(`/${SCENE_C}$`))
    const time = page
      .getByRole('complementary', { name: 'Scene inspector' })
      .getByRole('region', { name: 'Story time' })
    await time.getByRole('combobox', { name: 'Calendar' }).click()
    await page.getByRole('option', { name: 'Tidal Reckoning' }).click()
    const when = time.getByRole('group', { name: 'When' })
    await when.getByLabel('Year').fill('44')
    await when.getByRole('combobox', { name: 'Before or after' }).click()
    await page.getByRole('option', { name: 'before TR' }).click()
    await expect(time.getByText('Known to the year')).toBeVisible()
    await waitSaved(page)
    expect(await opfs.read(page, `${base}/books/${BOOK2}/scenes/${SCENE_C}.md`)).toContain(
      'at: "-44"',
    )

    // On the timeline it comes first, under "before TR", ahead of the scenes of 412 TR.
    await page.getByRole('link', { name: 'Continuity' }).click()
    await page.getByRole('radio', { name: 'Timeline' }).click()
    await page.getByRole('radio', { name: 'Whole universe' }).click()
    await page.getByRole('radio', { name: 'Era' }).click()
    const groups = page.getByRole('heading', { level: 3 })
    await expect(groups).toHaveText(
      [/before TR/, /^\s*▾?\s*TR/].map((r) => r) as unknown as string[],
    )
    await page.getByRole('radio', { name: 'Year' }).click()
    await expect(page.getByRole('button', { name: /^44 before TR · / })).toBeVisible()
    await tidy(page)
    await page.screenshot({ path: `${shots}/timeline-universe-${scheme}.png` })
    expect(await seriousViolations(page)).toEqual([])

    // Table view lists the same, in time order.
    await page.getByRole('button', { name: 'Table view' }).click()
    await expect(page.getByRole('table').getByRole('row').nth(1)).toContainText('Home Water')
  })
}

test('a birth date on the sheet finds a character on the page before they were born, and the add-change board says whose progression it shows on', async ({
  page,
}) => {
  await seeded(page)
  // The sheet: Elena was born in 413 TR, a year after she is first on the page.
  await page.getByRole('link', { name: 'World' }).click()
  await page.getByRole('button', { name: 'Elena Vasquez' }).first().click()
  const born = sheet(page).getByRole('group', { name: 'Born' })
  await born.getByRole('combobox', { name: 'Calendar' }).click()
  await page.getByRole('option', { name: 'Tidal Reckoning' }).click()
  await born.getByLabel('Year').fill('413')
  await born.getByLabel('Year').press('Tab')
  await waitSaved(page)

  await page.getByRole('link', { name: 'Continuity' }).click()
  const findings = page.getByRole('complementary', { name: 'Findings' })
  await expect(findings).toContainText('On the page before they were born')
  await expect(findings).toContainText('but was born in 413 TR')
  await findings
    .getByRole('button', { name: /^Mark intended/ })
    .first()
    .click()
  await expect(findings).not.toContainText('On the page before they were born')

  // The add-change board: who it is about, and where it will show.
  await page.getByRole('link', { name: 'Write' }).click()
  const inspector = page.getByRole('complementary', { name: 'Scene inspector' })
  await inspector
    .getByRole('region', { name: 'What changes here' })
    .getByRole('button', { name: 'Add', exact: true })
    .click()
  const board = page.getByRole('dialog', { name: 'What changes in this scene?' })
  await expect(board.getByText('Shows on Elena Vasquez’s progression.')).toBeVisible()
  await board.getByLabel('With').click()
  await page.getByRole('option', { name: 'Tomas Brandt' }).click()
  await expect(
    board.getByText('Shows on Elena Vasquez’s and Tomas Brandt’s progression.'),
  ).toBeVisible()
  expect(await seriousViolations(page)).toEqual([])
})

test('on a phone the progression table fits the screen: no sideways scroll, and point of view said in the words of the cell', async ({
  page,
}) => {
  await seeded(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(page.url().replace(/\/w\/(bok_\w+)\/.*/, `/w/$1/world?record=${ELENA}`))
  await sheet(page).getByRole('tab', { name: 'Progression' }).click()
  await sheet(page).getByRole('radio', { name: 'Whole universe' }).click()
  const table = sheet(page).getByRole('table')
  await expect(table.getByRole('rowheader')).toHaveCount(2)
  await expect(table.getByRole('columnheader', { name: 'Point of view' })).toBeHidden()
  await expect(table.getByRole('row').nth(1)).toContainText('point of view')
  const over = await page.evaluate(() => {
    const t = document.querySelector('table[aria-rowcount]') as HTMLElement
    const wrap = t.parentElement as HTMLElement
    return {
      wrap: wrap.scrollWidth - wrap.clientWidth,
      table: t.getBoundingClientRect().right - window.innerWidth,
    }
  })
  expect(over.wrap).toBeLessThanOrEqual(0)
  expect(over.table).toBeLessThanOrEqual(0)
  expect(await seriousViolations(page)).toEqual([])
})
