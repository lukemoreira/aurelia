// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { FakeDav } from '../helpers/fake-dav'
import { serveDav } from '../helpers/serve-dav'
import {
  banner,
  createBrowserWorkspace,
  openBackupScreen,
  opfs,
  sceneText,
  statusBar,
  waitSaved,
} from '../helpers/browser-workspace'

// Two browsers (two contexts: each has its own browser storage and device identity) on one in-test WebDAV that follows the
// contract of the storage container. The end-to-end build syncs every 1.5 s and pushes 0.4 s after typing stops.
test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
const shots = 'test-results/m4b-screenshots'
const WAIT = { timeout: 20_000 }

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Backup and versions' })

async function dialogViolations(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

let dav: FakeDav
test.beforeEach(async ({ context }) => {
  dav = new FakeDav()
  await serveDav(context, dav)
})

const goOffline = async (context: BrowserContext) => {
  await context.unroute('**/dav/**')
  await context.route('**/dav/**', (route) => route.abort('internetdisconnected'))
}
const goOnline = async (context: BrowserContext) => {
  await context.unroute('**/dav/**')
  await serveDav(context, dav)
}

/** Turn "Keep this workspace in sync on this device" on from the Backup screen. */
async function turnOnSync(page: Page) {
  await openBackupScreen(page)
  await dialog(page)
    .getByRole('switch', { name: 'Keep this workspace in sync on this device' })
    .click()
  await expect(dialog(page)).toContainText('Last looked at your server', WAIT)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(statusBar(page)).toContainText('Synced', WAIT)
}

/** A second browser: restores the latest copy from the server and keeps it in sync. */
async function secondDevice(browser: Browser, name = 'My Writing') {
  const context = await browser.newContext({
    baseURL: `http://localhost:${process.env.E2E_PORT ?? 4173}`,
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  })
  await serveDav(context, dav)
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('button', { name: /Restore from a backup/ }).click()
  const restore = page.getByRole('dialog', { name: 'Restore from a backup' })
  await restore.getByRole('button', { name: new RegExp(name) }).click()
  await expect(restore)
    .toContainText('Kept in sync')
    .catch(() => undefined) // on the list, before this click
  await restore.getByRole('button', { name: /Latest backup/ }).click()
  await restore.getByRole('checkbox', { name: /Keep it in sync/ }).click()
  await page.screenshot({ path: `${shots}/restore-and-sync.png` })
  await restore.getByRole('button', { name: /Keep it in this browser/ }).click()
  await expect(sceneText(page)).toBeVisible()
  await expect(statusBar(page)).toContainText('Synced', WAIT)
  return { context, page }
}

/** A workspace on the first device with sync on, and a second device that joined it. */
async function twoDevices(page: Page, browser: Browser) {
  await createBrowserWorkspace(page)
  await sceneText(page).fill('The first words.')
  await waitSaved(page)
  await turnOnSync(page)
  const b = await secondDevice(browser)
  await expect(sceneText(b.page)).toHaveText('The first words.')
  return b
}

const scenesOn = async (page: Page) =>
  (await opfs.list(page)).filter((f) => /\/scenes\/scn_/.test(f))
/** Whether a text is in a file of the shared copy (versions keep old texts, on purpose). */
const serverHas = (text: string) =>
  dav.paths().some((p) => p.includes('/current/') && dav.text(p)?.includes(text))

test.describe('sync between two devices', () => {
  test('typing on A appears on B, in the open scene, without a reload', async ({
    page,
    browser,
  }) => {
    const b = await twoDevices(page, browser)
    await sceneText(page).fill('The first words. Then A typed this.')
    await expect(sceneText(b.page)).toHaveText('The first words. Then A typed this.', WAIT)
    await expect(statusBar(b.page)).toContainText('Synced')
    await b.page.screenshot({ path: `${shots}/status-synced.png` })
    // And the other way.
    await sceneText(b.page).fill('The first words. Then A typed this. And B answered.')
    await expect(sceneText(page)).toHaveText(
      'The first words. Then A typed this. And B answered.',
      WAIT,
    )
    await b.context.close()
  })

  test('both edit the same scene while B is offline: B reconnects, a conflict is shown, and both texts exist', async ({
    page,
    browser,
  }) => {
    const b = await twoDevices(page, browser)
    await goOffline(b.context)
    await sceneText(page).fill('The first words. A wrote this while B was away.')
    await expect.poll(() => serverHas('A wrote this while B was away.'), WAIT).toBe(true)
    await sceneText(b.page).fill('The first words. B wrote this offline.')
    await waitSaved(b.page)
    await expect(statusBar(b.page)).toContainText('Offline — changes waiting', WAIT)
    await b.page.screenshot({ path: `${shots}/status-offline.png` })
    await statusBar(b.page).screenshot({ path: `${shots}/status-bar-offline.png` })

    await goOnline(b.context)
    await b.page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(statusBar(b.page)).toContainText('Conflict — 1 scene has two versions', WAIT)
    await statusBar(b.page).screenshot({ path: `${shots}/status-bar-conflict.png` })
    await expect(banner(b.page, 'two versions after syncing')).toBeVisible()
    await b.page.screenshot({ path: `${shots}/conflict-banner.png` })

    // B keeps its own text, and A's is a copy beside it.
    await expect(sceneText(b.page)).toHaveText('The first words. B wrote this offline.')
    const copy = (await opfs.list(b.page)).find((f) => /\(Aurelia copy [0-9a-f]{8}\)/.test(f))!
    expect(copy).toBeDefined()
    expect(await opfs.read(b.page, copy)).toContain('A wrote this while B was away.')

    // Both reach the other device too.
    await expect(sceneText(page)).toHaveText('The first words. B wrote this offline.', WAIT)
    await expect(statusBar(page)).toContainText('Conflict — 1 scene has two versions', WAIT)
    const copyOnA = (await opfs.list(page)).find((f) => /\(Aurelia copy [0-9a-f]{8}\)/.test(f))!
    expect(await opfs.read(page, copyOnA)).toContain('A wrote this while B was away.')

    // The status bar's chip goes to where the two versions are chosen between.
    await statusBar(b.page)
      .getByRole('button', { name: /Conflict/ })
      .click()
    const files = b.page.getByRole('dialog', { name: 'Files to look at' })
    await expect(files).toBeVisible()
    await expect(files).toContainText('Two versions of one file')
    await expect(files).toContainText('— two versions')
    await b.page.screenshot({ path: `${shots}/conflict-files.png` })
    await files.getByRole('button', { name: 'Keep the text in the scene' }).click()
    await expect(files).toContainText('Nothing left to look at')
    await b.page.keyboard.press('Escape')
    await expect(statusBar(b.page)).toContainText('Synced', WAIT)
    await b.context.close()
  })

  test('a scene deleted on A is gone on B, and does not come back', async ({ page, browser }) => {
    const b = await twoDevices(page, browser)
    const original = (await scenesOn(page))[0]!
    // Two more scenes on A; A ends up on the third, so the one that goes is not open anywhere.
    await page.getByRole('button', { name: 'New scene in this chapter' }).click()
    await expect.poll(async () => (await scenesOn(page)).length).toBe(2)
    const second = (await scenesOn(page)).find((f) => f !== original)!
    await sceneText(page).fill('The second scene, about to be deleted.')
    await waitSaved(page)
    await page.getByRole('button', { name: 'New scene in this chapter' }).click()
    await expect.poll(async () => (await scenesOn(page)).length).toBe(3)
    await expect.poll(() => scenesOn(b.page), WAIT).toContain(second)
    expect(await opfs.read(b.page, second)).toContain('The second scene, about to be deleted.')

    await opfs.remove(page, second)
    await expect.poll(() => dav.paths().some((p) => p.endsWith(second)), WAIT).toBe(false)
    await expect.poll(() => scenesOn(b.page), WAIT).not.toContain(second)
    // Several rounds later, on both devices and on the server, it has not returned.
    await page.waitForTimeout(6000)
    expect(await scenesOn(page)).not.toContain(second)
    expect(await scenesOn(b.page)).not.toContain(second)
    expect(dav.paths().some((p) => p.endsWith(second))).toBe(false)
    expect(serverHas('The second scene, about to be deleted.')).toBe(false)
    // …but the workspace it was in still has its words: a version was saved before B removed it.
    expect(
      dav.paths().some((p) => p.includes('/versions/') && p.endsWith('_before-sync.zip')),
    ).toBe(true)
    await b.context.close()
  })

  test('the Backup screen shows the sync section, with no serious accessibility problems in either theme', async ({
    page,
    browser,
  }) => {
    const b = await twoDevices(page, browser)
    await b.context.close()
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await openBackupScreen(page)
      const card = dialog(page).locator('[aria-labelledby="bk-sync"]')
      await expect(card).toContainText('Devices that sync this workspace')
      await expect(
        card.getByRole('switch', { name: 'Keep this workspace in sync on this device' }),
      ).toBeChecked()
      await expect(card.getByRole('button', { name: 'Sync now' })).toBeVisible()
      expect(await dialogViolations(page)).toEqual([])
      await page.screenshot({ path: `${shots}/backup-screen-sync-${scheme}.png` })
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toBeHidden()
    }
  })

  test('the status bar says Syncing… while a round has work to do', async ({ page, browser }) => {
    const b = await twoDevices(page, browser)
    await b.context.close()
    // Hold A's answers a moment, so the bar can be seen in between.
    await page.context().route('**/dav/**', async (route) => {
      await new Promise((r) => setTimeout(r, 400))
      await route.fallback() // to the fake server's route, registered first
    })
    await sceneText(page).fill('The first words. Something to send.')
    await expect(statusBar(page)).toContainText('Syncing…', WAIT)
    await statusBar(page).screenshot({ path: `${shots}/status-bar-syncing.png` })
    await expect(statusBar(page)).toContainText('Synced', WAIT)
  })
})
