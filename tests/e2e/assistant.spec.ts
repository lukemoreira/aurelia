// SPDX-License-Identifier: AGPL-3.0-or-later
// The assistant (ADR-0015). The assistant server is played by page.route: no Claude Code, no Anthropic.
// A proposal is a file in the workspace (as sync brings it in), so the in-text card is tested by writing one.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  createBrowserWorkspace,
  firstScenePath,
  openBackupScreen,
  opfs,
  sceneText,
  statusBar,
  waitSaved,
} from '../helpers/browser-workspace'
import { FakeDav } from '../helpers/fake-dav'
import { serveDav } from '../helpers/serve-dav'

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
test.setTimeout(60_000)

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Scene inspector' })
const assistantTab = (page: Page) => inspector(page).getByRole('tab', { name: 'Assistant' })
const json = (body: object) => ({ contentType: 'application/json', body: JSON.stringify(body) })

async function serious(page: Page, scope: string) {
  // A theme change fades its colours in: let it start (two frames), then measure once it has.
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))
  })
  const { violations } = await new AxeBuilder({ page }).include(scope).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary ?? ''}`).join(', ')}`,
    )
}

/** A proposal file, as the assistant server writes it, for the first paragraph of the first scene. */
async function propose(page: Page, id: string, before: string, after: string) {
  // The scene itself, not a snapshot's copy of it.
  const scene = (await opfs.list(page)).find((f) => /^[^.]*\/scenes\/scn_\w+\.md$/.test(f))!
  const home = scene.split('/universes/')[0]
  const sceneId = /(scn_\w+)\.md$/.exec(scene)![1]
  await opfs.write(
    page,
    `${home}/.aurelia/proposals/${id}.json`,
    JSON.stringify({
      schemaVersion: 1,
      id,
      createdAt: new Date().toISOString(),
      by: 'Claude',
      why: 'Dusk clashes with chapter 7.',
      kind: 'edit',
      sceneId,
      sceneTitle: 'Untitled scene',
      baseHash: 'x',
      changes: [{ block: 'b0-00000000', before, after }],
    }),
  )
}

test('no assistant on the server: no Assistant tab, and the app works as before', async ({
  page,
}) => {
  await page.route('**/agent/**', (r) => r.fulfill({ status: 502, body: 'Bad gateway' }))
  await createBrowserWorkspace(page)
  await expect(inspector(page).getByRole('tab', { name: 'Scene' })).toBeVisible()
  await expect(assistantTab(page)).toHaveCount(0)
})

// page.route answers in one piece, so the relayed sign-in ends at once here; sending the typed code is
// tested in the server's own tests (server/agent/test/server.test.ts) and in AssistantPanel.test.ts.
test('Claude Code on this server: its own sign-in is shown, its web address as a link', async ({
  page,
}) => {
  await page.route('**/agent/status', (r) => r.fulfill(json({ state: 'signed-out' })))
  await page.route('**/agent/login', (r) =>
    r.fulfill({
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify({ t: 'out', text: "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\nPaste code here if prompted > " })}\n`,
    }),
  )
  await createBrowserWorkspace(page)
  await assistantTab(page).click()
  await expect(inspector(page)).toContainText('Claude Code on this server')
  expect(await serious(page, '[aria-label="Scene inspector"]')).toEqual([])
  await inspector(page)
    .getByRole('button', { name: 'Start Claude Code sign-in', exact: true })
    .click()
  await expect(
    inspector(page).getByRole('link', { name: /claude\.com\/cai\/oauth\/authorize/ }),
  ).toBeVisible()
  await expect(inspector(page)).toContainText('Paste code here if prompted')
  // The answer ended without Claude Code's own end: said in words, and the buttons are back.
  await expect(inspector(page).getByRole('alert')).toContainText('The sign-in did not finish')
  await expect(
    inspector(page).getByRole('button', { name: 'Start Claude Code sign-in', exact: true }),
  ).toBeVisible()
})

for (const width of [1440, 390]) {
  test(`a suggestion in the text: shown around its paragraph, accepted with a snapshot first, or rejected — ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/agent/**', (r) => r.fulfill({ status: 502, body: '' }))
    await createBrowserWorkspace(page)
    await sceneText(page).fill('Tomas came down to the quay at dusk.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('The clerk counted the crates.')
    await waitSaved(page)
    await propose(
      page,
      'prp_aaaaaaaaaa',
      'Tomas came down to the quay at dusk.',
      'Tomas came down to the quay in the late afternoon.',
    )
    await page.reload()
    const card = page.locator('[data-proposal="prp_aaaaaaaaaa"]')
    await expect(card).toContainText('Suggested by the assistant')
    await expect(card).toContainText('Dusk clashes with chapter 7.')
    await expect(card.locator('del')).toContainText('dusk')
    await expect(card.locator('ins')).toContainText('late afternoon')
    // Drawn only: the text itself is unchanged until Accept.
    await expect(sceneText(page)).toContainText('at dusk.')
    expect(await opfs.read(page, await firstScenePath(page))).toContain('at dusk.')
    expect(await serious(page, '[data-proposal]')).toEqual([])
    await page.screenshot({ path: `test-results/m8-screenshots/suggestion-${width}.png` })
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await serious(page, '[data-proposal]')).toEqual([])
    await page.screenshot({ path: `test-results/m8-screenshots/suggestion-${width}-dark.png` })
    await page.emulateMedia({ colorScheme: 'light' })

    // Reachable by keyboard: the toolbar's buttons are ordinary, labelled buttons.
    const accept = card.getByRole('button', { name: 'Accept' })
    await accept.focus()
    await expect(accept).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(card).toHaveCount(0)
    await expect(sceneText(page)).toContainText('in the late afternoon.')
    await expect(sceneText(page)).toContainText('The clerk counted the crates.')
    await waitSaved(page)
    const files = await opfs.list(page)
    expect(files.some((f) => f.includes('/.aurelia/proposals/'))).toBe(false)
    const manifests = files.filter((f) => /\.aurelia\/snapshots\/snp_\w+\/snapshot\.json$/.test(f))
    expect(manifests).toHaveLength(1)
    expect(await opfs.read(page, manifests[0]!)).toContain('"reason": "before-assistant"')

    // Reject: the proposal goes, the text stays.
    await propose(
      page,
      'prp_bbbbbbbbbb',
      'The clerk counted the crates.',
      'The clerk counted nothing.',
    )
    await page.reload()
    const second = page.locator('[data-proposal="prp_bbbbbbbbbb"]')
    await second.getByRole('button', { name: 'Reject' }).click()
    await expect(second).toHaveCount(0)
    await expect(sceneText(page)).toContainText('The clerk counted the crates.')
  })
}

test('a suggestion whose paragraph changed is out of date and cannot be accepted', async ({
  page,
}) => {
  await page.route('**/agent/**', (r) => r.fulfill({ status: 502, body: '' }))
  await createBrowserWorkspace(page)
  await sceneText(page).fill('Tomas came down to the quay at night.')
  await waitSaved(page)
  await propose(page, 'prp_cccccccccc', 'Tomas came down to the quay at dusk.', 'Changed.')
  await page.reload()
  const card = page.locator('[data-proposal="prp_cccccccccc"]')
  await expect(card).toContainText('Out of date')
  await expect(card.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Ask again' })).toBeVisible()
})

test('the chat stays after a reload, and Clear chat removes it from this device', async ({
  page,
  context,
}) => {
  await serveDav(context, new FakeDav())
  await page.route('**/agent/status', (r) => r.fulfill(json({ state: 'signed-in' })))
  await page.route('**/agent/ask', (r) =>
    r.fulfill({
      contentType: 'application/x-ndjson',
      body: [
        { t: 'tool', label: 'Read 1.1 Untitled scene' },
        { t: 'text', text: 'Tomas is a ferryman.' },
        { t: 'end', ok: true },
      ]
        .map((l) => `${JSON.stringify(l)}\n`)
        .join(''),
    }),
  )
  await createBrowserWorkspace(page)
  // The assistant reads the copy on the server: keep the workspace in sync first.
  await openBackupScreen(page)
  const backup = page.getByRole('dialog', { name: 'Backup and versions' })
  await backup.getByRole('switch', { name: 'Keep this workspace in sync on this device' }).click()
  await expect(backup).toContainText('Last looked at your server', { timeout: 20_000 })
  await page.keyboard.press('Escape')
  await expect(statusBar(page)).toContainText('Synced', { timeout: 20_000 })

  await assistantTab(page).click()
  await inspector(page)
    .getByRole('textbox', { name: 'Message the assistant' })
    .fill('Who is Tomas?')
  await inspector(page).getByRole('button', { name: 'Send', exact: true }).click()
  await expect(inspector(page)).toContainText('Tomas is a ferryman.')

  await page.reload()
  await assistantTab(page).click()
  await expect(inspector(page)).toContainText('Who is Tomas?')
  await expect(inspector(page)).toContainText('Read 1.1 Untitled scene')
  await expect(inspector(page)).toContainText('Tomas is a ferryman.')

  await inspector(page).getByRole('button', { name: 'Clear chat' }).click()
  await expect(inspector(page)).not.toContainText('Tomas is a ferryman.')
  await page.reload()
  await assistantTab(page).click()
  await expect(
    inspector(page).getByRole('textbox', { name: 'Message the assistant' }),
  ).toBeVisible()
  await expect(inspector(page)).not.toContainText('Who is Tomas?')
})

test('a suggestion this version cannot read is said in the inbox, and its file is left alone', async ({
  page,
}) => {
  await page.route('**/agent/status', (r) => r.fulfill(json({ state: 'signed-in' })))
  await createBrowserWorkspace(page)
  await sceneText(page).fill('Tomas came down to the quay at dusk.')
  await waitSaved(page)
  const scene = (await opfs.list(page)).find((f) => /^[^.]*\/scenes\/scn_\w+\.md$/.test(f))!
  const file = `${scene.split('/universes/')[0]}/.aurelia/proposals/prp_ffffffffff.json`
  const newer = JSON.stringify({ schemaVersion: 1, id: 'prp_ffffffffff', kind: 'timeline' })
  await opfs.write(page, file, newer)
  await page.reload()
  await assistantTab(page).click()
  await expect(inspector(page)).toContainText(
    '1 suggestion could not be read by this version of Aurelia.',
  )
  await expect(inspector(page)).not.toContainText('No suggestions waiting.')
  expect(await opfs.read(page, file)).toBe(newer)
})
