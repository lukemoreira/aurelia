// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

async function allViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  )
}

async function openSample(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Open the sample universe/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Curfew Bells' })).toBeVisible()
}
const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name })
const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })

test.describe('welcome and opening the sample', () => {
  test('the sample opens on Curfew Bells, with its details beside it', async ({ page }) => {
    await openSample(page)
    await expect(page).toHaveURL(/\/w\/bok_\w+\/scn_\w+$/)
    await expect(page.getByText('Chapter Seven · Scene 2')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Scene inspector' })).toContainText(
      'Get through the gate',
    )
    await expect(page.getByRole('contentinfo')).toContainText('Sample workspace · not saved')
  })

  test('says nothing is saved, and never that it is', async ({ page }) => {
    await openSample(page)
    const body = page.locator('body')
    // "not saved" is the truth for now; a bare "Saved", a tick or a backup chip would not be.
    await expect(body).not.toContainText(/(?<!not )saved/i)
    await expect(body).not.toContainText('turn on backup')
    await expect(body).not.toContainText('Spelling')
    await expect(page.getByRole('contentinfo')).toContainText('not saved')
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toContainText('not saved')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('body')).not.toContainText(/(?<!not )saved/i)
    await expect(page.getByRole('banner')).toContainText('not saved')
  })

  test('offers a folder where the browser can pick one, and says what it needs where it cannot', async ({
    page,
  }) => {
    await page.goto('/')
    const folder = page.getByRole('button', { name: /Choose a folder/ })
    await expect(folder).not.toHaveAttribute('aria-disabled', /.*/) // Chromium has the picker
    await expect(folder).toContainText('Recommended') // the one gold card
    await expect(folder).toHaveClass(/border-gold/)
    await expect(page.getByRole('button', { name: /Keep it in this browser/ })).not.toHaveClass(
      /border-gold/,
    )

    await page.addInitScript(
      () => delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker,
    )
    await page.goto('/')
    const unavailable = page.getByRole('button', { name: /Choose a folder/ })
    await expect(unavailable).toHaveAttribute('aria-disabled', 'true')
    await expect(unavailable).toContainText('Needs Chrome or Edge')
    await unavailable.click({ force: true }) // aria-disabled: Playwright would wait for it to enable
    await expect(page.getByRole('status')).toContainText('needs Chrome or Edge')
    await expect(page).toHaveURL(/\/$/)
  })

  test('browser storage says the browser holds the only copy, and promises no cloud copy yet', async ({
    page,
  }) => {
    await page.goto('/')
    const browser = page.getByRole('button', { name: /Keep it in this browser/ })
    await expect(browser).toContainText('Only in this browser')
    await expect(browser).toContainText('holds the only copy')
    await expect(page.locator('body')).not.toContainText(/aurelia copies it/i)
    const sample = page.getByRole('button', { name: /Open the sample universe/ })
    await expect(sample).toContainText('Not saved')
  })

  test('a workspace address with nothing open goes back to the welcome screen', async ({
    page,
  }) => {
    await page.goto('/w/bok_aaaaaaaaaa/scn_aaaaaaaaaa')
    await expect(heading(page, 'Welcome')).toBeVisible()
  })

  test('the app offers a manifest to install from', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
  })

  test('the saved theme is on the page before any app script runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => localStorage.setItem('aurelia.theme', 'dark'))
    await page.route(/\/assets\/.*\.js$/, (route) => route.abort())
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(heading(page, 'Welcome')).toHaveCount(0) // the app itself never ran
  })

  test('the built page carries a content security policy, and the app still works under it', async ({
    page,
  }) => {
    const problems: string[] = []
    page.on(
      'console',
      (m) => m.text().includes('Content Security Policy') && problems.push(m.text()),
    )
    page.on('pageerror', (e) => problems.push(e.message))
    await page.goto('/')
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
      'content',
      /default-src 'self'.*object-src 'none'/,
    )
    await openSample(page)
    expect(problems).toEqual([])
  })

  test('the first paint can use fonts that are already loading', async ({ page }) => {
    await page.goto('/')
    const preloads = page.locator('link[rel="preload"][as="font"][type="font/woff2"]')
    await expect(preloads).toHaveCount(3)
    await expect(preloads.first()).toHaveAttribute('crossorigin', '')
  })

  test('the app shell opens offline once it has been loaded', async ({ page, context }) => {
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await page.reload() // from here the worker serves the page
    await context.setOffline(true)
    await page.reload()
    await expect(heading(page, 'Welcome')).toBeVisible()
    await context.setOffline(false)
  })
})

test.describe('moving around', () => {
  test('switches books from the book switcher and from the navigator', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: /Switch book/ }).click()
    await page.getByRole('menuitem', { name: 'Tidebound' }).click()
    await expect(heading(page, 'First Light')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Switch book: Tidebound' })).toBeVisible()

    await page.getByRole('treeitem', { name: /Salt & Ash/ }).click()
    await expect(heading(page, 'Washed Ashore')).toBeVisible()
    // A branching book gets the Story map tab, and its choices show in the inspector.
    await expect(
      page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Story map' }),
    ).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Scene inspector' })).toContainText(
      'Follow the lights',
    )
  })

  test('switches universe from the navigator', async ({ page }) => {
    await openSample(page)
    await page
      .getByRole('navigation', { name: 'Workspace' })
      .getByRole('button', { name: /Saltmarch/ })
      .click()
    await page.getByRole('menuitem', { name: 'The Long Winter of 1709' }).click()
    await expect(heading(page, 'First Frost')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toContainText(
      'Standalone · 1 book',
    )
  })

  test('opens a scene from the navigator, and a chapter opens its first scene', async ({
    page,
  }) => {
    await openSample(page)
    await page.getByRole('treeitem', { name: /Tide Bell/ }).click()
    await expect(heading(page, 'Tide Bell')).toBeVisible()
    await page.getByRole('treeitem', { name: /6 · Ropewalk/ }).click()
    await expect(heading(page, 'Ropewalk')).toBeVisible()
  })

  test('the view tabs go to a placeholder with an honest empty state', async ({ page }) => {
    await openSample(page)
    await page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('link', { name: 'Continuity' })
      .click()
    await expect(heading(page, 'Continuity')).toBeVisible()
    await expect(page.getByText('Continuity checks arrive in v0.2.')).toBeVisible()
    // The inspector says so too: it never shows the open scene's fields on another view.
    const inspector = page.getByRole('complementary', { name: 'Scene inspector' })
    await expect(inspector).toContainText('Nothing to inspect here')
    await expect(inspector).not.toContainText('Get through the gate')
    await page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('link', { name: 'Write' })
      .click()
    await expect(heading(page, 'Curfew Bells')).toBeVisible()
  })

  test('the filter narrows the navigator', async ({ page }) => {
    await openSample(page)
    await page.getByRole('searchbox', { name: 'Filter the navigator' }).fill('warden')
    const tree = page.getByRole('tree', { name: 'Books' })
    await expect(tree.getByRole('treeitem')).toHaveCount(4)
    await expect(tree.getByRole('treeitem', { name: /Warden/ })).toBeVisible()
  })
})

test.describe('command palette', () => {
  test('finds Tomas and opens the record', async ({ page }) => {
    await openSample(page)
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page)).toBeVisible()
    await page.getByRole('combobox').fill('tomas')
    await expect(page.getByRole('option').first()).toContainText('Tomas Brandt')
    await expect(page.getByRole('group', { name: 'Records' })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(palette(page)).toBeHidden()
    await expect(page).toHaveURL(/\/world\?record=chr_/)
    await expect(heading(page, 'Tomas Brandt')).toBeVisible()
    await expect(page.getByText('Its sheet arrives in v0.3.')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Scene inspector' })).not.toContainText(
      'Get through the gate',
    )
  })

  test('finds a scene by a part of its title, with accents and case ignored, and runs actions', async ({
    page,
  }) => {
    await openSample(page)
    await page.getByRole('button', { name: /Search or run a command/ }).click()
    await page.getByRole('combobox').fill('WARDENS')
    await expect(page.getByRole('option').first()).toContainText('The Warden’s Price')
    await page.getByRole('combobox').fill('go to plan')
    await page.keyboard.press('Enter')
    await expect(heading(page, 'Plan')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('dark theme')
    await page.keyboard.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('pins from the keyboard, shows recent items and keeps both after a reload', async ({
    page,
  }) => {
    await openSample(page)
    await page.getByRole('treeitem', { name: /Tide Bell/ }).click()
    await expect(heading(page, 'Tide Bell')).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    await expect(
      page.getByRole('group', { name: 'Recent' }).getByRole('option').first(),
    ).toContainText('Tide Bell')
    await page.getByRole('combobox').fill('tomas')
    await expect(page.getByRole('option').first()).toBeVisible()
    await page.keyboard.press('Alt+p')
    await page.getByRole('combobox').fill('')
    await expect(page.getByRole('group', { name: 'Pinned' })).toContainText('Tomas Brandt')
    await page.keyboard.press('Escape')

    await expect(page.getByRole('region', { name: 'Pinned' })).toContainText('Tomas Brandt')
    await page.reload()
    await expect(page.getByRole('region', { name: 'Pinned' })).toContainText('Tomas Brandt')
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('group', { name: 'Recent' })).toContainText('Tide Bell')
  })

  test('pins and unpins a navigator row from the keyboard with Alt+P', async ({ page }) => {
    await openSample(page)
    const pinned = page.getByRole('region', { name: 'Pinned' })
    await page.getByRole('treeitem', { name: /Tide Bell/ }).focus()
    await page.keyboard.press('Alt+p')
    await expect(pinned).toContainText('Tide Bell')
    await expect(page.getByRole('treeitem', { name: /Tide Bell/ })).toBeFocused()
    await page.keyboard.press('Alt+p')
    await expect(pinned).toHaveCount(0)
  })

  test('the palette has no pin buttons in its list, and shows a pin as state', async ({ page }) => {
    await openSample(page)
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('tomas')
    await expect(page.getByRole('option').first()).toBeVisible()
    await page.keyboard.press('Alt+p')
    const listbox = page.getByRole('listbox', { name: 'Results' })
    await expect(listbox.getByRole('button')).toHaveCount(0)
    await expect(listbox.getByRole('option').first()).toContainText('Pinned')
    await expect(page.getByRole('combobox')).toHaveAttribute(
      'aria-controls',
      (await listbox.getAttribute('id'))!,
    )
  })

  test('pins from a navigator row and unpins from the list', async ({ page }) => {
    await openSample(page)
    const row = page.getByRole('treeitem', { name: /Curfew Bells/ })
    await row.hover()
    await row.getByRole('button', { name: 'Pin Curfew Bells' }).click()
    await expect(page.getByRole('region', { name: 'Pinned' })).toContainText('Curfew Bells')
    await page.getByRole('button', { name: 'Unpin Curfew Bells' }).click()
    await expect(page.getByRole('region', { name: 'Pinned' })).toHaveCount(0)
  })
})

test.describe('theme and saved layout', () => {
  test('the theme toggle switches and settings show the choice', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked()
  })

  test('collapsing the panel that holds focus moves focus to the main content', async ({
    page,
  }) => {
    await openSample(page)
    await page.getByRole('treeitem', { name: /Tide Bell/ }).focus()
    await page.keyboard.press('ControlOrMeta+Backslash')
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeHidden()
    await expect(page.locator('#main-content')).toBeFocused()
  })

  test('a width saved on a big screen cannot crush the manuscript on a small one', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'aurelia.v1.panel.navigator',
        JSON.stringify({ width: 420, collapsed: false }),
      ),
    )
    await page.setViewportSize({ width: 1024, height: 768 })
    await openSample(page)
    const handle = page.getByRole('separator', { name: 'Resize the navigator' })
    await expect(handle).toHaveAttribute('aria-valuenow', '409') // 40% of 1024
    await page.setViewportSize({ width: 1600, height: 900 })
    await expect(handle).toHaveAttribute('aria-valuenow', '420')
  })

  test('panels resize from the keyboard and collapse with the shortcuts', async ({ page }) => {
    await openSample(page)
    const handle = page.getByRole('separator', { name: 'Resize the navigator' })
    const before = Number(await handle.getAttribute('aria-valuenow'))
    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', String(before + 32))
    await page.keyboard.press('Home')
    await expect(handle).toHaveAttribute(
      'aria-valuenow',
      (await handle.getAttribute('aria-valuemin'))!,
    )

    await page.keyboard.press('ControlOrMeta+Backslash')
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeHidden()
    await page.keyboard.press('ControlOrMeta+Backslash')
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible()

    await page.keyboard.press('ControlOrMeta+Alt+Backslash')
    await expect(page.getByRole('complementary', { name: 'Scene inspector' })).toBeHidden()
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible()
    await page.getByRole('button', { name: 'Show inspector' }).click()
    await expect(page.getByRole('complementary', { name: 'Scene inspector' })).toBeVisible()
  })

  test('a reload keeps the book, scene, panel sizes and theme', async ({ page }) => {
    await openSample(page)
    await page.getByRole('treeitem', { name: /Tide Bell/ }).click()
    await expect(heading(page, 'Tide Bell')).toBeVisible()
    const handle = page.getByRole('separator', { name: 'Resize the navigator' })
    await handle.focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    const width = await handle.getAttribute('aria-valuenow')
    await page.keyboard.press('ControlOrMeta+Alt+Backslash')
    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await page.getByRole('button', { name: /Switch book/ }).click()
    await page.getByRole('menuitem', { name: 'Salt & Ash' }).click()
    await expect(heading(page, 'Washed Ashore')).toBeVisible()
    await page.getByRole('treeitem', { name: /Hide in the Wreck/ }).click()
    await expect(heading(page, 'Hide in the Wreck')).toBeVisible()

    await page.reload()
    await expect(heading(page, 'Hide in the Wreck')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Switch book: Salt & Ash' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('separator', { name: 'Resize the navigator' })).toHaveAttribute(
      'aria-valuenow',
      width!,
    )
    await expect(page.getByRole('complementary', { name: 'Scene inspector' })).toBeHidden()

    // Back on the welcome screen, opening the sample returns to the same place.
    await page.goto('/')
    await page.getByRole('button', { name: /Open the sample universe/ }).click()
    await expect(heading(page, 'Hide in the Wreck')).toBeVisible()
  })
})

test.describe('tablet width', () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  for (const book of ['Tidebound', 'Salt & Ash']) {
    test(`the top bar is one row with ${book} open`, async ({ page }) => {
      await openSample(page)
      await page.getByRole('button', { name: /Switch book/ }).click()
      await page.getByRole('menuitem', { name: book }).click()
      const bar = page.getByRole('banner')
      await expect(bar.getByRole('button', { name: /Switch book: / })).toContainText(book)
      expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(56)
      const tops = await bar
        .locator('> *')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(24)
      const overflow = await bar.evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }

  test('the status bar and the breadcrumb are there, and a long breadcrumb ends in ellipsis', async ({
    page,
  }) => {
    await openSample(page)
    await expect(page.getByRole('contentinfo')).toContainText('1,240')
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs).toContainText('Curfew Bells')
    expect(await crumbs.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
})

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the navigator and the inspector open as sheets with 44 px buttons', async ({ page }) => {
    await openSample(page)
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeHidden()
    await expect(page.getByRole('complementary', { name: 'Scene inspector' })).toBeHidden()
    const open = page.getByRole('button', { name: 'Open the navigator' })
    expect((await open.boundingBox())!.width).toBeGreaterThanOrEqual(44)
    await open.click()
    const sheet = page.getByRole('dialog', { name: 'Navigator' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('treeitem', { name: /Tide Bell/ }).click()
    await expect(sheet).toBeHidden()
    await expect(heading(page, 'Tide Bell')).toBeVisible()

    await page.getByRole('button', { name: 'Scene details' }).click()
    await expect(page.getByRole('dialog', { name: 'Scene details' })).toContainText('Scene 7.1')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Scene details' })).toBeFocused()
  })

  test('the welcome screen shows a way in without scrolling', async ({ page }) => {
    await page.goto('/')
    const open = page.getByRole('button', { name: /Open the sample universe/ })
    const box = (await open.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(844)
  })

  test('the status bar is there too, with the word counts', async ({ page }) => {
    await openSample(page)
    await expect(page.getByRole('contentinfo')).toContainText('1,240')
    await expect(page.getByRole('contentinfo')).toContainText('not saved')
  })

  test('touch targets in the sheets are 44 px', async ({ browser }) => {
    const touch = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    })
    const p = await touch.newPage()
    await openSample(p)
    await p.getByRole('button', { name: 'Open the navigator' }).click()
    const sheet = p.getByRole('dialog', { name: 'Navigator' })
    await expect(sheet).toHaveAttribute('aria-modal', 'true')
    await sheet.getByRole('button', { name: 'Pin Tide Bell' }).click() // so Unpin is measured too
    await expect(sheet.getByRole('button', { name: 'Unpin Tide Bell' })).toBeVisible()
    const small = await sheet.evaluate((root) =>
      Array.from(root.querySelectorAll('button, input, [role="treeitem"]'))
        .map((el) => (el.tagName === 'INPUT' ? (el.closest('label') ?? el) : el)) // a field is its label
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && (r.height < 44 || (el.tagName === 'BUTTON' && r.width < 44))
        })
        .map(
          (el) => `${el.tagName} ${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 20)}`,
        ),
    )
    expect(
      await sheet.evaluate((root) => root.querySelectorAll('button[aria-label^="Unpin"]').length),
    ).toBe(1)
    await touch.close()
    expect(small).toEqual([])
  })

  test('the palette fits the screen', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'Search or run a command' }).click()
    const box = (await palette(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  })
})

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`accessibility in ${scheme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
    })

    test('the welcome screen has no serious violations', async ({ page }) => {
      await page.goto('/')
      await expect(heading(page, 'Welcome')).toBeVisible()
      expect(await serious(page)).toEqual([])
    })

    test('the write view has no serious violations', async ({ page }) => {
      await openSample(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme)
      expect(await serious(page)).toEqual([])
    })

    test('the open palette has no violations, on a desktop or a phone', async ({ page }) => {
      await openSample(page)
      await page.keyboard.press('ControlOrMeta+k')
      await expect(page.getByRole('option').first()).toBeVisible() // the empty query: pinned, recent, actions
      expect(await allViolations(page)).toEqual([])
      await page.getByRole('combobox').fill('tomas')
      await expect(page.getByRole('option').first()).toBeVisible()
      expect(await allViolations(page)).toEqual([])
      await page.getByRole('combobox').fill('zzzz')
      await expect(page.getByRole('status')).toContainText('Nothing matches')
      expect(await allViolations(page)).toEqual([])

      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Search or run a command' }).click()
      await page.getByRole('combobox').fill('tomas')
      await expect(page.getByRole('option').first()).toBeVisible()
      expect(await allViolations(page)).toEqual([])
    })

    test('the phone sheets and the book menu have no violations', async ({ page }) => {
      await openSample(page)
      await page.getByRole('button', { name: /Switch book/ }).click()
      await expect(page.getByRole('menuitem').first()).toBeVisible()
      expect(await serious(page)).toEqual([]) // the menu is in a portal, outside any landmark
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Open the navigator' }).click()
      await expect(page.getByRole('dialog', { name: 'Navigator' })).toBeVisible()
      expect(await allViolations(page)).toEqual([])
    })

    test('a view that is not built yet has no violations', async ({ page }) => {
      await openSample(page)
      await page
        .getByRole('navigation', { name: 'Views' })
        .getByRole('link', { name: 'Plan' })
        .click()
      await expect(page.getByText('The outline and corkboard arrive in v0.2.')).toBeVisible()
      expect(await allViolations(page)).toEqual([])
    })
  })
}
