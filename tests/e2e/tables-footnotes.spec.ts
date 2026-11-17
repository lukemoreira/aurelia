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

const MOD = 'ControlOrMeta'
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })
/** The editor, and not the area of the source, whose name starts the same. */
const editorText = (page: Page) => page.getByRole('textbox', { name: 'Scene text', exact: true })
const source = (page: Page) => page.getByRole('textbox', { name: 'Scene text, Markdown source' })
const sourceSwitch = (page: Page) => page.getByRole('switch', { name: 'Markdown source' })

/** The scene file's text after the details at the top. */
const bodyOnDisk = async (page: Page) => {
  const text = await opfs.read(page, await firstScenePath(page))
  return text.slice(text.indexOf('\n---\n') + 5).replace(/^\n+/, '')
}
/** Put a text in the scene's file the way another app would, then open it fresh. */
async function openWithBody(page: Page, body: string) {
  await createBrowserWorkspace(page)
  const path = await firstScenePath(page)
  const file = await opfs.read(page, path)
  await opfs.write(page, path, file.slice(0, file.indexOf('\n---\n') + 5) + `\n${body}`)
  await page.reload()
  await expect(sceneText(page)).toBeVisible()
}
const caretTo = (page: Page, where: 'start' | 'end') =>
  page.evaluate((to) => {
    const dom = document.querySelector('.ProseMirror') as HTMLElement & {
      editor: { commands: { focus: (position: string) => void } }
    }
    dom.editor.commands.focus(to)
  }, where)
/** What a pseudo-element of the footnote's reference draws: its box and the words in it. */
const tooltip = (page: Page) =>
  page
    .locator('[data-footnote-ref]')
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el, '::before')
      return { display: style.display, content: style.content }
    })

const BODY = `The warden knew her face.

| Name   | Role       |
| ------ | ---------- |
| Elena  | Courier    |
| Warden | Gatekeeper |

She had seen it before[^1], and said so.

[^1]: At the harbour, the winter before.
`

test.describe('a table, by keyboard', () => {
  test('is inserted, filled with Tab, grown, aligned and saved as a tidy table', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).click()
    await page.keyboard.type('Before the table.')
    await page.keyboard.press('Enter')
    await page.keyboard.press(`${MOD}+Alt+t`)
    await expect(sceneText(page).locator('table')).toHaveCount(1)
    await expect(sceneText(page).locator('th')).toHaveCount(3)
    await expect(sceneText(page).locator('tr')).toHaveCount(3)
    // The caret is in the first cell, and Tab goes cell to cell.
    for (const [i, word] of ['Name', 'Role', 'Kind', 'Elena', 'Courier', 'x'].entries()) {
      await page.keyboard.type(word)
      if (i < 5) await page.keyboard.press('Tab')
    }
    // Two more cells of the next row; then Tab in the table's last cell makes a row of its own.
    await page.keyboard.press('Tab')
    await page.keyboard.type('Warden')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Gatekeeper')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(sceneText(page).locator('tr')).toHaveCount(4)
    // Back to the third column, and the table's menu, reached from the bar.
    await page.keyboard.press('Shift+Tab')
    await expect(toolbar(page).getByRole('button', { name: 'Table actions' })).toBeVisible()
    await toolbar(page).getByRole('button', { name: 'Table actions' }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Align column right' }).focus()
    await page.keyboard.press('Enter')
    // The menu gives the caret back to the text.
    await expect(sceneText(page)).toBeFocused()
    await waitSaved(page)
    const body = await bodyOnDisk(page)
    expect(body).toBe(
      [
        'Before the table.',
        '',
        '| Name   | Role       | Kind |',
        '| ------ | ---------- | ---: |',
        '| Elena  | Courier    |    x |',
        '| Warden | Gatekeeper |      |',
        '|        |            |      |',
        '',
      ].join('\n'),
    )
    // It is still a table after a reload, and nothing was written by looking at it.
    await page.reload()
    await expect(sceneText(page).locator('table')).toHaveCount(1)
    await expect(sceneText(page).locator('th').nth(2)).toHaveCSS('text-align', 'right')
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe(body)
  })

  test('is kept exactly as it was in the file until a cell is changed', async ({ page }) => {
    const loose = 'Intro.\n\na | b\n--|--\nc | d\n\n|x|y|\n|:-|-:|\n|1|2|\n'
    await openWithBody(page, loose)
    await expect(sceneText(page).locator('table')).toHaveCount(2)
    await sceneText(page).locator('p').first().click()
    await page.keyboard.press('Home')
    await page.keyboard.type('Hi. ')
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe(`Hi. ${loose}`)
    await sceneText(page).locator('td').first().click()
    await page.keyboard.type('!')
    await waitSaved(page)
    const body = await bodyOnDisk(page)
    expect(body).toContain('| a   | b   |\n| --- | --- |\n| c!  | d   |')
    expect(body).toContain('|x|y|\n|:-|-:|\n|1|2|\n')
  })
})

test.describe('pasting into a table', () => {
  test('lines of text go into the one cell and never over the cells beside it', async ({
    page,
  }) => {
    await openWithBody(page, '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n')
    await sceneText(page).locator('td').first().click()
    await expect(toolbar(page).getByRole('button', { name: 'Table actions' })).toBeVisible()
    // The editor has the caret in the cell (it takes the click's place a moment after it).
    await page.waitForFunction(() => {
      const view = (
        document.querySelector('.ProseMirror') as HTMLElement & {
          editor: {
            view: {
              state: { selection: { $from: { node: (d: number) => { type: { name: string } } } } }
            }
          }
        }
      ).editor.view
      return view.state.selection.$from.node(-1).type.name === 'tableCell'
    })
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/plain', 'one\ntwo\nthree')
      const target = document.querySelector('.ProseMirror')!
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
    })
    await expect(sceneText(page).locator('td').first()).toContainText('one two three')
    await waitSaved(page)
    const body = await bodyOnDisk(page)
    expect(body).toMatch(/\| (one two three1|1one two three|1) ?(one two three)? +\| 2 +\|/)
    expect(body).toMatch(/\| 3 +\| 4 +\|/)
    expect(body.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(4)
  })
})

test.describe('a footnote', () => {
  test('is reached from its reference with Alt+Down and back with Alt+Up', async ({ page }) => {
    await openWithBody(page, 'She had seen it before[^1], and said so.\n\n[^1]: At the harbour.\n')
    const ref = sceneText(page).locator('[data-footnote-ref]')
    await ref.click()
    await expect(ref).toHaveClass(/ProseMirror-selectednode/)
    await page.keyboard.press('Alt+ArrowDown')
    await page.keyboard.type('Yes. ')
    await expect(sceneText(page).locator('[data-footnote-def]')).toContainText(
      'Yes. At the harbour.',
    )
    await page.keyboard.press('Alt+ArrowUp')
    await expect(ref).toHaveClass(/ProseMirror-selectednode/)
  })

  test('is added from the keyboard, edited, and shows its words on hover and when stepped onto', async ({
    page,
  }) => {
    await openWithBody(page, 'The warden knew her face.\n')
    await sceneText(page).click()
    await caretTo(page, 'end')
    await page.keyboard.press(`${MOD}+Alt+f`)
    // The caret is in the new note.
    await page.keyboard.type('She had seen it before.')
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe(
      'The warden knew her face.[^1]\n\n[^1]: She had seen it before.\n',
    )
    const ref = sceneText(page).locator('[data-footnote-ref]')
    await expect(ref).toHaveAttribute('data-number', '1')
    // The number is text, so a screen reader and the caret meet it.
    await expect(ref).toHaveText('1')
    await expect(ref).toHaveAttribute('aria-label', 'Footnote 1: She had seen it before.')
    await expect(sceneText(page).locator('[data-footnote-def]')).toHaveAttribute('data-number', '1')

    // Hover shows the note's words, and moving away takes them down.
    expect((await tooltip(page)).display).toBe('none')
    await ref.hover()
    expect(await tooltip(page)).toEqual({ display: 'block', content: '"She had seen it before."' })
    await page.mouse.move(5, 5)
    expect((await tooltip(page)).display).toBe('none')

    // Stepping onto it with the keyboard shows them too.
    await sceneText(page)
      .locator('p')
      .first()
      .click({ position: { x: 600, y: 10 } })
    // The editor takes the click's place a moment later (the note, where the caret was, is further on); the key must meet it there.
    await page.waitForFunction(
      () =>
        (
          document.querySelector('.ProseMirror') as HTMLElement & {
            editor: { view: { state: { selection: { from: number } } } }
          }
        ).editor.view.state.selection.from <= 27,
    )
    await page.keyboard.press('ArrowLeft')
    await expect(ref).toHaveClass(/ProseMirror-selectednode/)
    expect(await tooltip(page)).toEqual({ display: 'block', content: '"She had seen it before."' })

    // The note is text like any other: edit it, and the words over the number follow.
    await sceneText(page)
      .locator('[data-footnote-def] p')
      .click({ position: { x: 400, y: 6 } })
    await page.waitForFunction(() => {
      const { selection } = (
        document.querySelector('.ProseMirror') as HTMLElement & {
          editor: { view: { state: { selection: { from: number; node?: unknown } } } }
        }
      ).editor.view.state
      return selection.from > 27 && !selection.node
    })
    await page.keyboard.type(' Twice.')
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe(
      'The warden knew her face.[^1]\n\n[^1]: She had seen it before. Twice.\n',
    )
    await expect(ref).toHaveAttribute('data-note', 'She had seen it before. Twice.')
  })

  test('is read from a file as it was written: the labels stay, and renumbering is asked for', async ({
    page,
  }) => {
    const file = 'One[^b] and two[^a].\n\n[^a]: Second.\n[^b]: First.\n'
    await openWithBody(page, file)
    const refs = sceneText(page).locator('[data-footnote-ref]')
    await expect(refs.nth(0)).toHaveAttribute('data-number', '1')
    await expect(refs.nth(1)).toHaveAttribute('data-number', '2')
    // Drawn as numbers, never as the file's labels, and the file is as it was.
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe(file)
    await toolbar(page).getByRole('button', { name: 'Renumber footnotes' }).click()
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe('One[^1] and two[^2].\n\n[^2]: Second.\n\n[^1]: First.\n')
    await expect(toolbar(page).getByRole('button', { name: 'Renumber footnotes' })).toHaveCount(0)
  })
})

test.describe('Mark as change', () => {
  const board = (page: Page) => page.getByRole('dialog', { name: 'What changes in this scene?' })
  /** Select words the way the editor itself does, so what the page selects is what the editor holds. */
  const select = async (page: Page, phrase: string) => {
    await page.evaluate((words) => {
      const { editor } = document.querySelector('.ProseMirror') as HTMLElement & {
        editor: {
          state: {
            doc: {
              descendants: (f: (n: { isText: boolean; text?: string }, pos: number) => void) => void
            }
          }
          commands: {
            setTextSelection: (r: { from: number; to: number }) => void
            focus: () => void
          }
        }
      }
      let from = -1
      editor.state.doc.descendants((node, pos) => {
        if (from < 0 && node.isText && node.text!.includes(words))
          from = pos + node.text!.indexOf(words)
      })
      editor.commands.setTextSelection({ from, to: from + words.length })
      editor.commands.focus()
    }, phrase)
    await page.waitForFunction(() => !window.getSelection()!.isCollapsed)
  }

  test('quotes the words selected in a table cell and in a note, not the footnote’s number', async ({
    page,
  }) => {
    await openWithBody(
      page,
      '| Who | Said |\n| --- | --- |\n| Elena | neither of them spoke |\n\nShe saw it before[^1], and said so.\n\n[^1]: At the harbour, long ago.\n',
    )
    await select(page, 'neither of them spoke')
    await page.keyboard.press('ControlOrMeta+Alt+KeyM')
    await expect(board(page).getByLabel('Quote from the scene (optional)')).toHaveValue(
      'neither of them spoke',
    )
    await page.keyboard.press('Escape')
    await expect(board(page)).toBeHidden()
    await select(page, 'harbour, long')
    await page.keyboard.press('ControlOrMeta+Alt+KeyM')
    await expect(board(page).getByLabel('Quote from the scene (optional)')).toHaveValue(
      'harbour, long',
    )
    await page.keyboard.press('Escape')
    // Words across the reference are quoted without its number.
    await page.evaluate(() => {
      const { editor } = document.querySelector('.ProseMirror') as HTMLElement & {
        editor: {
          state: {
            doc: { child: (i: number) => { nodeSize: number }; firstChild: { nodeSize: number } }
          }
          commands: {
            setTextSelection: (r: { from: number; to: number }) => void
            focus: () => void
          }
        }
      }
      const start = editor.state.doc.firstChild.nodeSize
      editor.commands.setTextSelection({
        from: start + 1,
        to: start + editor.state.doc.child(1).nodeSize - 1,
      })
      editor.commands.focus()
    })
    await page.waitForFunction(() => !window.getSelection()!.isCollapsed)
    await page.keyboard.press('ControlOrMeta+Alt+KeyM')
    await expect(board(page).getByLabel('Quote from the scene (optional)')).toHaveValue(
      'She saw it before, and said so.',
    )
  })
})

test.describe('the Markdown source', () => {
  test('is the scene’s own text in a plain area: switching writes nothing, and typing saves what is typed', async ({
    page,
  }) => {
    await openWithBody(page, BODY)
    await waitSaved(page)
    const before = await bodyOnDisk(page)
    expect(before).toBe(BODY)

    await sourceSwitch(page).click()
    await expect(source(page)).toBeFocused()
    await expect(source(page)).toHaveValue(BODY)
    await expect(editorText(page)).toHaveCount(0)
    await expect(toolbar(page)).toHaveCount(0)
    expect(await source(page).evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
      'JetBrains Mono',
    )
    await sourceSwitch(page).click()
    await expect(sceneText(page)).toBeFocused()
    await expect(sceneText(page).locator('table')).toHaveCount(1)
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe(before)

    // Type in it: the file is exactly what was typed, odd spacing and all.
    await sourceSwitch(page).click()
    await source(page).evaluate((el: HTMLTextAreaElement) => {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    await page.keyboard.type(
      '\n\nA line\twith  odd   spacing, and a [^2] kept.\n\n[^2]: Typed here.',
    )
    await waitSaved(page)
    const typed = `${BODY}\n\nA line\twith  odd   spacing, and a [^2] kept.\n\n[^2]: Typed here.`
    expect(await bodyOnDisk(page)).toBe(typed)
    // Back to the editor: it shows what was typed, as a second number and its note.
    await sourceSwitch(page).click()
    await expect(sceneText(page).locator('[data-footnote-ref]')).toHaveCount(2)
    await expect(sceneText(page).locator('[data-footnote-def]').last()).toContainText('Typed here.')
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe(typed)
  })
})

test.describe('tables, footnotes and the source pass axe', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openWithBody(page, BODY)
      await sceneText(page).locator('td').first().click()
      await expect(toolbar(page).getByRole('button', { name: 'Table actions' })).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
      await toolbar(page).getByRole('button', { name: 'Table actions' }).click()
      await expect(page.getByRole('menuitem', { name: 'Add row below' })).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
      await page.keyboard.press('Escape')
      await sceneText(page).locator('[data-footnote-ref]').hover()
      expect((await tooltip(page)).display).toBe('block')
      expect(await seriousViolations(page)).toEqual([])
      await sourceSwitch(page).click()
      await expect(source(page)).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
    })
  }

  test('on a phone, with a table under the thumb', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openWithBody(page, BODY)
    await sceneText(page).locator('td').first().click()
    await expect(toolbar(page).getByRole('button', { name: 'Table actions' })).toBeVisible()
    expect(await seriousViolations(page)).toEqual([])
    // The page never scrolls sideways.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
})

// Not assertions: pictures to compare with docs/design by eye (written to test-results/).
const shots = 'test-results/editor-tables-screenshots'
test.describe('screenshots', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  for (const scheme of ['light', 'dark'] as const) {
    test(`a table, a footnote and the source in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openWithBody(page, BODY)
      await sceneText(page).locator('td').first().click()
      await page.locator('#main-content').evaluate((el) => el.scrollTo(0, 0))
      await page.screenshot({ path: `${shots}/table-${scheme}.png` })
      await toolbar(page).getByRole('button', { name: 'Table actions' }).click()
      await page.screenshot({ path: `${shots}/table-menu-${scheme}.png` })
      await page.keyboard.press('Escape')
      await sceneText(page).locator('[data-footnote-ref]').hover()
      await page.screenshot({ path: `${shots}/footnote-${scheme}.png` })
      await page.mouse.move(5, 5)
      await sourceSwitch(page).click()
      await page.screenshot({ path: `${shots}/source-${scheme}.png` })
    })
  }
})
