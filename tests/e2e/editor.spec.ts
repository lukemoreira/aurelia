// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test'
import {
  createBrowserWorkspace,
  firstScenePath,
  opfs,
  sceneText,
  seriousViolations,
  statusBar,
  waitSaved,
} from '../helpers/browser-workspace'

const MOD = 'ControlOrMeta'
const type = (page: Page, text: string) => page.keyboard.type(text)
/** Move the caret to the start or the end of the scene (Cmd+End scrolls on a Mac and does not move it). */
const caretTo = (page: Page, where: 'start' | 'end') =>
  page.evaluate((to) => {
    const dom = document.querySelector('.ProseMirror') as HTMLElement & {
      editor: { commands: { focus: (position: string) => void } }
    }
    dom.editor.commands.focus(to)
  }, where)
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })

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

const RICH = `The bells had already started when Elena reached the Lantern Gate, and the warden looked up.

## A heading

Plain **bold** and *italic* and <u>underlined</u> and ~~struck~~ and a [link](https://example.com) and [[Elena Vasquez]].

- A list
  - nested
- [ ] A task
- [x] A done task

1. First
2. Second

> A quote.

> [!note] Heads up
> The warden knows her face.

* * *

| A | B |
| - | - |
| 1 | 2 |

Footnote[^1] and <b>raw html</b>.

[^1]: The note.
`

test.describe('writing in the editor', () => {
  test('typed formatting is the same Markdown on disk and the same text after a reload', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).click()
    await type(page, '## Chapter heading\nThe ')
    await page.keyboard.press(`${MOD}+b`)
    await type(page, 'bold')
    await page.keyboard.press(`${MOD}+b`)
    await type(page, ' and ')
    await page.keyboard.press(`${MOD}+i`)
    await type(page, 'italic')
    await page.keyboard.press(`${MOD}+i`)
    await type(page, ' and ')
    await page.keyboard.press(`${MOD}+u`)
    await type(page, 'under')
    await page.keyboard.press(`${MOD}+u`)
    await type(page, ' words.\n- one\ntwo\n\n> quoted\n\n> [!tip] Mind the gate\n\n--- After.')
    await waitSaved(page)

    const expected =
      '## Chapter heading\n\nThe **bold** and *italic* and <u>under</u> words.\n\n- one\n- two\n\n> quoted\n\n> [!tip]\n> Mind the gate\n\n* * *\n\nAfter.\n'
    expect(await bodyOnDisk(page)).toBe(expected)
    // An empty paragraph at the end (a place to type) is not written, so it is not there after a reload.
    const shown = (await sceneText(page).innerHTML()).replace(
      /<p><br class="ProseMirror-trailingBreak"><\/p>$/,
      '',
    )

    await page.reload()
    await expect(sceneText(page)).toBeVisible()
    expect(await sceneText(page).innerHTML()).toBe(shown)
    expect(await bodyOnDisk(page)).toBe(expected)
  })

  test('the toolbar and the keyboard make marks, a link and a scene break', async ({ page }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).click()
    await type(page, 'Some words here')
    await page.keyboard.press('Shift+Home')
    await toolbar(page).getByRole('button', { name: 'Bold' }).click()
    await expect(toolbar(page).getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(sceneText(page)).toBeFocused() // the bar never took the caret
    await page.keyboard.press('ArrowRight')
    await toolbar(page).getByRole('button', { name: 'Link' }).click()
    await page.getByLabel('Link address').fill('example.com')
    await page.getByRole('button', { name: 'Add link' }).click()
    await expect(sceneText(page)).toBeFocused()
    await toolbar(page).getByRole('button', { name: 'Scene break' }).click()
    await type(page, 'After.')
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe(
      '**Some words here**[example.com](https://example.com)\n\n* * *\n\nAfter.\n',
    )
  })

  test('opening a scene writes nothing, and neither does moving through it', async ({ page }) => {
    await openWithBody(page, RICH)
    const path = await firstScenePath(page)
    const before = await opfs.read(page, path)
    const modified = () =>
      page.evaluate(async (p) => {
        let dir = await navigator.storage.getDirectory()
        const parts = ['workspaces', ...p.split('/')]
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
        return (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).lastModified
      }, path)
    const stamp = await modified()
    await sceneText(page).click()
    await caretTo(page, 'end')
    await page.keyboard.press('ArrowUp')
    await caretTo(page, 'start')
    await page.waitForTimeout(1500)
    expect(await opfs.read(page, path)).toBe(before)
    expect(await modified()).toBe(stamp)
    await expect(statusBar(page)).toContainText('Saved')
  })

  test('an edit rewrites only its own paragraph; tables, footnotes and raw HTML stay as they were', async ({
    page,
  }) => {
    await openWithBody(page, RICH)
    await sceneText(page).getByText('A quote.').click()
    await page.keyboard.press('End')
    await type(page, ' More.')
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe(RICH.replace('> A quote.', '> A quote. More.'))
    // The table and the footnote are shown as text, never as a table.
    await expect(sceneText(page).locator('table')).toHaveCount(0)
    await expect(sceneText(page)).toContainText('| A | B |')
    await expect(sceneText(page)).toContainText('[^1]: The note.')
    await expect(sceneText(page).locator('b')).toHaveCount(0)
    await expect(sceneText(page)).toContainText('<b>raw html</b>')
  })

  test('the caret is never left under the formatting bar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 })
    await openWithBody(page, RICH)
    await sceneText(page).click()
    await caretTo(page, 'end')
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowUp') // native moves, as a person makes
    const caret = () =>
      page.evaluate(() => getSelection()!.getRangeAt(0).getBoundingClientRect().top)
    const bar = (await toolbar(page).boundingBox())!
    expect(await caret()).toBeGreaterThan(bar.y + bar.height)
    for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowDown')
    expect(await caret()).toBeLessThan(700)
  })

  test('another scene opens in a moment, and each keeps its own text', async ({ page }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Scene one words.')
    await waitSaved(page)
    await page.getByRole('button', { name: 'New scene in this chapter' }).click()
    await expect(sceneText(page)).toHaveText('')
    await sceneText(page).fill('Scene two words.')
    await waitSaved(page)
    await page
      .getByRole('navigation', { name: 'Workspace' })
      .getByText('Untitled scene', { exact: true })
      .click()
    await expect(sceneText(page)).toHaveText('Scene one words.')
  })
})

test.describe('a long scene', () => {
  test('typing in 20,000 words has no lag: a keystroke is on screen within a frame or two', async ({
    page,
  }) => {
    const paragraph =
      'The bells had already started when Elena reached the Lantern Gate, and the warden, who knew her face, said nothing at all for a long moment while the lamps were lit one by one along the arch.'
    const body = Array.from({ length: 20_000 / 35 }, () => paragraph).join('\n\n')
    await openWithBody(page, body)
    await sceneText(page).click()
    await caretTo(page, 'end')
    const times = await page.evaluate(async () => {
      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
      const out: number[] = []
      for (let i = 0; i < 150; i++) {
        const start = performance.now()
        document.execCommand('insertText', false, 'x')
        await frame()
        out.push(performance.now() - start)
      }
      return out.sort((a, b) => a - b)
    })
    const p95 = times[Math.floor(times.length * 0.95)]!
    expect(p95, `p95 ${p95.toFixed(1)} ms, median ${times[75]!.toFixed(1)} ms`).toBeLessThan(60)
    // The file had no final newline, and an edit does not add one.
    await expect
      .poll(async () => (await bodyOnDisk(page)).endsWith('x'.repeat(150)), {
        timeout: 15_000,
      })
      .toBe(true)
  })
})

test.describe('focus mode', () => {
  test('hides every bar and panel, keeps the text, and Escape brings them back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Quiet words.')
    await expect(statusBar(page)).toBeVisible()
    await expect(toolbar(page)).toBeVisible()
    await page.getByRole('button', { name: 'Focus mode' }).click()
    await expect(statusBar(page)).toBeHidden()
    await expect(toolbar(page)).toBeHidden()
    await expect(page.getByRole('banner')).toBeHidden()
    await expect(page.getByRole('complementary')).toHaveCount(0)
    await expect(sceneText(page)).toHaveText('Quiet words.')
    await expect(page.getByRole('button', { name: 'Exit focus mode' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(statusBar(page)).toBeVisible()
    await expect(toolbar(page)).toBeVisible()
    await page.keyboard.press(`${MOD}+Shift+F`) // F11 never reaches a page in Chrome or Edge
    await expect(statusBar(page)).toBeHidden()
    await page.getByRole('button', { name: 'Exit focus mode' }).click()
    await expect(statusBar(page)).toBeVisible()
    await page.keyboard.press('F11') // the desktop build gets it
    await expect(statusBar(page)).toBeHidden()
  })

  test('on a phone the way out is a 44 px row above the text, not a button over it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openWithBody(page, RICH)
    await page.keyboard.press(`${MOD}+Shift+F`)
    const exit = page.getByRole('button', { name: 'Exit focus mode' })
    await expect(exit).toBeVisible()
    const button = (await exit.boundingBox())!
    expect(button.height).toBeGreaterThanOrEqual(44)
    const text = (await sceneText(page).boundingBox())!
    expect(button.y + button.height).toBeLessThanOrEqual(text.y)
    await exit.click()
    await expect(toolbar(page)).toBeVisible()
  })
})

test.describe('after a menu or a box in the formatting bar', () => {
  test('the caret is back in the text: a text style, then typing', async ({ page }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).click()
    await toolbar(page)
      .getByRole('button', { name: /^Text style/ })
      .click()
    await page.keyboard.press('ArrowDown') // Paragraph
    await page.keyboard.press('ArrowDown') // Heading 1
    await page.keyboard.press('Enter')
    await expect(sceneText(page)).toBeFocused()
    await type(page, 'Heading words')
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe('# Heading words\n')
  })

  test('the caret is back in the text: a text style menu left with Escape', async ({ page }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).click()
    await toolbar(page)
      .getByRole('button', { name: /^Text style/ })
      .click()
    await expect(page.getByRole('menuitem', { name: 'Heading 1' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sceneText(page)).toBeFocused()
  })

  test('the caret is back in the text: a link by keyboard, and again after Escape', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).click()
    await type(page, 'Some words')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.waitForTimeout(150) // a person's pace: the selection reaches the editor's state
    const link = toolbar(page).getByRole('button', { name: 'Link' })
    await link.focus()
    await page.keyboard.press('Enter')
    await page.getByLabel('Link address').fill('example.com')
    await page.keyboard.press('Enter')
    await expect(sceneText(page)).toBeFocused()
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('Link address')).toBeVisible() // it opens again
    await page.keyboard.press('Escape')
    await expect(sceneText(page)).toBeFocused()
    await waitSaved(page)
    expect(await bodyOnDisk(page)).toBe('Some word[s](https://example.com)\n')
  })
})

test.describe('headings', () => {
  test('the scene title is the page’s only first-level heading; the text’s start below it', async ({
    page,
  }) => {
    await openWithBody(page, RICH)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Untitled scene')
    await expect(sceneText(page).getByRole('heading', { level: 3 })).toHaveText('A heading')
    const size = (selector: string) =>
      page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(await size('#scene-title')).toBeGreaterThan(await size('[data-level="2"]'))
  })
})

test.describe('on a phone', () => {
  test('the bar ends in a Done that puts the keyboard away', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await createBrowserWorkspace(page)
    await sceneText(page).click()
    await expect(sceneText(page)).toBeFocused()
    const done = toolbar(page).getByRole('button', { name: 'Done' })
    const box = (await done.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(40)
    await done.click()
    await expect(sceneText(page)).not.toBeFocused()
  })
})

test.describe('settings for the text', () => {
  test('font, size, line height and paragraph spacing apply at once and are kept on this device', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await createBrowserWorkspace(page)
    await sceneText(page).click()
    await type(page, 'One.\nTwo.')
    const look = () =>
      sceneText(page).evaluate((el) => {
        const s = getComputedStyle(el.closest('.manuscript')!)
        const second = getComputedStyle(el.querySelectorAll('p')[1]!)
        return {
          family: s.fontFamily.split(',')[0]!.replace(/['"]/g, ''),
          size: s.fontSize,
          leading: s.lineHeight,
          indent: second.textIndent,
          gap: second.marginTop,
        }
      })
    expect(await look()).toMatchObject({
      family: 'Literata',
      size: '19px',
      indent: '30.4px',
      gap: '0px',
    })

    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog
      .getByRole('radiogroup', { name: 'Font' })
      .getByRole('radio', { name: 'Sans' })
      .click()
    await dialog
      .getByRole('radiogroup', { name: 'Text size' })
      .getByRole('radio', { name: 'Large', exact: true })
      .click()
    await dialog
      .getByRole('radiogroup', { name: 'Line height' })
      .getByRole('radio', { name: 'Roomy' })
      .click()
    await dialog
      .getByRole('radiogroup', { name: 'Paragraphs' })
      .getByRole('radio', { name: 'Space', exact: true })
      .click()
    await page.keyboard.press('Escape')
    const changed = await look()
    expect(changed).toMatchObject({ family: 'Inter', size: '21px', indent: '0px' })
    expect(parseFloat(changed.leading)).toBeCloseTo(21 * 2.05, 0)
    expect(parseFloat(changed.gap)).toBeGreaterThan(10)

    await page.reload()
    await expect(sceneText(page)).toBeVisible()
    expect(await look()).toEqual(changed)
  })
})

test.describe('the editor passes axe', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`with every kind of block in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openWithBody(page, RICH)
      await expect(toolbar(page)).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
      await sceneText(page).click()
      await toolbar(page)
        .getByRole('button', { name: /^Text style/ })
        .click()
      await expect(page.getByRole('menuitem', { name: 'Heading 2' })).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
      await page.keyboard.press('Escape')
      await toolbar(page).getByRole('button', { name: 'Link' }).click()
      await expect(page.getByLabel('Link address')).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
    })
  }

  test('on a phone, with the bar along the bottom', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openWithBody(page, RICH)
    await expect(toolbar(page)).toBeVisible()
    const box = (await toolbar(page).boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    for (const b of await toolbar(page).getByRole('button').all()) {
      const size = (await b.boundingBox())!
      expect(size.width).toBeGreaterThanOrEqual(30)
    }
    expect(await seriousViolations(page)).toEqual([])
  })
})

// Not assertions: pictures to compare with docs/design by eye (written to test-results/).
const shots = 'test-results/m4-screenshots'
test.describe('screenshots', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  for (const scheme of ['light', 'dark'] as const) {
    test(`the editor in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openWithBody(page, RICH)
      await sceneText(page).click()
      await caretTo(page, 'start')
      await page.locator('#main-content').evaluate((el) => el.scrollTo(0, 0))
      await page.screenshot({ path: `${shots}/editor-${scheme}.png` })
    })
  }
  test('focus mode', async ({ page }) => {
    await openWithBody(page, RICH)
    await page.getByRole('button', { name: 'Focus mode' }).click()
    await expect(statusBar(page)).toBeHidden()
    await page.screenshot({ path: `${shots}/focus-mode-light.png` })
  })
  test('the phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openWithBody(page, RICH)
    await sceneText(page).click()
    await caretTo(page, 'start')
    await page.locator('#main-content').evaluate((el) => el.scrollTo(0, 0))
    await page.screenshot({ path: `${shots}/phone-light.png` })
  })
})
