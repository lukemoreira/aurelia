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
const shots = 'test-results/m3b-screenshots'
const MOD = 'ControlOrMeta'

const ELENA = 'chr_elena00001'
const WILL = 'chr_will000001'
const GATE = 'plc_gate000001'

/** A record file, as the app writes one. */
const record = (id: string, type: string, title: string, extra = '', notes = '') =>
  `---\ntitle: "${title}"\nschemaVersion: 1\nid: "${id}"\ntype: "${type}"\nscope: "universe"\n${extra}---\n\n${notes}`

const SCENE = [
  'Elena reached the Lantern Gate. Elenath waited, and elena@example.com wrote.',
  'Will you stop? Corin swam, and Elena’s hand shook. See [[Elena Vasquez]] and again.',
  '![[Lantern Gate]]',
].join('\n\n')

/** A workspace with three records and a scene, put in place the way another app would, then opened fresh. */
async function seeded(page: Page, scene = SCENE) {
  await createBrowserWorkspace(page, 'Saltmarch')
  const path = await firstScenePath(page)
  const base = path.slice(0, path.indexOf('/books/'))
  const file = await opfs.read(page, path)
  await opfs.write(page, path, `${file.slice(0, file.indexOf('\n---\n') + 5)}\n${scene}\n`)
  const put = (folder: string, id: string, text: string) =>
    opfs.write(page, `${base}/records/${folder}/${id}.md`, text)
  await put(
    'characters',
    ELENA,
    record(
      ELENA,
      'character',
      'Elena Vasquez',
      'summary: "A smuggler’s daughter."\naliases:\n  - { text: "Elena" }\n  - { text: "Lena" }\n',
      'Owes everyone.',
    ),
  )
  await put(
    'characters',
    WILL,
    record(WILL, 'character', 'Will Ashby', 'aliases:\n  - { text: "Will" }\n'),
  )
  await put(
    'characters',
    'chr_corin00001',
    record('chr_corin00001', 'character', 'Corin', 'summary: "A boy."\n'),
  )
  await put(
    'places',
    'plc_corin00001',
    record('plc_corin00001', 'place', 'Corin', 'summary: "A river."\n'),
  )
  await put(
    'places',
    GATE,
    record(GATE, 'place', 'Lantern Gate', 'summary: "Where the curfew is kept."\n'),
  )
  await page.reload()
  await expect(sceneText(page)).toContainText('Elena reached the Lantern Gate')
  return { path, base }
}

/** The caret at the end of paragraph `n` of the editor on the page (⌘End scrolls on a Mac and does not move it). */
const caretAtEnd = async (page: Page, n: number) => {
  await page.evaluate((i) => {
    const dom = document.querySelector('.manuscript .ProseMirror') as HTMLElement & {
      editor: {
        state: { doc: { child(i: number): { nodeSize: number } } }
        commands: { focus(position: number): void }
      }
    }
    let pos = 0
    for (let k = 0; k <= i; k++) pos += dom.editor.state.doc.child(k).nodeSize
    dom.editor.commands.focus(pos - 1)
  }, n)
  // The editor takes focus a frame later: keys typed before that are lost.
  await expect(page.locator('.manuscript .ProseMirror')).toBeFocused()
}

/** The caret just after the first `word` in the text (plus `back` characters), with the editor focused. */
const caretAfter = async (page: Page, word: string, back = 0) => {
  await page.evaluate(
    ([w, b]) => {
      const dom = document.querySelector('.manuscript .ProseMirror') as HTMLElement & {
        editor: {
          state: {
            doc: {
              descendants(
                f: (n: { isText: boolean; text?: string }, pos: number) => boolean | void,
              ): void
            }
          }
          commands: { focus(position: number): void }
        }
      }
      let at = -1
      dom.editor.state.doc.descendants((n, pos) => {
        const i = n.isText ? n.text!.indexOf(w as string) : -1
        if (at < 0 && i >= 0) at = pos + i + (w as string).length + (b as number)
      })
      dom.editor.commands.focus(at)
    },
    [word, back],
  )
  await expect(page.locator('.manuscript .ProseMirror')).toBeFocused()
  // The editor sets the caret a frame after it takes focus: the keys come after that.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  )
  // A step of the caret, as a reader's arrow key makes it: a card opens for the caret only then.
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(150) // the editor reads the browser's selection a moment later: two keys at once cancel out
  await page.keyboard.press('ArrowRight')
}

const card = (page: Page, name: string) =>
  page.getByRole('complementary', { name: `Preview of ${name}` })
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Scene inspector' })
const showNames = (page: Page) => page.getByRole('switch', { name: 'Show names' })

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
    })

    test('link a character with [[, see its card, follow it, and find the backlink', async ({
      page,
    }) => {
      await seeded(page)
      // [[ opens the picker; the keys stay in the text.
      // The caret at the end of the second paragraph (the middle of the editor is an embed card: a click there opens it).
      await caretAtEnd(page, 1)
      await page.keyboard.type(' Then [[lan')
      const list = page.getByRole('listbox', { name: 'Link to' })
      await expect(list).toBeVisible()
      await expect(list.getByRole('option')).toHaveText([/Lantern Gate\s*Place/])
      await page.screenshot({ path: `${shots}/autocomplete-${scheme}.png` })
      expect(await seriousViolations(page)).toEqual([])
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.keyboard.type('ele')
      await expect(list.getByRole('option').first()).toContainText('Elena Vasquez')
      await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Enter')
      await expect(sceneText(page)).toContainText('Then [[Elena Vasquez]]')
      await expect(list).toBeHidden()
      await waitSaved(page)

      // Two things called Corin: the picker writes the ID.
      await page.keyboard.type(' and [[cor')
      await expect(list.getByRole('option')).toHaveCount(2)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      // The text holds the address; the page does not show it: a link by ID reads as its label.
      await expect(sceneText(page)).toContainText('[[Corin]]', { useInnerText: true })
      await expect(sceneText(page)).not.toContainText('plc_corin00001', { useInnerText: true })
      await expect(page.locator('.manuscript .aur-id')).toHaveCount(1)
      await waitSaved(page)
      const saved = await opfs.read(page, await firstScenePath(page))
      expect(saved).toContain('[[id:plc_corin00001|Corin]]')

      // Hovering a link opens its card, and the card does not trap anything.
      const link = page.locator('.manuscript .aur-link', { hasText: '[[Elena Vasquez]]' }).first()
      await link.hover()
      await expect(card(page, 'Elena Vasquez')).toBeVisible()
      await expect(card(page, 'Elena Vasquez')).toContainText('A smuggler’s daughter.')
      await expect(card(page, 'Elena Vasquez')).toContainText('Character')
      await page.screenshot({ path: `${shots}/hover-card-${scheme}.png` })
      expect(await seriousViolations(page)).toEqual([])
      await page.mouse.move(5, 5)
      await expect(card(page, 'Elena Vasquez')).toBeHidden()

      // The card opens on the keyboard too: the caret in the link, after a pause.
      await link.click()
      await page.keyboard.press('ArrowLeft')
      await expect(card(page, 'Elena Vasquez')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(card(page, 'Elena Vasquez')).toBeHidden()

      // Mod-click follows it to the record's sheet, and the sheet says where it is linked from.
      await link.click({ modifiers: [MOD] })
      await expect(page).toHaveURL(/record=chr_elena00001/)
      await expect(page.getByRole('heading', { level: 1, name: 'Elena Vasquez' })).toBeVisible()
      const sheet = page.getByRole('region', { name: 'Record' })
      await expect(sheet.getByRole('heading', { name: 'Linked from' })).toBeVisible()
      await expect(sheet.getByRole('button', { name: /Untitled scene/ })).toContainText(/link/)
      // …and where the name is written, found without a link.
      await expect(sheet.getByRole('heading', { name: 'Found in your writing' })).toBeVisible()
      await expect(sheet.getByText('“Elena” 2', { exact: false }).first()).toBeVisible()
      // Its notes are the same editor: [[ works there too.
      await sheet.getByRole('tab', { name: 'Notes' }).click()
      const notes = sheet.getByRole('textbox', { name: /Notes/ })
      await expect(notes).toContainText('Owes everyone.')
      await caretAtEnd(page, 0)
      await page.keyboard.type(' She guards [[lantern')
      await expect(page.getByRole('listbox', { name: 'Link to' })).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(notes).toContainText('[[Lantern Gate]]')
      await waitSaved(page)
      await page.screenshot({ path: `${shots}/record-sheet-links-${scheme}.png` })
      expect(await seriousViolations(page)).toEqual([])

      // The scene's Links tab: what it links to, and an embed shown as a card.
      await page.getByRole('link', { name: 'Write' }).click()
      await inspector(page).getByRole('tab', { name: 'Links' }).click()
      await expect(inspector(page).getByRole('heading', { name: 'Links to' })).toBeVisible()
      await expect(inspector(page).getByRole('button', { name: /Elena Vasquez/ })).toBeVisible()
      await expect(inspector(page).getByRole('button', { name: /Lantern Gate/ })).toBeVisible()
      // An embed shows its card, which is a link the keyboard can reach and open; its line shows only under the caret.
      const embed = page.getByRole('link', { name: /Place Lantern Gate/ })
      await expect(embed).toContainText('Where the curfew is kept.')
      await expect(page.locator('.manuscript .aur-embed-hidden')).toHaveCount(1)
      await page.screenshot({ path: `${shots}/links-tab-${scheme}.png` })
      expect(await seriousViolations(page)).toEqual([])
    })

    test('names found in the text: show them, accept one, say "not a name" to another', async ({
      page,
    }) => {
      await seeded(page)
      await showNames(page).click()
      const text = sceneText(page)
      // Elena is found without a link; Elenath and the address are not her.
      await expect(page.locator('.manuscript .aur-name', { hasText: /^Elena$/ })).toHaveCount(2)
      await expect(page.locator('.manuscript .aur-name', { hasText: 'Elenath' })).toHaveCount(0)
      // Will is asked about (a sentence start), and Corin (two things share the name).
      await expect(page.locator('.manuscript .aur-ask')).toHaveText(['Will', 'Corin'])
      await page.screenshot({ path: `${shots}/names-highlight-${scheme}.png` })
      expect(await seriousViolations(page)).toEqual([])

      // The Names tab says the same.
      await inspector(page).getByRole('tab', { name: 'Names' }).click()
      await expect(inspector(page).getByRole('button', { name: /Elena Vasquez/ })).toBeVisible()
      await expect(inspector(page).getByText('“Will” · 1 place')).toBeVisible()
      await expect(inspector(page).getByText('“Corin” · 1 place')).toBeVisible()
      await page.screenshot({ path: `${shots}/names-tab-${scheme}.png` })
      expect(await seriousViolations(page)).toEqual([])
      const before = await opfs.read(page, await firstScenePath(page))

      // Nothing was written by looking.
      await page.waitForTimeout(700)
      expect(await opfs.read(page, await firstScenePath(page))).toBe(before)

      // Accept: "Is this Will Ashby?" writes one link at that place.
      await page.locator('.manuscript .aur-ask', { hasText: 'Will' }).hover()
      await expect(card(page, 'Will Ashby')).toBeVisible()
      await expect(card(page, 'Will Ashby')).toContainText('Is this Will Ashby?')
      await page.screenshot({ path: `${shots}/suggestion-${scheme}.png` })
      expect(await seriousViolations(page)).toEqual([])
      await card(page, 'Will Ashby')
        .getByRole('button', { name: /Yes — Will Ashby/ })
        .click()
      await expect(text).toContainText('[[Will]] you stop?', { useInnerText: true })
      await expect(text).not.toContainText('chr_will000001', { useInnerText: true })
      await expect(text).toContainText('[[id:chr_will000001|Will]] you stop?') // in the file's words
      await waitSaved(page)
      const accepted = await opfs.read(page, await firstScenePath(page))
      expect(accepted.replace('[[id:chr_will000001|Will]]', 'Will')).toBe(before)

      // "Not a name" on Corin: the answer goes to the scene's details, never into the text.
      await page.locator('.manuscript .aur-ask', { hasText: 'Corin' }).hover()
      await card(page, 'Corin').getByRole('button', { name: 'Not a name' }).click()
      await expect(page.locator('.manuscript .aur-ask')).toHaveCount(0)
      // It says what it did and offers Undo, which brings the question back.
      const toast = page.getByRole('status').filter({ hasText: 'Marked as not a name.' })
      await expect(toast).toBeVisible()
      await toast.getByRole('button', { name: 'Undo' }).click()
      await expect(page.locator('.manuscript .aur-ask')).toHaveCount(1)
      await page.locator('.manuscript .aur-ask', { hasText: 'Corin' }).hover()
      await card(page, 'Corin').getByRole('button', { name: 'Not a name' }).click()
      await expect(page.locator('.manuscript .aur-ask')).toHaveCount(0)
      await waitSaved(page)
      const answered = await opfs.read(page, await firstScenePath(page))
      expect(answered).toContain('ignoreNames:\n  - "Corin:1"')
      expect(answered.replace(/ignoreNames:\n {2}- "Corin:1"\n/, '')).toBe(accepted)
      await page.reload()
      await expect(page.locator('.manuscript .aur-ask')).toHaveCount(0)
    })

    test('answer a question from the keyboard alone', async ({ page }) => {
      await seeded(page)
      const will = page.locator('.manuscript .aur-ask', { hasText: 'Will' })
      await expect(will).toHaveCount(1)
      // The caret on the word: after a pause the card opens, and the page says so (the card takes no focus).
      await caretAfter(page, 'Will')
      await expect(card(page, 'Will Ashby')).toBeVisible()
      await expect(
        page.getByRole('status').filter({ hasText: 'Is this Will Ashby?' }),
      ).toContainText('to answer.')
      await page.keyboard.press('Alt+ArrowDown')
      await expect(card(page, 'Will Ashby').getByRole('button').first()).toBeFocused()
      // Escape gives the keyboard back to the text, and leaves the question as it was.
      await page.keyboard.press('Escape')
      await expect(card(page, 'Will Ashby')).toBeHidden()
      await expect(sceneText(page)).toBeFocused()
      await expect(will).toHaveCount(1)
      // Again, and answer: Enter on "Yes — Will Ashby".
      await caretAfter(page, 'Will')
      await expect(card(page, 'Will Ashby')).toBeVisible()
      await page.keyboard.press('Alt+ArrowDown')
      await page.keyboard.press('Enter')
      await expect(sceneText(page)).toContainText('[[Will]] you stop?', { useInnerText: true })
      await expect(sceneText(page)).toBeFocused()
      await waitSaved(page)
      expect(await opfs.read(page, await firstScenePath(page))).toContain(
        '[[id:chr_will000001|Will]] you stop?',
      )
      // Enter inside a link is a new paragraph; Mod+Enter follows it.
      await caretAfter(page, '|Will', -1)
      await page.keyboard.press('Control+Enter')
      await expect(page).toHaveURL(/record=chr_will000001/)
    })
  })
}

test('the palette searches the words of scenes and notes, and opens the one chosen', async ({
  page,
}) => {
  await seeded(page)
  await page.keyboard.press(`${MOD}+k`)
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill('curfew')
  const results = palette.getByRole('listbox', { name: 'Results' })
  await expect(results.getByText('In your writing')).toBeVisible()
  // The record and the scene both mention it; the line around the word is shown.
  await expect(results).toContainText('Lantern Gate')
  await expect(results).toContainText('Where the curfew')
  await page.screenshot({ path: `${shots}/search-light.png` })
  await palette.getByRole('combobox').fill('swam')
  await expect(results).toContainText('Corin swam')
  // The word found is drawn bold in the line.
  await expect(results.locator('strong', { hasText: 'swam' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(palette).toBeHidden()
  await expect(page).toHaveURL(/\/w\//)
  // The scene opens at the word: it is selected.
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('swam')
})

for (const scheme of ['light', 'dark'] as const) {
  test(`rename everywhere in the ${scheme} theme: preview, apply, undo — Elenath and the address are never touched`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    const { path } = await seeded(page)
    await waitSaved(page)
    const before = await opfs.read(page, path)
    await page.getByRole('link', { name: 'World' }).click()
    await page.getByRole('button', { name: 'Elena Vasquez' }).click()
    const sheet = page.getByRole('region', { name: 'Record' })
    await sheet.getByRole('button', { name: 'Rename…' }).click()
    const name = page.getByRole('dialog').getByLabel('Name', { exact: true })
    await name.fill('Helena Vasquez')
    await name.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Change the name in your text too?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('You renamed “Elena Vasquez” to “Helena Vasquez”')
    // Every form, with what it becomes; "Lena" is kept.
    await expect(dialog.getByLabel('New form for Elena Vasquez')).toHaveValue('Helena Vasquez')
    await expect(dialog.getByLabel('New form for Elena', { exact: true })).toHaveValue('Helena')
    // "Lena" is written nowhere: no row for it.
    await expect(dialog.getByLabel('New form for Lena')).toHaveCount(0)
    // Places in the text: Elena (twice) and the possessive, and the link — but not Elenath or the address.
    const places = dialog.getByRole('region', { name: 'Places that would change' })
    await expect(places).toContainText('Elena’s')
    // What would change: the name twice and the link. The words around a place may hold Elenath; a place is never it.
    await expect(places.locator('del')).toHaveText(['Elena', 'Elena', 'Elena Vasquez'])
    await page.screenshot({ path: `${shots}/rename-preview-${scheme}.png` })
    expect(await seriousViolations(page)).toEqual([])
    // Looking changed nothing on disk (the title was its own step).
    expect(await opfs.read(page, path)).toBe(before)

    // Untick one place, change the rest.
    const boxes = places.getByRole('checkbox')
    const total = await boxes.count()
    expect(total).toBe(3)
    await boxes.nth(1).uncheck() // “Elena’s hand”
    await dialog.getByRole('button', { name: `Change ${total - 1} places` }).click()
    // The place left alone is listed again, so nothing is forgotten.
    await expect(dialog).toContainText(
      `Changed ${total - 1} places. These 1 place were left as they are.`,
    )
    await expect(dialog.getByRole('region', { name: 'Places left as they are' })).toContainText(
      'Elena’s',
    )
    await page.screenshot({ path: `${shots}/rename-left-${scheme}.png` })
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    const toast = page.getByRole('status').filter({ hasText: `Changed ${total - 1} places` })
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('A copy of each file was kept first')

    await page.getByRole('link', { name: 'Write' }).click()
    await expect(sceneText(page)).toContainText('Helena reached the Lantern Gate. Elenath waited')
    // The one left unticked stayed as it was.
    await expect(sceneText(page)).toContainText('Elena’s hand shook')
    await expect(sceneText(page)).toContainText('elena@example.com')
    await waitSaved(page)
    const changed = await opfs.read(page, path)
    expect(changed).toContain('[[Helena Vasquez]]')
    expect(changed).toContain('Elenath waited, and elena@example.com wrote.')
    // The other names follow, so Helena is found from now on.
    const files = await opfs.list(page)
    const recordFile = files.find((f) => !f.includes('.aurelia/') && f.endsWith(`${ELENA}.md`))!
    expect(await opfs.read(page, recordFile)).toContain('"Helena"')
    // The old texts are kept in the folder.
    expect(files.some((f) => f.includes('.aurelia/safety/') && f.endsWith('.md'))).toBe(true)

    // One Undo puts the text back.
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(sceneText(page)).toContainText('Elena reached the Lantern Gate.')
    await waitSaved(page)
    expect(await opfs.read(page, path)).toBe(before)
  })
}

test('"Only rename the record" leaves the text as it is', async ({ page }) => {
  const { path } = await seeded(page)
  await waitSaved(page)
  const before = await opfs.read(page, path)
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
  await dialog.getByRole('button', { name: 'Only rename the record' }).click()
  await expect(dialog).toBeHidden()
  await waitSaved(page)
  expect(await opfs.read(page, path)).toBe(before)
})
