// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
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

// The storage container is not here: `/dav/` is answered by an in-test memory WebDAV that follows
// the same contract (tests/helpers/fake-dav.ts). Nothing below knows that — the tests only talk
// to `/dav/` — so they can later run against the real container too.
test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
const shots = 'test-results/m2b-screenshots'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Backup and versions' })
/** Serious accessibility problems inside the open dialog (the page behind its overlay is not under test). */
async function dialogViolations(page: Page) {
  // Colour is measured on what is on screen: let the dialog finish fading in first.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${JSON.stringify(n.any[0]?.data)}`).join(', ')}`,
    )
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

/** Turn "Back up to your server" on from the Backup screen, wait for the first backup, close it. */
async function turnOn(page: Page) {
  await openBackupScreen(page)
  await dialog(page).getByRole('switch', { name: 'Back up to your server' }).click()
  await expect(dialog(page)).toContainText('Backed up') // the rest of the page is hidden from the tree while a dialog is open
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(statusBar(page)).toContainText('Backed up')
}

const workspaceId = async (page: Page) => (await opfs.list(page))[0]!.split('/')[0]!
const folderOf = async (page: Page, name = 'My Writing') =>
  `Aurelia/${name} (${await workspaceId(page)})`

let dav: FakeDav
test.beforeEach(async ({ context }, testInfo) => {
  dav = new FakeDav()
  if (!testInfo.title.startsWith('without a server')) await serveDav(context, dav)
})

test.describe('backup to your server', () => {
  test('without a server, Welcome offers no restore and the Backup screen says none was found', async ({
    page,
  }) => {
    await page.unroute('**/dav/**')
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Restore from a backup/ })).toHaveCount(0)
    await createBrowserWorkspace(page)
    await openBackupScreen(page)
    await expect(dialog(page)).toContainText('Not found')
    await expect(
      dialog(page).getByRole('switch', { name: 'Back up to your server' }),
    ).toBeDisabled()
    await expect(dialog(page)).toContainText('Google Drive and OneDrive come later')
  })

  test('turned on, a typed scene lands on the server with a manifest that matches, and versions appear', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('The bells had already started.')
    await waitSaved(page)
    await turnOn(page)
    const folder = await folderOf(page)

    await sceneText(page).fill('The bells had already started. She counted them.')
    await waitSaved(page)
    await expect
      .poll(() =>
        dav.paths(`${folder}/current/`).some((p) => dav.text(p)?.includes('She counted them.')),
      )
      .toBe(true)
    await expect(statusBar(page)).toContainText('Backed up · just now')

    const manifest = dav.json<{
      revision: number
      complete: boolean
      deviceName: string
      files: Record<string, { hash: string }>
    }>(`${folder}/backup.json`)
    expect(manifest.complete).toBe(true)
    expect(manifest.revision).toBeGreaterThanOrEqual(2)
    const onServer = dav
      .paths(`${folder}/current/`)
      .map((p) => p.slice(`${folder}/current/`.length))
    expect(Object.keys(manifest.files).sort()).toEqual(onServer.sort())
    for (const [path, f] of Object.entries(manifest.files)) {
      expect(sha(dav.text(`${folder}/current/${path}`)!)).toBe(f.hash)
      expect(sha(await opfs.read(page, `${await workspaceId(page)}/${path}`))).toBe(f.hash)
    }
    expect(dav.paths(`${folder}/versions/`)).toHaveLength(1)

    await openBackupScreen(page)
    await expect(dialog(page).getByRole('switch', { name: 'Back up to your server' })).toBeChecked()
    await expect(
      dialog(page).getByRole('listitem').filter({ hasText: 'Latest backup' }),
    ).toBeVisible()
    await expect(
      dialog(page).getByRole('listitem').filter({ hasText: 'Saved every hour while you write' }),
    ).toHaveCount(1)
    await expect(dialog(page)).toContainText(/\d+(\.\d)? (KB|MB) used/)
  })

  test('the Backup screen opens from the command palette, with no serious accessibility problems in either theme', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await turnOn(page)
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.keyboard.press('ControlOrMeta+k')
      await page.getByPlaceholder('Search or run a command…').fill('Backup and versions')
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toBeVisible()
      await expect(dialog(page)).toContainText('Backed up')
      expect(await dialogViolations(page)).toEqual([])
      await page.screenshot({ path: `${shots}/backup-screen-${scheme}.png` })
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toBeHidden()
    }
  })

  test('a fresh browser restores the latest backup from Welcome: same words, checked first', async ({
    page,
    browser,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Words that must come back.')
    await waitSaved(page)
    await turnOn(page)
    await expect
      .poll(() => dav.paths().some((p) => dav.text(p)?.includes('Words that must come back.')))
      .toBe(true)

    const fresh = await browser.newContext({
      baseURL: `http://localhost:${process.env.E2E_PORT ?? 4173}`,
      serviceWorkers: 'block',
      viewport: { width: 1440, height: 900 },
    })
    await serveDav(fresh, dav)
    const other = await fresh.newPage()
    await other.goto('/')
    await expect(other.getByRole('button', { name: /Recent/ })).toHaveCount(0)
    await other.screenshot({ path: `${shots}/restore-welcome.png` })
    await other.getByRole('button', { name: /Restore from a backup/ }).click()
    const restore = other.getByRole('dialog', { name: 'Restore from a backup' })
    await expect(restore).toBeVisible()
    await expect(restore.getByRole('button', { name: /My Writing/ })).toBeVisible()
    await other.screenshot({ path: `${shots}/restore-workspaces.png` })
    await restore.getByRole('button', { name: /My Writing/ }).click()
    await expect(restore.getByRole('button', { name: /Latest backup/ })).toBeVisible()
    await other.screenshot({ path: `${shots}/restore-versions.png` })
    await restore.getByRole('button', { name: /Latest backup/ }).click()
    await other.screenshot({ path: `${shots}/restore-destination.png` })
    await restore.getByRole('button', { name: /Keep it in this browser/ }).click()
    await expect(sceneText(other)).toHaveText('Words that must come back.')
    await expect(statusBar(other)).toContainText('Only in this browser') // a new copy: backup there is off until turned on
    await fresh.close()
  })

  test('restoring an earlier version makes a new copy and leaves the open workspace alone', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await turnOn(page) // the first version has an empty scene
    await sceneText(page).fill('Typed after the first version.')
    await waitSaved(page)
    await expect
      .poll(() => dav.paths().some((p) => dav.text(p)?.includes('Typed after the first version.')))
      .toBe(true)

    await openBackupScreen(page)
    const versionRow = dialog(page)
      .getByRole('listitem')
      .filter({ hasText: 'Saved every hour while you write' })
    await versionRow.getByRole('button', { name: 'Restore this version' }).click()
    const restore = page.getByRole('dialog', { name: 'Restore from a backup' })
    await restore.getByRole('button', { name: /Keep it in this browser/ }).click()
    await expect(sceneText(page)).toHaveText('')
    // The first workspace is still there, with its words, as a second entry on Welcome.
    await page.goto('/')
    await expect(page.getByRole('button', { name: /My Writing/ })).toHaveCount(2)
  })

  test('another device’s newer backup.json stops the backup and asks: Keep both writes nowhere near it', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await turnOn(page)
    const folder = await folderOf(page)
    const theirs = {
      ...dav.json<Record<string, unknown>>(`${folder}/backup.json`),
      deviceId: 'dev_other',
      deviceName: 'Firefox on Windows',
      revision: 9,
    }
    dav.tamper(`${folder}/backup.json`, JSON.stringify(theirs))
    const theirText = dav.text(`${folder}/backup.json`)

    await sceneText(page).fill('Written on the first device.')
    await expect(statusBar(page)).toContainText('Backup needs your OK')
    await expect(banner(page, 'Another device already backs this workspace up')).toBeVisible()
    expect(dav.text(`${folder}/backup.json`)).toBe(theirText)
    expect(
      dav
        .paths(`${folder}/current/`)
        .some((p) => dav.text(p)?.includes('Written on the first device.')),
    ).toBe(false)

    await page.getByRole('button', { name: 'Choose' }).click()
    await expect(dialog(page)).toContainText('Firefox on Windows')
    await page.screenshot({ path: `${shots}/backup-ask.png` })
    await dialog(page).getByRole('button', { name: 'Keep both' }).click()
    await expect(dialog(page)).toContainText('Backing up to Aurelia')
    await page.keyboard.press('Escape')
    await expect(statusBar(page)).toContainText('Backed up')
    await expect
      .poll(() => dav.paths().some((p) => p.includes(' – ') && p.endsWith('/backup.json')))
      .toBe(true)
    const own = dav.paths().find((p) => p.includes(' – ') && p.endsWith('/backup.json'))!
    expect(own).toContain('Chrome')
    expect(dav.text(`${folder}/backup.json`)).toBe(theirText)
    await expect
      .poll(() => dav.text(own.replace('backup.json', `current/${'aurelia.json'}`)))
      .not.toBeNull()
  })

  test('"Use the backup here" saves a version of this copy first, then restores the backup as a new copy', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await sceneText(page).fill('On the server already.')
    await waitSaved(page)
    await turnOn(page)
    const folder = await folderOf(page)
    await expect
      .poll(() => dav.paths().some((p) => dav.text(p)?.includes('On the server already.')))
      .toBe(true)
    dav.tamper(
      `${folder}/backup.json`,
      JSON.stringify({
        ...dav.json<object>(`${folder}/backup.json`),
        deviceId: 'dev_other',
        deviceName: 'Firefox on Windows',
        revision: 9,
      }),
    )

    await sceneText(page).fill('Only in this browser so far.')
    await waitSaved(page)
    await expect(statusBar(page)).toContainText('Backup needs your OK')
    await page.getByRole('button', { name: 'Choose' }).click()
    await dialog(page).getByRole('button', { name: 'Use the backup here' }).click()
    const restore = page.getByRole('dialog', { name: 'Restore from a backup' })
    await restore.getByRole('button', { name: /Keep it in this browser/ }).click()
    await expect(sceneText(page)).toHaveText('On the server already.')
    expect(dav.paths(`${folder}/versions/`).some((p) => p.endsWith('_before-use-backup.zip'))).toBe(
      true,
    )
    // The other copy, with the words typed here, is still on Welcome.
    await page.goto('/')
    await expect(page.getByRole('button', { name: /My Writing/ })).toHaveCount(2)
  })

  test('a login that ran out pauses the backup, says to sign in again, and resumes after', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await turnOn(page)
    dav.authorized = false
    await sceneText(page).fill('Written while signed out.')
    await waitSaved(page) // the words are safe in the workspace whatever the server says
    await expect(statusBar(page)).toContainText('Backup paused — sign in again')
    await expect(banner(page, 'Backup paused — sign in again')).toBeVisible()
    await expect(
      banner(page, 'Backup paused — sign in again').getByRole('button', { name: 'Sign in again' }),
    ).toBeVisible()
    await page.screenshot({ path: `${shots}/backup-paused.png` })
    const requests = dav.log.length
    await page.waitForTimeout(1500)
    expect(dav.log.slice(requests)).toEqual([]) // no hammering a server that says no

    dav.authorized = true
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))) // back from signing in
    await expect(statusBar(page)).toContainText('Backed up')
    await expect
      .poll(() => dav.paths().some((p) => dav.text(p)?.includes('Written while signed out.')))
      .toBe(true)
  })

  test('a server that is down says the backup will retry, and nothing is lost', async ({
    page,
  }) => {
    await createBrowserWorkspace(page)
    await turnOn(page)
    dav.down = true
    await sceneText(page).fill('Written while the server was down.')
    await expect(statusBar(page)).toContainText('Backup failed — will retry')
    dav.down = false
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(statusBar(page)).toContainText('Backed up')
    await expect
      .poll(() =>
        dav.paths().some((p) => dav.text(p)?.includes('Written while the server was down.')),
      )
      .toBe(true)
  })
})

test('the Backup screen and the restore flow fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createBrowserWorkspace(page)
  await openBackupScreen(page)
  await dialog(page).getByRole('switch', { name: 'Back up to your server' }).click()
  await expect(dialog(page)).toContainText('Backed up')
  await page.screenshot({ path: `${shots}/backup-phone.png` })
  expect(await dialogViolations(page)).toEqual([])
  // 44 px targets on a phone (only where the device reports a touch pointer: Playwright's desktop Chrome does not).
  const box = await dialog(page).getByRole('button', { name: 'Back up now' }).boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(32)
})
