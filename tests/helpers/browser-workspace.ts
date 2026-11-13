// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** Serious and critical accessibility problems on the page, as readable lines. */
export async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

export const sceneText = (page: Page) => page.getByRole('textbox', { name: 'Scene text' })
/** A banner above the writing: they are the children of the one polite live region. */
export const banner = (page: Page, text: string) =>
  page.locator('[aria-live="polite"] > *').filter({ hasText: text })
export const statusBar = (page: Page) => page.getByRole('contentinfo')

/** Create a workspace in browser storage through the Welcome screen and land on its first scene. */
export async function createBrowserWorkspace(page: Page, name = 'My Writing') {
  await page.goto('/')
  await page.getByRole('button', { name: /Keep it in this browser/ }).click()
  await page.getByLabel('Workspace name').fill(name)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(sceneText(page)).toBeVisible()
}

/** Wait until the status bar says the text reached its file. */
export const waitSaved = (page: Page) =>
  expect(statusBar(page)).toContainText('Saved', { timeout: 10_000 })

/** Everything below `workspaces/` in the browser's private file system, read from the test side. */
export const opfs = {
  list: (page: Page) =>
    page.evaluate(async () => {
      const out: string[] = []
      const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`)
          else out.push(`${prefix}${name}`)
        }
      }
      const root = await navigator.storage.getDirectory()
      await walk(await root.getDirectoryHandle('workspaces'), '')
      return out.sort()
    }),
  read: (page: Page, path: string) =>
    page.evaluate(async (p) => {
      let dir = await navigator.storage.getDirectory()
      const parts = ['workspaces', ...p.split('/')]
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
      return (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).text()
    }, path),
  /** Write a file the way another app would: straight to the disk, not through Aurelia. */
  write: (page: Page, path: string, text: string) =>
    page.evaluate(
      async ([p, t]) => {
        let dir = await navigator.storage.getDirectory()
        const parts = ['workspaces', ...p!.split('/')]
        for (const part of parts.slice(0, -1))
          dir = await dir.getDirectoryHandle(part, { create: true })
        const w = await (await dir.getFileHandle(parts.at(-1)!, { create: true })).createWritable()
        await w.write(t!)
        await w.close()
      },
      [path, text],
    ),
}

/** The path (inside `workspaces/`) of the first scene file. */
export async function firstScenePath(page: Page) {
  const files = await opfs.list(page)
  return files.find((f) => /\/scenes\/scn_\w+\.md$/.test(f))!
}
