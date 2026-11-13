// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test'
import {
  createBrowserWorkspace,
  openBackupScreen,
  sceneText,
  waitSaved,
} from '../helpers/browser-workspace'

// Runs only against the real storage container (server/store): start it, then
//   AURELIA_STORE_URL=http://localhost:8081 npm run e2e
// The preview server sends /dav/ to it (vite.config.ts), as the app's nginx does. Without the
// variable this file is skipped; backup.spec.ts covers the same flows against an in-test server.
test.skip(!process.env.AURELIA_STORE_URL, 'set AURELIA_STORE_URL to run against the real store')
test.use({ serviceWorkers: 'block' })

test('backup and restore round-trip through the real storage container', async ({
  page,
  browser,
}) => {
  await createBrowserWorkspace(page)
  await sceneText(page).fill('Through the real store.')
  await waitSaved(page)
  await openBackupScreen(page)
  const dialog = page.getByRole('dialog', { name: 'Backup and versions' })
  await dialog.getByRole('switch', { name: 'Back up to your server' }).click()
  await expect(dialog).toContainText('Backed up')
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Saved every hour' })).toHaveCount(1)

  const fresh = await browser.newContext({
    baseURL: `http://localhost:${process.env.E2E_PORT ?? 4173}`,
    serviceWorkers: 'block',
  })
  const other = await fresh.newPage()
  await other.goto('/')
  await other.getByRole('button', { name: /Restore from a backup/ }).click()
  const restore = other.getByRole('dialog', { name: 'Restore from a backup' })
  await restore
    .getByRole('button', { name: /My Writing/ })
    .first()
    .click()
  await restore.getByRole('button', { name: /Latest backup/ }).click()
  await restore.getByRole('button', { name: /Keep it in this browser/ }).click()
  await expect(sceneText(other)).toHaveText('Through the real store.')
  await fresh.close()
})
