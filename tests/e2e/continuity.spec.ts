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
const shots = 'test-results/m5b-screenshots'

/** A record file, as the app writes one. */
const record = (id: string, type: string, title: string, extra = '') =>
  `---\ntitle: "${title}"\nschemaVersion: 1\nid: "${id}"\ntype: "${type}"\nscope: "universe"\n${extra}---\n\n`

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Scene inspector' })
const changes = (page: Page) => inspector(page).getByRole('region', { name: 'What changes here' })
const board = (page: Page) => page.getByRole('dialog', { name: 'What changes in this scene?' })
const findings = (page: Page) => page.getByRole('complementary', { name: 'Findings' })
const presence = (page: Page) => page.getByRole('table', { name: /Who is on the page/ })
const card = (page: Page, name: string) =>
  page.getByRole('complementary', { name: `Preview of ${name}` })

/** A workspace with two characters, an item and a scene that names them, put in place like another app would. */
async function seeded(page: Page) {
  await createBrowserWorkspace(page, 'Saltmarch')
  const path = await firstScenePath(page)
  const base = path.slice(0, path.indexOf('/books/'))
  const file = await opfs.read(page, path)
  const text = 'Elena Vasquez met Tomas Brandt at the gate, and neither of them spoke.'
  await opfs.write(page, path, `${file.slice(0, file.indexOf('\n---\n') + 5)}\n${text}\n`)
  const put = (folder: string, id: string, body: string) =>
    opfs.write(page, `${base}/records/${folder}/${id}.md`, body)
  await put(
    'characters',
    'chr_elena00001',
    record('chr_elena00001', 'character', 'Elena Vasquez', 'color: "ember"\n'),
  )
  await put(
    'characters',
    'chr_tomas00001',
    record('chr_tomas00001', 'character', 'Tomas Brandt', 'color: "tide"\n'),
  )
  await put('items', 'itm_key0000001', record('itm_key0000001', 'item', 'The Lantern Key'))
  await page.reload()
  await expect(sceneText(page)).toContainText('Elena Vasquez met Tomas Brandt')
  return { path }
}

for (const scheme of ['light', 'dark'] as const) {
  test(`record changes and a story time, see who is on the page and a finding, mark it intended, and read the state at a scene — ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    const { path } = await seeded(page)

    // Story time: a new calendar, and a time to the minute. It is in the file as a key, not as words.
    const calendar = inspector(page).getByRole('region', { name: 'Story time' })
    const when = calendar.getByRole('group', { name: 'When' })
    await expect(when.getByLabel('Year')).toBeDisabled() // a time is read in a calendar: pick one first
    await expect(calendar.getByText('Pick a calendar first')).toBeVisible()
    await calendar.getByRole('combobox', { name: 'Calendar' }).click()
    await page.getByRole('option', { name: 'A new calendar…' }).click()
    await calendar.getByLabel('Name of the calendar').fill('Tidal Reckoning')
    await calendar.getByLabel('Era (optional)').fill('TR')
    await when.getByLabel('Year').fill('412')
    await when.getByRole('combobox', { name: 'Month' }).click()
    await page.getByRole('option', { name: '3', exact: true }).click()
    await when.getByLabel('Day').fill('14')
    await when.getByLabel('Time').fill('18:00')
    await when.getByLabel('Time').press('Tab')
    await expect(calendar.getByText('Known to the minute')).toBeVisible()
    await waitSaved(page)
    expect(await opfs.read(page, path)).toContain('at: "412-03-14T18:00"')

    // "What changes here": Tomas dies, in plain words. Elena learns something and gains the key.
    await changes(page).getByRole('button', { name: 'Add', exact: true }).click()
    await expect(board(page)).toBeVisible()
    await board(page)
      .getByRole('button', { name: /Tomas Brandt/ })
      .click()
    await board(page).getByText('Dies, leaves or returns').click()
    // a kind picked with the mouse takes the keyboard to its first field
    await expect(board(page).getByRole('combobox', { name: 'What happens' })).toBeFocused()
    await expect(board(page).getByText('2. What happens to Tomas Brandt?')).toBeVisible()
    await page.screenshot({ path: `${shots}/add-change-${scheme}.png` })
    expect(await seriousViolations(page)).toEqual([])
    await board(page).getByRole('button', { name: 'Add change' }).click()
    await expect(board(page)).toBeHidden()
    await expect(changes(page)).toContainText('Status')
    await expect(changes(page)).toContainText('Tomas Brandt dies')

    await changes(page).getByRole('button', { name: 'Add', exact: true }).click()
    await board(page)
      .getByRole('button', { name: /Elena Vasquez/ })
      .click()
    await board(page).getByText('Learns something').click()
    await board(page).getByLabel('What they learn').fill('Tomas keeps a second ledger')
    await board(page).getByRole('button', { name: 'Add change' }).click()
    await changes(page).getByRole('button', { name: 'Add', exact: true }).click()
    await board(page)
      .getByRole('button', { name: /Elena Vasquez/ })
      .click()
    await board(page).getByText('Gains or loses an item').click()
    await board(page).getByRole('combobox', { name: 'Item' }).click()
    await page.getByRole('option', { name: 'The Lantern Key' }).click()
    await board(page).getByRole('button', { name: 'Add change' }).click()
    await expect(changes(page)).toContainText('Learns')
    await expect(changes(page)).not.toContainText('knows') // the stored word never reaches the screen
    expect(await opfs.read(page, path)).toContain('kind: "knows"')
    await expect(changes(page)).toContainText('Elena Vasquez gains The Lantern Key')
    await expect(changes(page)).toContainText('Elena Vasquez learns: Tomas keeps a second ledger')
    // removing one has an Undo, and it comes back where it was
    await changes(page)
      .getByRole('button', { name: /^Remove change: .*gains The Lantern Key/ })
      .click()
    await expect(changes(page)).not.toContainText('gains The Lantern Key')
    await page
      .getByRole('status')
      .filter({ hasText: 'Removed a change.' })
      .getByRole('button', { name: 'Undo' })
      .click()
    await expect(changes(page)).toContainText('Elena Vasquez gains The Lantern Key')

    // "Mark as change": words selected in the text, then the shortcut, start the board with them as the quote
    await page.evaluate(() => {
      const phrase = 'neither of them spoke'
      const walk = document.createTreeWalker(
        document.querySelector('.manuscript .ProseMirror')!,
        NodeFilter.SHOW_TEXT,
      )
      let node = walk.nextNode() as Text | null
      while (node && !node.data.includes(phrase)) node = walk.nextNode() as Text | null
      const at = node!.data.indexOf(phrase)
      const range = document.createRange()
      range.setStart(node!, at)
      range.setEnd(node!, at + phrase.length)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    })
    await page.keyboard.press('ControlOrMeta+Alt+KeyM')
    await expect(board(page)).toBeVisible()
    await expect(board(page).getByLabel('Quote from the scene (optional)')).toHaveValue(
      'neither of them spoke',
    )
    await board(page).getByText('A belief or trait changes').click()
    await board(page)
      .getByRole('textbox', { name: 'Belief or trait' })
      .fill('They distrust each other')
    await board(page).getByRole('button', { name: 'Add change' }).click()
    await expect(changes(page)).toContainText('They distrust each other')
    // the palette has it too
    await page.keyboard.press('ControlOrMeta+KeyK')
    await page.getByRole('combobox').fill('add a change')
    await page.keyboard.press('Enter')
    await expect(board(page)).toBeVisible()
    await board(page).getByRole('button', { name: 'Cancel' }).click()
    await waitSaved(page)
    expect(await opfs.read(page, path)).toContain('quote: "neither of them spoke"')

    // The state at this scene, beside it, with where each thing began.
    const state = inspector(page).getByRole('region', { name: 'State at this scene' })
    await expect(state).toContainText('Dead since 1.1')
    await expect(state).toContainText('Tomas keeps a second ledger')
    await state.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${shots}/inspector-state-${scheme}.png` })

    // A second chapter, where Tomas is linked: the card says he is dead, and the scene has a finding.
    const first = page.url()
    await page.getByRole('button', { name: 'Add to the book' }).click()
    await page.getByRole('menuitem', { name: 'New chapter' }).click()
    await expect(page.getByRole('button', { name: 'Add to the book' })).toBeFocused()
    await expect(page).not.toHaveURL(first) // the new chapter's scene is open, and empty
    await expect(sceneText(page)).not.toContainText('Elena Vasquez')
    await expect(page.getByText('Chapter Two · Scene 1')).toBeVisible()
    await sceneText(page).fill('Then [[Tomas Brandt]] walked back in, as if nothing had happened.')
    await waitSaved(page)
    const note = inspector(page).getByRole('note')
    await expect(note).toContainText('Appears after death or exit')
    await expect(note).toContainText('Tomas Brandt is dead since 1.1')
    // the note is neutral: the severity is the word in it, and Review shows this scene's findings alone
    await expect(note.getByText('Error', { exact: true })).toBeVisible()
    await expect(
      inspector(page).getByRole('region', { name: 'State at this scene' }),
    ).toContainText('Dead since 1.1')
    await page.locator('.manuscript .aur-link', { hasText: '[[Tomas Brandt]]' }).hover()
    await expect(card(page, 'Tomas Brandt')).toBeVisible()
    await expect(card(page, 'Tomas Brandt')).toContainText('At this scene')
    await expect(card(page, 'Tomas Brandt')).toContainText('Dead since 1.1')
    await page.screenshot({ path: `${shots}/link-card-state-${scheme}.png` })
    expect(await seriousViolations(page)).toEqual([])
    await page.mouse.move(5, 5)

    // Continuity: from the scene's note, with this scene's findings alone (Show all brings back the rest).
    await note.getByRole('button', { name: 'Review in Continuity' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Continuity' })).toBeVisible()
    await expect(findings(page)).toContainText('Findings for 2.1 · Untitled scene')
    await findings(page).getByRole('button', { name: 'Show all' }).click()
    await expect(findings(page)).not.toContainText('Findings for 2.1')
    await expect(page.getByRole('group', { name: 'Chapters' }).getByRole('status')).toHaveText(
      'Chapters 1–2',
    )
    const row = presence(page)
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: /Tomas Brandt/ }) })
    // the words of the cells (the marks beside them are only for the eyes)
    await expect(row.locator('td .sr-only')).toHaveText([
      'On the page, dies',
      'On the page, finding',
    ])
    await expect(presence(page).getByRole('columnheader', { name: 'Chapter 2' })).toBeVisible()
    await expect(
      presence(page)
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader', { name: /Elena Vasquez/ }) })
        .locator('td .sr-only'),
    ).toHaveText(['On the page', 'Not present'])
    const finding = findings(page)
      .getByRole('listitem')
      .filter({ hasText: 'Appears after death or exit' })
    await expect(finding).toContainText('Error')
    await expect(finding).toContainText(
      'Tomas Brandt is dead since 1.1 · Untitled scene, but appears in 2.1 · Untitled scene.',
    )
    await page.screenshot({ path: `${shots}/continuity-${scheme}.png` })
    await presence(page).screenshot({ path: `${shots}/presence-table-${scheme}.png` })
    await findings(page).screenshot({ path: `${shots}/findings-${scheme}.png` })
    expect(await seriousViolations(page)).toEqual([])

    // A finding's cell is a button: it says what it is under the map and takes the keyboard to the finding.
    await row.getByRole('button', { name: /finding/ }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Tomas Brandt, chapter 2:' }),
    ).toBeVisible()
    await expect(finding).toBeFocused()

    // The same data as plain lines.
    await page.getByRole('button', { name: 'Table view' }).first().click()
    await expect(page.getByRole('list', { name: 'Who is on the page' })).toContainText(
      'Tomas Brandt',
    )
    await expect(page.getByRole('list', { name: 'Who is on the page' })).toContainText(
      'chapter 2: on the page, finding',
    )
    await page.getByRole('button', { name: 'Table view' }).first().click()

    // Open the scene at the place, and come back.
    await finding.getByRole('button', { name: 'Go to 2.1' }).click()
    await expect(page).toHaveURL(/\/w\/bok_\w+\/scn_\w+$/)
    await expect(sceneText(page)).toContainText('walked back in')
    // at the place: the name is selected in the text, and the text has the keyboard
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toContain('Tomas Brandt')
    await expect(page.locator('.manuscript .ProseMirror')).toBeFocused()
    await page.getByRole('link', { name: 'Continuity' }).click()

    // Mark it intended: it goes from the list, is counted, and is still marked after a reload.
    await findings(page)
      .getByRole('button', { name: /^Mark intended: Appears after death or exit/ })
      .click()
    await expect(findings(page).getByText('Nothing to fix here')).toBeVisible()
    await expect(findings(page).getByRole('button', { name: '1 marked as intended' })).toBeVisible()
    await waitSaved(page)
    const book = (await opfs.list(page)).find((f) => f.endsWith('book.json'))!
    expect(await opfs.read(page, book)).toMatch(/"appears-after-exit:/)
    await page.reload()
    await expect(findings(page).getByRole('button', { name: '1 marked as intended' })).toBeVisible()
    await expect(findings(page).getByText('Nothing to fix here')).toBeVisible()
  })

  test(`the Continuity view on a phone puts the findings first, with a narrow name column and no sideways page — ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/')
    await page.getByRole('button', { name: /Open the sample universe/ }).click()
    await page.getByRole('link', { name: 'Continuity' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(presence(page)).toBeVisible()
    const above = await findings(page).boundingBox()
    const map = await presence(page).boundingBox()
    expect(above!.y).toBeLessThan(map!.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    const name = await presence(page)
      .getByRole('columnheader', { name: 'Characters' })
      .boundingBox()
    expect(name!.width).toBeLessThanOrEqual(140)
    await page.screenshot({ path: `${shots}/continuity-phone-${scheme}.png` })
    expect(await seriousViolations(page)).toEqual([])
  })

  test(`the sample’s Lantern Gate shows its time line, its two findings and a state at Curfew Bells — ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/')
    await page.getByRole('button', { name: /Open the sample universe/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Curfew Bells' })).toBeVisible()
    const state = inspector(page).getByRole('region', { name: 'State at this scene' })
    await expect(state).toContainText('Tomas Brandt')
    await expect(state).toContainText('creditor') // the relationship as it is now
    await expect(inspector(page).getByRole('note')).toContainText('Two places at once')
    await page.screenshot({ path: `${shots}/sample-write-${scheme}.png` })

    await page.getByRole('link', { name: 'Continuity' }).click()
    await expect(presence(page)).toBeVisible()
    await expect(
      findings(page).getByRole('listitem').filter({ hasText: 'Two places at once' }),
    ).toContainText('Warning')
    await expect(
      findings(page).getByRole('listitem').filter({ hasText: 'Set-up without pay-off' }),
    ).toContainText('Note')
    await expect(
      page.getByRole('img', { name: /Story time for each scene in reading order/ }),
    ).toBeVisible()
    // The sample is a tour: nothing here can be changed.
    await expect(findings(page).getByRole('button', { name: /^Mark intended/ })).toHaveCount(0)
    await page.screenshot({ path: `${shots}/sample-continuity-${scheme}.png` })
    expect(await seriousViolations(page)).toEqual([])
  })
}
