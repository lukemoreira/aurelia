// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createBrowserWorkspace, opfs, sceneText, waitSaved } from '../helpers/browser-workspace'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
const shots = 'test-results/m5a-screenshots'

async function serious(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const table = (page: Page) => page.getByRole('table', { name: 'Outline' })
const rowTitle = (page: Page, title: string) =>
  table(page).getByRole('button', { name: new RegExp(`^\\d+\\.\\d+ ${title}$`) })
const rowOf = (page: Page, title: string) =>
  table(page)
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^\\d+\\.\\d+ ${title}$`) }) })
/** The scene titles of the outline table, top to bottom. */
const tableOrder = (page: Page) =>
  table(page)
    .locator('[data-row^="scn_"]')
    .evaluateAll((els) =>
      els.map((e) => e.querySelector('span.truncate')?.textContent?.trim() ?? ''),
    )
/** The scene titles of the corkboard, column by column. */
const corkOrder = (page: Page) =>
  page.locator('[data-card]').evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''))
const details = (page: Page) => page.getByRole('complementary', { name: 'Details' })
const mapDetails = (page: Page) => page.getByRole('complementary', { name: 'Story map details' })
const node = (page: Page, title: string) =>
  page
    .getByRole('group', { name: 'Story map' })
    .getByRole('button', { name: new RegExp(`^${title}`) })

async function newRecord(page: Page, item: string, name: string) {
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: item }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(name)
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).press('Enter')
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** Select a scene in the plan and give it a title from the details beside it. */
async function titleSelected(page: Page, title: string) {
  const field = details(page).getByLabel('Title', { exact: true })
  await expect(field).toHaveValue(/^Untitled scene/) // the new scene is the selected one
  await field.fill(title)
  await field.press('Tab')
  await expect(rowTitle(page, title)).toBeVisible()
}

for (const scheme of ['light', 'dark'] as const) {
  test(`plan a small book in the outline table and on the corkboard in the ${scheme} theme: add, edit in place, reorder by drag and keyboard, arcs — and it survives a reload`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page, 'My Writing')
    await page.getByRole('link', { name: 'World' }).click()
    await newRecord(page, 'New arc', 'The Debt')
    await newRecord(page, 'New arc', 'Rising Tide')

    await page.getByRole('link', { name: 'Plan' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible()
    await expect(table(page)).toBeVisible()
    await expect(rowTitle(page, 'Untitled scene')).toBeVisible()
    await expect(page.getByText('Nothing selected')).toBeVisible()

    // Add scenes (the new one is selected, its details open beside the table) and name them there.
    await rowTitle(page, 'Untitled scene').click()
    await titleSelected(page, 'Arrival')
    await page.getByRole('button', { name: 'Scene', exact: true }).click()
    await titleSelected(page, 'Gate')
    await page.getByRole('button', { name: 'Scene', exact: true }).click()
    await titleSelected(page, 'Harbour')
    await expect.poll(() => tableOrder(page)).toEqual(['Arrival', 'Gate', 'Harbour'])
    // What is selected in the plan is lit in the navigator too.
    await expect(
      page.getByRole('tree', { name: 'Books' }).getByRole('treeitem', { name: /^Harbour/ }),
    ).toHaveAttribute('aria-selected', 'true')

    // Edit in place: a status, and the arcs a scene advances.
    await table(page).getByLabel('Status of Gate').selectOption('draft')
    await expect(table(page).getByLabel('Status of Gate')).toHaveValue('draft')
    await table(page)
      .getByRole('button', { name: /Arcs of Gate/ })
      .click()
    await page.getByRole('checkbox', { name: 'The Debt' }).click()
    await page.getByRole('checkbox', { name: 'Rising Tide' }).click()
    await page.keyboard.press('Escape')
    await expect(
      table(page).getByRole('button', { name: /Arcs of Gate: Rising Tide The Debt/ }),
    ).toBeVisible()
    await table(page)
      .getByRole('button', { name: /Arcs of Harbour/ })
      .click()
    await page.getByRole('checkbox', { name: 'The Debt' }).click()
    await page.keyboard.press('Escape')
    await waitSaved(page)
    await page.screenshot({ path: `${shots}/outline-table-${scheme}.png` })
    expect(await serious(page)).toEqual([])

    // Reorder by drag (Harbour before Arrival) and by keyboard (Alt+↑ on Gate).
    await rowOf(page, 'Harbour').dragTo(rowOf(page, 'Arrival'), {
      sourcePosition: { x: 4, y: 22 },
      targetPosition: { x: 4, y: 3 },
    })
    await expect.poll(() => tableOrder(page)).toEqual(['Harbour', 'Arrival', 'Gate'])
    await rowTitle(page, 'Gate').focus()
    await rowTitle(page, 'Gate').press('Alt+ArrowUp')
    await expect.poll(() => tableOrder(page)).toEqual(['Harbour', 'Gate', 'Arrival'])
    await expect(rowTitle(page, 'Gate')).toBeFocused() // the keyboard stays with the row it moved

    // The corkboard: the same book as cards, coloured by arc.
    await page.getByRole('radio', { name: 'Corkboard' }).click()
    await expect.poll(() => corkOrder(page)).toEqual(['Harbour', 'Gate', 'Arrival'])
    await expect(
      page.getByRole('list', { name: 'Colours' }).getByRole('button', { name: 'The Debt' }),
    ).toBeVisible()
    await page.screenshot({ path: `${shots}/corkboard-${scheme}.png` })
    expect(await serious(page)).toEqual([])

    // Reorder cards by drag and by keyboard; the manuscript follows.
    const card = (title: string) =>
      page
        .locator('li[draggable="true"]')
        .filter({ has: page.locator('[data-card]', { hasText: title }) })
    await card('Arrival').dragTo(card('Harbour'), {
      sourcePosition: { x: 60, y: 30 },
      targetPosition: { x: 60, y: 4 },
    })
    await expect.poll(() => corkOrder(page)).toEqual(['Arrival', 'Harbour', 'Gate'])
    await page.locator('[data-card]').filter({ hasText: 'Gate' }).press('Alt+ArrowUp')
    await expect.poll(() => corkOrder(page)).toEqual(['Arrival', 'Gate', 'Harbour'])
    await expect(page.locator('[data-card]').filter({ hasText: 'Gate' })).toBeFocused()

    // Colour by status, and the arc as a thread: its details list the scenes that advance it.
    await page.getByRole('combobox', { name: 'Colour cards by' }).click()
    await page.getByRole('option', { name: 'Colour by: Status' }).click()
    await expect(page.getByRole('list', { name: 'Colours' }).getByText('Draft')).toBeVisible()
    await page.getByRole('combobox', { name: 'Colour cards by' }).click()
    await page.getByRole('option', { name: 'Colour by: Arc' }).click()
    await page
      .getByRole('list', { name: 'Colours' })
      .getByRole('button', { name: 'The Debt' })
      .click()
    const arc = details(page).getByRole('region', { name: 'Arc' })
    await expect(arc.getByRole('heading', { level: 2, name: 'The Debt' })).toBeVisible()
    await expect(arc.getByText('2 scenes · 1 book')).toBeVisible()
    await arc.getByRole('button', { name: 'Ember' }).click()
    await expect(arc.getByRole('button', { name: 'Ember' })).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: `${shots}/arc-inspector-${scheme}.png` })

    // A scene's details: the fields of the spec, saved as the author leaves each.
    await page.locator('[data-card]').filter({ hasText: 'Gate' }).click()
    const form = details(page).getByRole('form', { name: 'Scene' })
    await form.getByLabel('Objective').fill('Get through before curfew.')
    await form.getByLabel('Objective').press('Tab')
    await form.getByLabel('Word target').fill('1800')
    await form.getByLabel('Word target').press('Tab')
    await waitSaved(page)
    await page.screenshot({ path: `${shots}/plan-inspector-${scheme}.png` })

    // Everything is in the files, and it all survives a reload.
    const files = await opfs.list(page)
    const gate = files.find((f) => /scenes\/scn_/.test(f) && f)
    expect(gate).toBeTruthy()
    await page.reload()
    await expect.poll(() => corkOrder(page)).toEqual(['Arrival', 'Gate', 'Harbour']) // the view too
    await page.getByRole('radio', { name: 'Outline' }).click()
    await expect(table(page).getByLabel('Status of Gate')).toHaveValue('draft')
    await expect(
      table(page).getByRole('button', { name: /Arcs of Gate: Rising Tide The Debt/ }),
    ).toBeVisible()
  })

  test(`build a branching book in the ${scheme} theme: choices, an ending, a story map with its problems, one marked intended, and play it from the start`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await createBrowserWorkspace(page, 'My Game')
    await sceneText(page).fill('You wake on the shingle.\n\nThe wreck groans behind you.')
    await waitSaved(page)

    // A straight story has no story map; the Book tab switches it to a branching one.
    await expect(page.getByRole('link', { name: 'Story map' })).toHaveCount(0)
    const inspector = page.getByRole('complementary', { name: 'Scene inspector' })
    await inspector.getByRole('tab', { name: 'Book' }).click()
    await inspector.getByRole('switch', { name: /branching story/i }).click()
    await page.getByRole('link', { name: 'Story map' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Story map' })).toBeVisible()
    await expect(mapDetails(page).getByText('No scene is marked as an ending')).toBeVisible()
    // Its button does not mark the start as an ending: it takes the keyboard to the new-choice field.
    await mapDetails(page).getByRole('button', { name: 'Add a choice', exact: true }).click()
    await expect(mapDetails(page).getByLabel('New choice')).toBeFocused()
    await expect(mapDetails(page).getByText('The reader starts here.')).toBeVisible()

    // Two choices from the start, each into a new scene, made as the choice is added.
    const add = async (label: string) => {
      await mapDetails(page).getByLabel('New choice').fill(label)
      await mapDetails(page).getByRole('button', { name: 'Add choice' }).click()
      await expect(node(page, label)).toBeVisible()
    }
    await add('Follow the lights')
    await add('Hide in the wreck')
    // From one of them, one more; that scene is an ending.
    await node(page, 'Follow the lights').click()
    await add('Climb the cliff path')
    await node(page, 'Climb the cliff path').click()
    await mapDetails(page).getByRole('switch', { name: 'This scene is an ending' }).click()
    await expect(node(page, 'Climb the cliff path')).toContainText('Ending')
    // "Hide in the wreck" has no choices and is not an ending: a dead end, in words.
    const problems = mapDetails(page).getByRole('region', { name: /Problems/ })
    await expect(problems.getByText('Dead end', { exact: true })).toBeVisible()
    await expect(problems.getByText('Warning').first()).toBeVisible()
    await expect(
      problems.getByText('“Hide in the wreck” has no choices and is not marked as an ending.'),
    ).toBeVisible()
    await expect(node(page, 'Hide in the wreck')).toContainText('dead end')
    await waitSaved(page)
    await page.screenshot({ path: `${shots}/story-map-${scheme}.png` })
    expect(await serious(page)).toEqual([])

    // Delete the ending: the choice that led to it is broken, said as an Error.
    const tree = page.getByRole('tree', { name: 'Books' })
    await tree.getByRole('treeitem', { name: /Climb the cliff path/ }).hover()
    await page.getByRole('button', { name: 'Actions for Climb the cliff path' }).click()
    await page.getByRole('menuitem', { name: /^Delete/ }).click()
    await expect(problems.getByText('Error', { exact: true })).toBeVisible()
    await expect(
      problems.getByText(
        '“Climb the cliff path” in “Follow the lights” points to a scene that is not there any more.',
      ),
    ).toBeVisible()
    await expect(
      problems.getByRole('button', { name: /^Mark intended: Broken choice/ }),
    ).toHaveCount(0)
    await mapDetails(page).evaluate((el) => (el.scrollTop = 0)) // the list of problems, not the form below it
    await page.screenshot({ path: `${shots}/story-map-findings-${scheme}.png` })
    await page
      .getByRole('status')
      .filter({ hasText: 'Moved “Climb the cliff path”' })
      .getByRole('button', { name: 'Undo' })
      .click()
    await expect(problems.getByText('Error', { exact: true })).toHaveCount(0)

    // Mark the dead end as intended: it goes from the list, and stays gone after a reload.
    await problems.getByRole('button', { name: /^Mark intended: Dead end/ }).click()
    await expect(problems.getByText('Dead end', { exact: true })).toHaveCount(0)
    await expect(problems.getByRole('button', { name: '1 marked as intended' })).toBeVisible()
    await waitSaved(page)
    await page.reload()
    await expect(problems.getByRole('button', { name: '1 marked as intended' })).toBeVisible()
    await expect(problems.getByText('Nothing to fix')).toBeVisible()
    const book = (await opfs.list(page)).find((f) => f.endsWith('book.json'))!
    expect(JSON.parse(await opfs.read(page, book))).toMatchObject({
      mode: 'branching',
      dismissedFindings: [expect.stringMatching(/^dead-end:scn_/)],
    })
    await problems.getByRole('button', { name: '1 marked as intended' }).click()
    await problems.getByRole('button', { name: 'Undo' }).click()
    await expect(problems.getByText('Dead end', { exact: true })).toBeVisible()

    // Play it, start to end, and back.
    await page.getByRole('button', { name: 'Play from start' }).click()
    const play = page.getByRole('region', { name: 'Play' })
    await expect(play.getByRole('heading', { level: 2, name: 'Untitled scene' })).toBeVisible()
    await expect(play.getByText('You wake on the shingle.')).toBeVisible()
    await play.getByRole('button', { name: 'Follow the lights' }).click()
    await expect(play.getByRole('heading', { level: 2, name: 'Follow the lights' })).toBeVisible()
    await play.getByRole('button', { name: 'Climb the cliff path' }).click()
    await expect(play.getByText('The end.')).toBeVisible()
    await page.screenshot({ path: `${shots}/play-${scheme}.png` })
    expect(await serious(page)).toEqual([])
    await play.getByRole('button', { name: 'Previous scene' }).click()
    await expect(play.getByRole('heading', { level: 2, name: 'Follow the lights' })).toBeVisible()
    await play.getByRole('button', { name: 'Go back to Untitled scene' }).click()
    await play.getByRole('button', { name: 'Hide in the wreck' }).click()
    await expect(play.getByText('The story stops here.')).toBeVisible()
    await play.getByRole('button', { name: 'Start again' }).click()
    await expect(play.getByRole('heading', { level: 2, name: 'Untitled scene' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('region', { name: 'Play' })).toHaveCount(0)
    await expect(node(page, 'Follow the lights')).toBeVisible()
    // "Play from here" starts at the selected scene, not at the start.
    await node(page, 'Follow the lights').click()
    await mapDetails(page).getByRole('button', { name: 'Play from here' }).click()
    await expect(play.getByRole('heading', { level: 2, name: 'Follow the lights' })).toBeVisible()
    await expect(play.getByRole('button', { name: 'Previous scene' })).toBeDisabled()
    await play.getByRole('button', { name: 'Back to the map' }).click()
    // Playing wrote nothing: the book is as it was.
    await waitSaved(page)

    // The scene's choices in the writing inspector, and the keyboard on the map.
    await node(page, 'Follow the lights').focus()
    await node(page, 'Follow the lights').press('ArrowDown')
    await expect(node(page, 'Climb the cliff path')).toBeFocused()
    await node(page, 'Climb the cliff path').press('Enter')
    await expect(page).toHaveURL(/\/w\/bok_\w+\/scn_\w+$/)
    await expect(sceneText(page)).toBeVisible()
    await page
      .getByRole('tree', { name: 'Books' })
      .getByRole('treeitem', { name: /Follow the lights/ })
      .click()
    const choices = page
      .getByRole('complementary', { name: 'Scene inspector' })
      .getByRole('region', { name: 'Choices' })
    await expect(choices.getByLabel('Choice 1 text')).toHaveValue('Climb the cliff path')
    // Under the text the choices are read, with where each leads, and "Edit choices" goes to the inspector.
    const under = page.getByRole('main').getByRole('region', { name: 'Choices' })
    await expect(under.getByText('Climb the cliff path')).toBeVisible()
    await expect(under).toContainText('1.4 · Climb the cliff path')
    await under.getByRole('button', { name: 'Edit choices' }).click()
    await expect(choices.getByLabel('New choice')).toBeFocused()
    await choices.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `${shots}/inspector-choices-${scheme}.png`,
      clip: { x: 1120, y: 0, width: 320, height: 900 },
    })
  })
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the sample’s game book shows a story map you can play, and nothing in it can be changed (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/')
    await page.getByRole('button', { name: /Open the sample universe/ }).click()
    await page.getByRole('button', { name: /Switch book/ }).click()
    await page.getByRole('menuitem', { name: 'Salt & Ash' }).click()
    await page.getByRole('link', { name: 'Story map' }).click()
    await expect(page.getByText('11 scenes · 15 choices · 3 endings')).toBeVisible()
    await expect(node(page, 'Washed Ashore')).toContainText('Start')
    await expect(node(page, 'The Drowned Bell')).toContainText('dead end')
    const problems = mapDetails(page).getByRole('region', { name: /Problems/ })
    await expect(problems.getByText('Unreachable', { exact: true })).toBeVisible()
    await expect(problems.getByRole('button', { name: /Mark intended/ })).toHaveCount(0) // a tour: read only
    await expect(mapDetails(page).getByRole('button', { name: 'Add choice' })).toHaveCount(0)
    await page.screenshot({ path: `${shots}/story-map-sample-${scheme}.png` })
    expect(await serious(page)).toEqual([])
    await page.getByRole('button', { name: 'Play from start' }).click()
    await page
      .getByRole('region', { name: 'Play' })
      .getByRole('button', { name: 'Hide in the wreck' })
      .click()
    await expect(page.getByRole('heading', { level: 2, name: 'Hide in the Wreck' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to the map' }).click()

    // The plan of the same book, on the corkboard, with its arcs across the universe's books.
    await page.getByRole('link', { name: 'Plan' }).click()
    await expect(page.getByRole('button', { name: 'Scene', exact: true })).toHaveCount(0)
    await page.getByRole('radio', { name: 'Corkboard' }).click()
    await expect(page.locator('[data-card]').first()).toBeVisible()
    await page
      .getByRole('list', { name: 'Colours' })
      .getByRole('button', { name: 'Rising Tide' })
      .click()
    const arc = details(page).getByRole('region', { name: 'Arc' })
    await expect(arc.getByRole('heading', { level: 4 })).toHaveText([
      'The Lantern Gate',
      'Tidebound',
      'Salt & Ash',
    ])
    await page.screenshot({ path: `${shots}/arc-across-books-${scheme}.png` })
  })
}

test('a straight book reaches the story map from the palette, and a new book can start out branching', async ({
  page,
}) => {
  await createBrowserWorkspace(page, 'My Writing')
  await expect(page.getByRole('link', { name: 'Story map' })).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('combobox').fill('branching')
  await page.getByRole('option', { name: /Make this a branching story/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Story map' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Story map' })).toBeVisible()

  // A straight book opened by its address says so and offers the way.
  await page.getByRole('button', { name: 'Add to the book' }).click()
  await page.getByRole('menuitem', { name: 'New book' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name', { exact: true }).fill('The Novel')
  await dialog.getByRole('button', { name: 'Create book' }).click()
  await expect(page).toHaveURL(/\/scn_\w+$/) // the new book is open
  await expect(page.getByRole('link', { name: 'Story map' })).toHaveCount(0) // straight, by default
  await page.goto(page.url().replace(/\/scn_\w+$/, '/map'))
  await expect(page.getByText('This book is a straight story')).toBeVisible()
  expect(await serious(page)).toEqual([])
  await page.getByRole('button', { name: 'Make it a branching story' }).click()
  await expect(page.getByRole('group', { name: 'Story map' })).toBeVisible()

  // The same dialog can start a book as a branching story.
  await page.getByRole('button', { name: 'Add to the book' }).click()
  await page.getByRole('menuitem', { name: 'New book' }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('The Game')
  await page
    .getByRole('dialog')
    .getByRole('switch', { name: /branching story/i })
    .click()
  await page.getByRole('dialog').getByRole('button', { name: 'Create book' }).click()
  await expect(page.getByRole('link', { name: 'Story map' })).toBeVisible()
})
