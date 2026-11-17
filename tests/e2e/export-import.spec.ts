// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Download, type Page } from '@playwright/test'
import { createBrowserWorkspace, firstScenePath, opfs } from '../helpers/browser-workspace'
import { makeZip } from '../helpers/make-zip'
import { readZip } from '../helpers/read-zip'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
test.setTimeout(90_000)

const SCENE_B = 'scn_bridge0001'
const SCENE_C = 'scn_aqueduct01'
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** A workspace with a small branching book put in place the way another app would: a table, a footnote, two choices. */
async function seeded(page: Page) {
  await createBrowserWorkspace(page, 'Gatehouse')
  const path = await firstScenePath(page)
  const base = path.slice(0, path.indexOf('/books/'))
  const chapterFile = (await opfs.list(page)).find((f) => /\/chapters\/chp_\w+\.md$/.test(f))!
  const [book, chapter, scene] = [
    /books\/(bok_\w+)\//.exec(path)![1]!,
    /chp_\w+/.exec(chapterFile)![0],
    /scn_\w+/.exec(path)![0],
  ]
  const put = (file: string, text: string) =>
    opfs.write(page, `${base}/books/${book}/${file}`, text)
  const head = (id: string, title: string, order: string, extra = '') =>
    `---\ntitle: "${title}"\nschemaVersion: 1\nid: "${id}"\nchapter: "${chapter}"\norder: "${order}"\n${extra}---\n\n`
  await put(
    `scenes/${scene}.md`,
    head(
      scene,
      'The Lantern Gate',
      'a',
      `choices:\n  - id: "chc_pay0000001"\n    label: "Pay the warden’s price"\n    target: "${SCENE_B}"\n  - id: "chc_climb00001"\n    label: "Climb the aqueduct"\n    target: "${SCENE_C}"\n`,
    ) +
      'The bells had *already* started, and **nobody** moved.[^1]\n\n| Item | Count |\n|:-----|------:|\n| Rope | 2 |\n\n[^1]: The gate was built in year 412.\n',
  )
  await put(
    `scenes/${SCENE_B}.md`,
    `${head(SCENE_B, 'The Old Bridge', 'b', 'ending: true\n')}A short bridge.\n`,
  )
  await put(
    `scenes/${SCENE_C}.md`,
    `${head(SCENE_C, 'The Aqueduct', 'c', 'ending: true\n')}Wind.\n`,
  )
  await put(
    'book.json',
    JSON.stringify({
      title: 'The Lantern Gate',
      schemaVersion: 1,
      id: book,
      mode: 'branching',
      outline: [{ chapter, scenes: [scene, SCENE_B, SCENE_C] }],
    }),
  )
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Scene text' })).toContainText('The bells had')
}

const openExport = async (page: Page) => {
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('combobox').fill('export this')
  await page.getByRole('option', { name: /Export this book/ }).click()
  await expect(dialog(page, 'Export this book')).toBeVisible()
}
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name })

async function serious(page: Page, include = '[role="dialog"]') {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
  const { violations } = await new AxeBuilder({ page }).include(include).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const bytesOf = async (d: Download) => new Uint8Array(readFileSync((await d.path())!))

/** Choose a format in the open Export dialog, press Export, and take the download. */
async function exportAs(page: Page, format: string) {
  await openExport(page)
  await dialog(page, 'Export this book').getByRole('radio', { name: format, exact: true }).click()
  const download = page.waitForEvent('download')
  await dialog(page, 'Export this book')
    .getByRole('button', { name: 'Export', exact: true })
    .click()
  return download
}

test.describe('export', () => {
  test('a Word file, an EPUB and a Markdown bundle hold the book, every choice, and are the same bytes twice', async ({
    page,
  }) => {
    await seeded(page)

    const docx = await exportAs(page, 'Word')
    expect(docx.suggestedFilename()).toBe('The Lantern Gate.docx')
    const docxBytes = await bytesOf(docx)
    const parts = readZip(docxBytes)
    expect(parts.every((p) => p.crcOk)).toBe(true)
    const doc = parts.find((p) => p.path === 'word/document.xml')!.text
    expect(doc).toContain('Pay the warden’s price → The Old Bridge')
    expect(doc).toContain('Climb the aqueduct → The Aqueduct')
    expect(doc).toContain('<w:tblHeader/>')
    expect(parts.find((p) => p.path === 'word/footnotes.xml')!.text).toContain('year 412')
    await expect(page.getByText(/Exported The Lantern Gate\.docx/)).toBeVisible()

    const again = await bytesOf(await exportAs(page, 'Word'))
    expect(sha(again)).toBe(sha(docxBytes))

    const epub = await exportAs(page, 'EPUB')
    expect(epub.suggestedFilename()).toBe('The Lantern Gate.epub')
    const epubBytes = await bytesOf(epub)
    const epubParts = readZip(epubBytes)
    expect(epubParts[0]!.path).toBe('mimetype')
    expect(epubParts[0]!.text).toBe('application/epub+zip')
    const chapter = epubParts.find((p) => p.path === 'OEBPS/ch001.xhtml')!.text
    expect(chapter).toContain('Pay the warden’s price &#8594; <a href="ch001.xhtml#scn_')
    expect(chapter).toContain('epub:type="footnote"')
    expect(sha(await bytesOf(await exportAs(page, 'EPUB')))).toBe(sha(epubBytes))

    const md = await exportAs(page, 'Markdown')
    expect(md.suggestedFilename()).toBe('The Lantern Gate (Markdown).zip')
    const mdBytes = await bytesOf(md)
    const mdParts = readZip(mdBytes)
    expect(mdParts.map((p) => p.path)).toEqual([
      'The Lantern Gate/01 Chapter one/01 The Lantern Gate.md',
      'The Lantern Gate/01 Chapter one/02 The Old Bridge.md',
      'The Lantern Gate/01 Chapter one/03 The Aqueduct.md',
    ])
    expect(mdParts[0]!.text).toContain('- Climb the aqueduct → The Aqueduct')
    expect(sha(await bytesOf(await exportAs(page, 'Markdown')))).toBe(sha(mdBytes))
  })

  test('a PDF is the print view: the book on a page, and only the book when printed', async ({
    page,
  }) => {
    await seeded(page)
    await page.evaluate(() => {
      ;(window as unknown as { printed: number }).printed = 0
      window.print = () => void ((window as unknown as { printed: number }).printed += 1)
    })
    await openExport(page)
    await dialog(page, 'Export this book').getByRole('radio', { name: 'PDF', exact: true }).click()
    await dialog(page, 'Export this book').getByLabel('Author').fill('Ada Writer')
    await dialog(page, 'Export this book').getByRole('button', { name: 'Open print view' }).click()

    const view = page.getByRole('dialog', { name: 'Print view' })
    await expect(view).toBeVisible()
    await expect(page).toHaveTitle('The Lantern Gate')
    const book = view.getByLabel('The book')
    await expect(book.getByRole('heading', { level: 1, name: 'The Lantern Gate' })).toBeVisible()
    await expect(book).toContainText('Ada Writer')
    await expect(book).toContainText('Pay the warden’s price → The Old Bridge')
    await expect(book.getByRole('link', { name: 'The Aqueduct' })).toBeVisible()
    await expect(book.getByRole('table')).toBeVisible()

    expect(await serious(page, '.print-view')).toEqual([])
    await view.getByRole('button', { name: 'Print or save as PDF' }).click()
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)

    // Printed, only the book shows, and the browser can make a PDF of it.
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('#app')).toBeHidden()
    await expect(view.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden()
    await expect(book).toBeVisible()
    const pdf = await page.pdf()
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    await page.emulateMedia({ media: 'screen' })

    await page.keyboard.press('Escape')
    await expect(view).toBeHidden()
    await expect(page).not.toHaveTitle('The Lantern Gate')
    await expect(page.locator('#app')).toBeVisible()
  })

  test('saved settings: saved in the workspace, still there after a reload, with focus kept and every step said', async ({
    page,
  }) => {
    await seeded(page)
    await openExport(page)
    const d = dialog(page, 'Export this book')
    await d.getByRole('radio', { name: 'EPUB', exact: true }).click()
    await d.getByLabel('Author').fill('Ada Writer')
    // The built-in settings are not written over: there is no Save, only Save as new.
    await expect(d.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await d.getByRole('button', { name: 'Save as new…' }).click()
    await expect(d.getByLabel('Name for these settings')).toBeFocused()
    await d.getByLabel('Name for these settings').fill('For my agent')
    await d.getByLabel('Name for these settings').press('Enter')
    await expect(d.getByRole('combobox', { name: 'Use the settings of' })).toContainText(
      'For my agent',
    )
    await expect(d.getByRole('combobox', { name: 'Use the settings of' })).toBeFocused()
    await expect(d.getByRole('status')).toHaveText('Saved as “For my agent”.')
    expect(await opfs.list(page)).toContain(
      `${(await opfs.list(page))[0]!.split('/')[0]}/.aurelia/export-profiles.json`,
    )

    // A change, saved with Save; switching with a change that is not saved asks first.
    await d.getByLabel('Author').fill('Ada W.')
    await d.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(d.getByRole('status')).toHaveText('Saved “For my agent”.')
    await d.getByLabel('Author').fill('Someone else')
    await d.getByRole('combobox', { name: 'Use the settings of' }).click()
    await page.getByRole('option', { name: 'Standard' }).click()
    await expect(d.getByRole('alert')).toContainText('changes that are not saved')
    await d.getByRole('button', { name: 'Keep editing' }).click()
    await expect(d.getByLabel('Author')).toHaveValue('Someone else')
    await page.keyboard.press('Escape')

    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Scene text' })).toBeVisible()
    await openExport(page)
    await d.getByRole('combobox', { name: 'Use the settings of' }).click()
    await page.getByRole('option', { name: 'For my agent' }).click()
    await expect(d.getByRole('radio', { name: 'EPUB', exact: true })).toBeChecked()
    await expect(d.getByLabel('Author')).toHaveValue('Ada W.')

    // Delete asks first, in place; nothing is deleted until it is confirmed.
    await d.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(d.getByRole('alert')).toContainText('Delete these saved settings?')
    await d.getByRole('button', { name: 'No' }).click()
    await expect(d.getByRole('combobox', { name: 'Use the settings of' })).toContainText(
      'For my agent',
    )
    await d.getByRole('button', { name: 'Delete', exact: true }).click()
    await d.getByRole('button', { name: 'Yes, delete them' }).click()
    await expect(d.getByRole('status')).toHaveText('Deleted “For my agent”.')
    await expect(d.getByRole('combobox', { name: 'Use the settings of' })).toBeFocused()
    await expect(d.getByRole('combobox', { name: 'Use the settings of' })).toContainText('Standard')
  })

  test('a language that is not a language code is said so, and nothing is made until it is fixed', async ({
    page,
  }) => {
    await seeded(page)
    await openExport(page)
    const d = dialog(page, 'Export this book')
    await d.getByRole('radio', { name: 'EPUB', exact: true }).click()
    await d.getByLabel('Language').fill('not a code')
    await expect(d.getByRole('alert')).toContainText('language code')
    await expect(d.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    await d.getByLabel('Language').fill('fr-CA')
    await expect(d.getByRole('button', { name: 'Export', exact: true })).toBeEnabled()
  })

  test('closing the print view gives focus back to where the export began', async ({ page }) => {
    await seeded(page)
    await page.getByRole('tab', { name: 'Book' }).click()
    const start = page.getByRole('button', { name: 'Export this book…' })
    await start.click()
    const d = dialog(page, 'Export this book')
    await d.getByRole('radio', { name: 'PDF', exact: true }).click()
    await d.getByRole('button', { name: 'Open print view' }).click()
    await expect(page.getByRole('dialog', { name: 'Print view' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(start).toBeFocused()
  })

  test('the dialog has no serious accessibility problems, on a desktop and on a phone, and fits 390 px', async ({
    page,
  }) => {
    await seeded(page)
    await openExport(page)
    expect(await serious(page)).toEqual([])
    await dialog(page, 'Export this book').getByRole('radio', { name: 'PDF', exact: true }).click()
    expect(await serious(page)).toEqual([])
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 390, height: 800 })
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Scene text' })).toBeVisible()
    await openExport(page)
    const box = (await dialog(page, 'Export this book').boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    expect(await serious(page)).toEqual([])
  })
})

test.describe('import', () => {
  test('a Markdown zip from another tool: a preview, a report of what could not be read, then a new book', async ({
    page,
  }) => {
    await seeded(page)
    const zip = makeZip([
      { path: 'My Novel/01 Start/a.md', data: '# The Start\n\nShe began.\n' },
      { path: 'My Novel/01 Start/b.md', data: 'Then she went on.\n' },
      {
        path: 'My Novel/02 End/c.md',
        data: '---\ntitle: The End\ndate: 2020-01-01\n---\n\nIt ended.\n',
      },
      { path: 'My Novel/cover.png', data: new Uint8Array([137, 80, 78, 71]) },
    ])
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('import a book')
    await page.getByRole('option', { name: /Import a book/ }).click()
    const d = dialog(page, 'Import a book')
    await expect(d).toBeVisible()
    await d.locator('input[type=file]:not([webkitdirectory])').setInputFiles({
      name: 'My Novel.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(zip),
    })

    // The preview says what will be made; nothing has been written yet.
    await expect(d.getByText('What will be made')).toBeVisible()
    await expect(d.getByLabel('Name of the book')).toBeFocused()
    await expect(d).toContainText('A book with 2 chapters, 3 scenes')
    await expect(d.getByLabel('Name of the book')).toHaveValue('My Novel')
    await expect(
      d.getByRole('list', { name: 'The chapters and scenes that will be made' }),
    ).toContainText('The Start · B')
    // The report: what could not be read, and what was read in another way.
    await expect(d).toContainText('What could not be read')
    await expect(d).toContainText('Not a Markdown or text file')
    await expect(d).toContainText('cover.png')
    await expect(d).toContainText('Only the title is kept from the details at the top: date')
    expect(await serious(page)).toEqual([])
    expect((await opfs.list(page)).filter((f) => f.includes('/books/')).length).toBeGreaterThan(0)
    const before = (await opfs.list(page)).length

    await d.getByRole('button', { name: 'Make the book' }).click()
    await expect(d).toBeHidden()
    await expect(
      page.getByText('Imported “My Novel”: 2 chapters, 3 scenes. 1 file was not read.'),
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Scene text' })).toContainText('She began.')
    // Another book, with its chapters, in the navigator; the first book is still there, untouched.
    const tree = page.getByRole('navigation', { name: 'Workspace' })
    await expect(tree.getByText('My Novel', { exact: true }).first()).toBeVisible()
    expect((await opfs.list(page)).length).toBeGreaterThan(before + 5)
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Scene text' })).toContainText('She began.')
    await expect(tree.getByText('The Lantern Gate', { exact: true }).first()).toBeVisible()
  })

  test('a folder of Markdown: each folder a chapter, each file a scene', async ({ page }) => {
    await seeded(page)
    const root = mkdtempSync(join(tmpdir(), 'aurelia-import-'))
    const folder = join(root, 'Draft')
    mkdirSync(join(folder, 'Chapter 10'), { recursive: true })
    mkdirSync(join(folder, 'Chapter 2'), { recursive: true })
    writeFileSync(join(folder, 'Chapter 2', 'one.md'), 'Two, one.\n')
    writeFileSync(join(folder, 'Chapter 10', 'one.md'), 'Ten, one.\n')
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('import a book')
    await page.getByRole('option', { name: /Import a book/ }).click()
    const d = dialog(page, 'Import a book')
    await d.locator('input[webkitdirectory]').setInputFiles(folder)
    await expect(d.getByLabel('Name of the book')).toHaveValue('Draft')
    const list = d.getByRole('list', { name: 'The chapters and scenes that will be made' })
    // Natural order: Chapter 2 before Chapter 10.
    await expect(list.getByRole('listitem').nth(0)).toContainText('Chapter 2')
    await expect(list.getByRole('listitem').nth(1)).toContainText('Chapter 10')
    await d.getByRole('button', { name: 'Back' }).click()
    await expect(d.getByRole('button', { name: 'Choose files…' })).toBeFocused()
  })

  test('too much, or nothing it can read, is said in plain words and changes nothing', async ({
    page,
  }) => {
    await seeded(page)
    const before = await opfs.list(page)
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('import a book')
    await page.getByRole('option', { name: /Import a book/ }).click()
    const d = dialog(page, 'Import a book')
    await d.locator('input[type=file]:not([webkitdirectory])').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71]),
    })
    await expect(d.getByRole('alert')).toContainText('found no writing it can read')
    await expect(d.getByRole('button', { name: 'Choose files…' })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await opfs.list(page)).toEqual(before)
  })

  test('a Twee story from the Welcome screen: a branching book of its own, with its start and every choice', async ({
    page,
  }) => {
    const twee = [
      ':: StoryTitle',
      'Two doors',
      '',
      ':: StoryData',
      '{"start":"Hall"}',
      '',
      ':: Hall',
      'A cold hall. [[Take the left door->Left]] or [[Right]]?',
      '',
      ':: Left',
      '(set: $key to true) A small room. [[Back->Hall]]',
      '',
      ':: Right',
      'Daylight. The end.',
      '',
      ':: StoryInit',
      '(set: $key to false)',
      '',
    ].join('\n')
    await page.goto('/')
    await page.getByRole('button', { name: /Import a book/ }).click()
    const d = dialog(page, 'Import a book')
    await d.locator('input[type=file]:not([webkitdirectory])').setInputFiles({
      name: 'two-doors.twee',
      mimeType: 'text/plain',
      buffer: Buffer.from(twee),
    })
    await expect(d).toContainText('A branching book with 1 chapter, 3 scenes, 3 choices')
    await expect(d.getByLabel('Name of the book and workspace')).toHaveValue('Two doors')
    await expect(d).toContainText('Macros and variables stay as text')
    await expect(d).toContainText('(set:)')
    await expect(d).toContainText('code or settings is not a scene')
    await expect(d).toContainText('StoryInit')
    expect(await serious(page)).toEqual([])

    await d.getByRole('button', { name: 'Make the workspace' }).click()
    // The story starts at the Hall, and the book has a story map with every scene.
    await expect(page.getByRole('textbox', { name: 'Scene text' })).toContainText('A cold hall.')
    await page.getByRole('link', { name: 'Story map' }).click()
    const map = page.getByRole('group', { name: 'Story map' })
    for (const name of ['Hall', 'Left', 'Right'])
      await expect(map.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible()
    // The choices are the book's: the Hall leads to both rooms.
    await page.getByRole('link', { name: 'Write' }).click()
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Scene text' })).toContainText('A cold hall.')
  })
})

for (const scheme of ['light', 'dark'] as const) {
  test(`the import preview has no serious accessibility problems in the ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/')
    await page.getByRole('button', { name: /Import a book/ }).click()
    const d = dialog(page, 'Import a book')
    await d.locator('input[type=file]:not([webkitdirectory])').setInputFiles({
      name: 'a.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# One\n\nWords.\n'),
    })
    await expect(d.getByText('What will be made')).toBeVisible()
    expect(await serious(page)).toEqual([])
  })
}

const shots = 'test-results/m7b-screenshots'
for (const scheme of ['light', 'dark'] as const) {
  test(`screenshots of the export dialog, the print view and the import preview, ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await seeded(page)
    await openExport(page)
    await page.screenshot({ path: `${shots}/export-${scheme}.png` })
    await dialog(page, 'Export this book').getByRole('radio', { name: 'PDF', exact: true }).click()
    await page.screenshot({ path: `${shots}/export-pdf-${scheme}.png` })
    await dialog(page, 'Export this book').getByRole('button', { name: 'Open print view' }).click()
    await expect(page.getByRole('dialog', { name: 'Print view' })).toBeVisible()
    await page.screenshot({ path: `${shots}/print-${scheme}.png` })
    await page.keyboard.press('Escape')

    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('import a book')
    await page.getByRole('option', { name: /Import a book/ }).click()
    const d = dialog(page, 'Import a book')
    await page.screenshot({ path: `${shots}/import-pick-${scheme}.png` })
    await d.locator('input[type=file]:not([webkitdirectory])').setInputFiles([
      { name: 'one.md', mimeType: 'text/markdown', buffer: Buffer.from('# One\n\nWords.\n') },
      { name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from([137, 80]) },
      {
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('---\ntitle: Notes\ntags: [a]\n---\nText.'),
      },
    ])
    await expect(d.getByText('What will be made')).toBeVisible()
    await page.screenshot({ path: `${shots}/import-preview-${scheme}.png` })
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 390, height: 844 })
    await openExport(page)
    await page.screenshot({ path: `${shots}/export-phone-${scheme}.png` })
  })
}

test('the import dialog’s buttons all fit at 390 px, and the book will not be made in a hurry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: /Import a book/ }).click()
  const d = dialog(page, 'Import a book')
  await d.locator('input[type=file]:not([webkitdirectory])').setInputFiles({
    name: 'a.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# One\n\nWords.\n'),
  })
  await expect(d.getByText('What will be made')).toBeVisible()
  const box = (await d.boundingBox())!
  for (const name of ['Back', 'Cancel', 'Make the workspace']) {
    const b = (await d.getByRole('button', { name, exact: true }).boundingBox())!
    expect(b.x, name).toBeGreaterThanOrEqual(box.x)
    expect(b.x + b.width, name).toBeLessThanOrEqual(box.x + box.width)
  }
  expect(await serious(page)).toEqual([])
})
