// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { readZip } from '../helpers/read-zip'
import {
  banner,
  createBrowserWorkspace,
  firstScenePath,
  opfs,
  sceneText,
  seriousViolations,
  statusBar,
  waitSaved,
} from '../helpers/browser-workspace'

// Playwright cannot click the native folder picker, so these run on browser storage (OPFS).
// The folder adapter shares its code (HandleAdapter) and runs the same contract in the last test.

test.describe('a workspace in this browser', () => {
  test('is created, written in, and still there after a reload', async ({ page }) => {
    await createBrowserWorkspace(page)
    await expect(statusBar(page)).toContainText('Only in this browser')
    await sceneText(page).fill('The bells had already started.')
    await waitSaved(page)
    await page.reload()
    await expect(sceneText(page)).toHaveValue('The bells had already started.')
    await expect(statusBar(page)).toContainText('5 scene')
    // The file on disk is a Markdown file with its details at the top and the words after.
    const file = await opfs.read(page, await firstScenePath(page))
    expect(file).toMatch(/^---\ntitle: "Untitled scene"\nschemaVersion: 1\nid: "scn_\w+"/)
    expect(file.endsWith('\n\nThe bells had already started.')).toBe(true)
  })

  test('opens again with no network', async ({ page, context }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Written on the train, no signal.')
    await waitSaved(page)
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload() // now the page is controlled by the service worker
    await expect(sceneText(page)).toHaveValue('Written on the train, no signal.')
    await context.setOffline(true)
    await page.reload()
    await expect(sceneText(page)).toHaveValue('Written on the train, no signal.')
    await context.setOffline(false)
  })

  test('survives a killed write: the journal has the words and the next start saves them', async ({
    page,
    context,
  }) => {
    // Every file write fails while the flag is set, as if the tab died mid-save.
    await page.addInitScript(() => {
      const proto = FileSystemFileHandle.prototype
      const real = proto.createWritable
      proto.createWritable = function (this: FileSystemFileHandle, ...args) {
        if (localStorage.getItem('kill-writes') === '1')
          return Promise.reject(new DOMException('killed', 'AbortError'))
        return real.apply(this, args)
      }
    })
    await createBrowserWorkspace(page)
    const path = await firstScenePath(page)
    const before = await opfs.read(page, path)
    await page.evaluate(() => localStorage.setItem('kill-writes', '1'))
    await sceneText(page).fill('These words must not be lost.')
    await expect(statusBar(page)).toContainText('Save failed — will retry')
    await expect(page.getByRole('alert')).toContainText('recovery journal')
    expect(await opfs.read(page, path)).toBe(before) // nothing half-written
    await page.evaluate(() => localStorage.removeItem('kill-writes'))
    await page.close() // the tab dies; the words are only in the journal

    const next = await context.newPage()
    await next.goto('/')
    await expect(next.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible()
    await next.getByRole('button', { name: /My Writing/ }).click()
    await expect(sceneText(next)).toHaveValue('These words must not be lost.')
    await expect(banner(next, 'Saved what was still waiting')).toBeVisible()
    await waitSaved(next)
    expect(await opfs.read(next, path)).toContain('These words must not be lost.')
    // Done once: the next start has nothing to recover.
    await next.reload()
    await expect(sceneText(next)).toHaveValue('These words must not be lost.')
    await expect(next.getByText('Saved what was still waiting')).toHaveCount(0)
  })

  test('saves without createWritable too (older Safari), through a worker', async ({ page }) => {
    await page.addInitScript(
      () => delete (FileSystemFileHandle.prototype as { createWritable?: unknown }).createWritable,
    )
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Written through the worker.')
    await waitSaved(page)
    await page.reload()
    await expect(sceneText(page)).toHaveValue('Written through the worker.')
  })

  test('asks the browser to keep it, shows the answer, and suggests installing once', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('First words.')
    await waitSaved(page)
    await expect(banner(page, 'Install Aurelia as an app')).toBeVisible()
    await page.getByRole('button', { name: 'Not now' }).click()
    await page.reload()
    await expect(sceneText(page)).toBeVisible()
    await expect(page.getByText('Install Aurelia as an app')).toHaveCount(0)
    await page.getByRole('button', { name: 'Only in this browser' }).click()
    await expect(
      page.getByText(/Kept by the browser|Not protected from clean-up|Not asked yet/),
    ).toBeVisible()
    await expect(page.getByText('The browser holds the only copy')).toBeVisible()
  })

  test('lists the workspace as recent on the Welcome screen', async ({ page }) => {
    await createBrowserWorkspace(page, 'The Saltmarch Draft')
    await page.goto('/')
    const row = page.getByRole('button', { name: /The Saltmarch Draft/ })
    await expect(row).toContainText('this browser')
    await expect(row).toContainText('opened today')
    expect(await seriousViolations(page)).toEqual([])
    await row.click()
    await expect(sceneText(page)).toBeVisible()
  })

  test('adds a new scene after the last one, and both are there after a reload', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Scene one.')
    await page.getByRole('button', { name: 'New scene in this chapter' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Untitled scene 2' })).toBeVisible()
    await expect(sceneText(page)).toHaveValue('')
    await sceneText(page).fill('Scene two.')
    await waitSaved(page)
    const files = await opfs.list(page)
    expect(files.filter((f) => /\/scenes\/scn_\w+\.md$/.test(f))).toHaveLength(2)
    await page.reload()
    await expect(sceneText(page)).toHaveValue('Scene two.')
    await page
      .getByRole('navigation', { name: 'Workspace' })
      .getByText('Untitled scene', { exact: true })
      .click()
    await expect(sceneText(page)).toHaveValue('Scene one.')
  })

  test('downloads a zip with every file in the workspace', async ({ page }) => {
    await createBrowserWorkspace(page, 'Zip Test')
    await sceneText(page).fill('Words for the zip.')
    await page.getByRole('button', { name: 'Only in this browser' }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download a copy (.zip)' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^Zip Test \d{4}-\d{2}-\d{2}\.zip$/)
    const entries = readZip(new Uint8Array(readFileSync(await file.path())))
    expect(entries.every((e) => e.crcOk)).toBe(true)
    const onDisk = (await opfs.list(page)).map((p) => `Zip Test/${p.split('/').slice(1).join('/')}`)
    expect(entries.map((e) => e.path).sort()).toEqual(onDisk)
    expect(entries.find((e) => e.path.includes('/scenes/'))?.text).toContain('Words for the zip.')
  })
})

test.describe('changes made outside Aurelia', () => {
  test('a scene with nothing unsaved reloads in place, with a note', async ({ page }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Mine.')
    await waitSaved(page)
    const path = await firstScenePath(page)
    const file = await opfs.read(page, path)
    await opfs.write(page, path, file.replace('Mine.', 'Changed by another app.'))
    await expect(sceneText(page)).toHaveValue('Changed by another app.', { timeout: 8000 })
    await expect(banner(page, 'Reloaded after a change outside Aurelia')).toBeVisible()
  })

  test('unsaved words are never overwritten: both versions are kept and the author chooses', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Mine, saved.')
    await waitSaved(page)
    const path = await firstScenePath(page)
    const saved = await opfs.read(page, path)

    await sceneText(page).fill('Mine, and not saved yet.')
    await opfs.write(page, path, saved.replace('Mine, saved.', 'Theirs, from another device.'))
    const conflictBanner = banner(page, 'changed outside Aurelia while it was open here')
    await expect(conflictBanner).toBeVisible({ timeout: 8000 })
    await expect(statusBar(page)).toContainText('Changed outside Aurelia')
    await expect(sceneText(page)).toHaveValue('Mine, and not saved yet.')
    expect(await opfs.read(page, path)).toContain('Theirs, from another device.') // not overwritten

    await conflictBanner.getByRole('button', { name: 'Compare versions' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Your version, text')).toContainText('Mine, and not saved yet.')
    await expect(dialog.getByLabel('The file’s version, text')).toContainText(
      'Theirs, from another device.',
    )
    expect(await seriousViolations(page)).toEqual([])

    await dialog.getByRole('button', { name: 'Keep mine' }).click()
    await expect(dialog).toBeHidden()
    await waitSaved(page)
    expect(await opfs.read(page, path)).toContain('Mine, and not saved yet.')
    const copy = (await opfs.list(page)).find((f) => f.includes('(Aurelia copy)'))!
    expect(await opfs.read(page, copy)).toContain('Theirs, from another device.')
    // The copy is shown like any conflicted copy, ready to reconcile.
    await expect(banner(page, 'set aside by a sync tool')).toBeVisible()
  })

  test('a conflicted copy from a sync tool is found and reconciled without deleting anything', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Original.')
    await waitSaved(page)
    const path = await firstScenePath(page)
    const copyPath = path.replace('.md', ' (conflicted copy).md')
    await opfs.write(
      page,
      copyPath,
      (await opfs.read(page, path)).replace('Original.', 'The other device.'),
    )
    await page.reload() // found on load (and on focus)
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Files to look at' })
    await expect(dialog).toContainText('(conflicted copy).md')
    expect(await seriousViolations(page)).toEqual([])
    await dialog.getByRole('button', { name: 'Keep the original' }).click()
    await expect(dialog.getByText('Nothing left to look at.')).toBeVisible()
    const files = await opfs.list(page)
    expect(files.some((f) => f.includes('(conflicted copy)') && !f.includes('/.aurelia/'))).toBe(
      false,
    )
    const kept = files.filter((f) => f.includes('/.aurelia/conflicts/'))
    expect(kept).toHaveLength(1)
    expect(await opfs.read(page, kept[0]!)).toContain('The other device.')
    expect(await opfs.read(page, path)).toContain('Original.')
  })

  test('a workspace from a newer Aurelia opens read-only and nothing is written', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Written by an older version.')
    await waitSaved(page)
    const path = await firstScenePath(page)
    const newer = (await opfs.read(page, path)).replace('schemaVersion: 1', 'schemaVersion: 2')
    await opfs.write(page, path, newer)
    await page.reload()
    await expect(sceneText(page)).toHaveAttribute('readonly', '')
    await expect(sceneText(page)).toHaveValue('Written by an older version.')
    await expect(statusBar(page)).toContainText('Read-only')
    await expect(page.getByText('saved by a newer version of Aurelia')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New scene in this chapter' })).toHaveCount(0)
    await sceneText(page).press('End')
    await page.keyboard.type('x')
    await page.waitForTimeout(1500)
    expect(await opfs.read(page, path)).toBe(newer)
    expect(await seriousViolations(page)).toEqual([])
  })
})

test.describe('the writing surface and the keyboard', () => {
  test('the page has no ring around it while you write, only a caret, and is named by its scene', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).focus()
    const style = await sceneText(page).evaluate((el) => {
      const s = getComputedStyle(el)
      return { outline: s.outlineStyle, caret: s.caretColor, auto: s.caretColor === 'auto' }
    })
    expect(style.outline).toBe('none')
    expect(style.auto).toBe(false)
    await expect(page.getByRole('textbox', { name: /Scene text.*Untitled scene/ })).toBeVisible()
  })

  test('the conflict is reached, read and settled with the keyboard alone', async ({ page }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Mine, saved.')
    await waitSaved(page)
    const path = await firstScenePath(page)
    const saved = await opfs.read(page, path)
    await sceneText(page).fill('Mine, and not saved yet.')
    await opfs.write(page, path, saved.replace('Mine, saved.', 'Theirs, from another device.'))
    await expect(banner(page, 'changed outside Aurelia while it was open here')).toBeVisible({
      timeout: 8000,
    })

    const compare = page.getByRole('button', { name: 'Compare versions' })
    for (let i = 0; i < 40 && !(await compare.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Shift+Tab') // the banner sits above the text: back from it
    await expect(compare).toBeFocused()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(compare).toBeFocused()

    await page.keyboard.press('Enter')
    const keepMine = dialog.getByRole('button', { name: 'Keep mine' })
    for (
      let i = 0;
      i < 10 && !(await keepMine.evaluate((el) => el === document.activeElement));
      i++
    )
      await page.keyboard.press('Tab')
    await expect(keepMine).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await waitSaved(page)
    expect(await opfs.read(page, path)).toContain('Mine, and not saved yet.')
  })
})

test.describe('one workspace in two tabs', () => {
  test('the second tab is read-only with a plain banner, and writes once the first is closed', async ({
    page,
    context,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Words from the first tab.')
    await waitSaved(page)
    const second = await context.newPage()
    await second.goto('/')
    await second.getByRole('button', { name: /My Writing/ }).click()
    await expect(sceneText(second)).toHaveValue('Words from the first tab.')
    await expect(banner(second, 'This workspace is open in another tab')).toContainText(
      'Close that tab to write here.',
    )
    await expect(sceneText(second)).toHaveAttribute('readonly', '')
    await expect(second.getByText('newer version')).toHaveCount(0)
    await page.close() // the first tab lets go
    await expect(banner(second, 'This workspace is open in another tab')).toHaveCount(0)
    await expect(sceneText(second)).not.toHaveAttribute('readonly', '')
    await sceneText(second).fill('Words from the second tab.')
    await waitSaved(second)
    expect(await opfs.read(second, await firstScenePath(second))).toContain(
      'Words from the second tab.',
    )
  })
})

test.describe('accessibility of the saving screens', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`welcome, writing and the storage popover pass axe in the ${scheme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await createBrowserWorkspace(page)
      await sceneText(page).fill('Some words.')
      await waitSaved(page)
      expect(await seriousViolations(page)).toEqual([]) // includes the install tip banner
      await page.getByRole('button', { name: 'Only in this browser' }).click()
      await expect(page.getByRole('button', { name: 'Download a copy (.zip)' })).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
      await page.goto('/') // Welcome, with the workspace in the recent list
      await expect(page.getByRole('button', { name: /My Writing/ })).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
    })
  }
})

test('the adapter contract passes in a real browser, on browser storage and on an OPFS folder handle', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__aureliaTest) // the hook loads after the page
  const run = (target: 'browser' | 'folder', withoutCreateWritable = false) =>
    page.evaluate(
      ([t, w]) => window.__aureliaTest!.runContract(t as 'browser' | 'folder', w as boolean),
      [target, withoutCreateWritable] as const,
    )
  const failures = (results: { name: string; ok: boolean; error?: string }[]) =>
    results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.error}`)
  const browser = await run('browser')
  expect(browser.length).toBeGreaterThan(8)
  expect(failures(browser)).toEqual([])
  expect(failures(await run('folder'))).toEqual([])
  expect(failures(await run('browser', true))).toEqual([]) // the worker path
  expect(await page.evaluate(() => window.__aureliaTest!.abortedWriteKeepsOldFile())).toMatchObject(
    {
      ok: true,
    },
  )
})
