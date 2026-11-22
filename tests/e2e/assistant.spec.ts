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
  await proposeChanges(page, id, [{ before, after }])
}

async function proposeChanges(
  page: Page,
  id: string,
  changes: { before: string; after: string }[],
) {
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
      changes: changes.map((c, i) => ({ block: `b${i}-00000000`, ...c })),
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

const chip = (page: Page) => page.getByRole('button', { name: /^Show the suggestion for/ })
const popup = (page: Page) => page.getByRole('dialog', { name: /^Suggestion for/ })

for (const width of [1440, 390]) {
  test(`a suggestion in the text: a frame and a button, opened in a popup, approved with a snapshot first, or dismissed — ${width} px`, async ({
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
    // Hidden until clicked: a frame and one button, no card in the text.
    await expect(chip(page)).toHaveCount(1)
    await expect(page.locator('.suggestion-target')).toHaveCount(1)
    await expect(page.locator('[data-proposal]')).toHaveCount(0)
    await expect(chip(page)).toHaveAccessibleName(
      'Show the suggestion for this paragraph: “Tomas came down to the quay…”',
    )
    // Drawn only: the text itself is unchanged until Accept.
    await expect(sceneText(page)).toContainText('at dusk.')
    expect(await opfs.read(page, await firstScenePath(page))).toContain('at dusk.')
    expect(await serious(page, '.suggestion-target')).toEqual([])
    // On the frame, out of the text's way: the next paragraph is still indented as a paragraph after a
    // paragraph (`p + p`), and the framed one sits where it would without the button.
    const second = sceneText(page).locator('p').nth(1)
    expect(await second.evaluate((p) => getComputedStyle(p).textIndent)).not.toBe('0px')
    expect(await chip(page).evaluate((b) => getComputedStyle(b.parentElement!).position)).toBe(
      'absolute',
    )
    await page.screenshot({ path: `test-results/m8-screenshots/suggestion-${width}-button.png` })

    // Reachable by keyboard, and Escape closes it with nothing changed and focus back on the button.
    await chip(page).focus()
    await expect(chip(page)).toBeFocused()
    await page.keyboard.press('Enter')
    const card = popup(page).locator('[data-proposal="prp_aaaaaaaaaa"]')
    await expect(card).toContainText('Suggested by the assistant')
    await expect(card).toContainText('Dusk clashes with chapter 7.')
    await expect(card.locator('del')).toContainText('dusk')
    await expect(card.locator('ins')).toContainText('late afternoon')
    expect(await serious(page, '[role="dialog"]')).toEqual([])
    await page.screenshot({ path: `test-results/m8-screenshots/suggestion-${width}.png` })
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await serious(page, '[role="dialog"]')).toEqual([])
    await page.screenshot({ path: `test-results/m8-screenshots/suggestion-${width}-dark.png` })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.keyboard.press('Escape')
    await expect(popup(page)).toHaveCount(0)
    await expect(chip(page)).toBeFocused()
    await expect(sceneText(page)).toContainText('at dusk.')

    // Edited text is never lost silently: Escape asks first.
    await chip(page).click()
    await popup(page).getByRole('button', { name: 'Edit' }).click()
    await popup(page).getByRole('textbox', { name: 'Your text, paragraph 1' }).fill('Mine.')
    await page.keyboard.press('Escape')
    await expect(popup(page).getByRole('alert')).toContainText('Discard your edited text?')
    await popup(page).getByRole('button', { name: 'Discard' }).click()
    await expect(popup(page)).toHaveCount(0)

    // Edit: the author's words go in, not the assistant's. Cancel first changes nothing.
    await chip(page).click()
    await popup(page).getByRole('button', { name: 'Edit' }).click()
    const box = popup(page).getByRole('textbox', { name: 'Your text, paragraph 1' })
    await expect(box).toHaveValue('Tomas came down to the quay in the late afternoon.')
    await box.fill('Something else')
    await popup(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(popup(page).getByRole('textbox')).toHaveCount(0)
    await popup(page).getByRole('button', { name: 'Edit' }).click()
    await expect(box).toHaveValue('Tomas came down to the quay in the late afternoon.')
    await box.fill('Tomas came down to the quay at first light.')
    await popup(page).getByRole('button', { name: 'Accept my text' }).click()
    await expect(popup(page)).toHaveCount(0)
    await expect(chip(page)).toHaveCount(0)
    // The button that opened it is gone: focus is back in the text, not lost on the page.
    await expect(sceneText(page)).toBeFocused()
    await expect(sceneText(page)).toContainText('at first light.')
    await expect(sceneText(page)).not.toContainText('late afternoon')
    await expect(sceneText(page)).toContainText('The clerk counted the crates.')
    await waitSaved(page)
    const files = await opfs.list(page)
    expect(files.some((f) => f.includes('/.aurelia/proposals/'))).toBe(false)
    const manifests = files.filter((f) => /\.aurelia\/snapshots\/snp_\w+\/snapshot\.json$/.test(f))
    expect(manifests).toHaveLength(1)
    expect(await opfs.read(page, manifests[0]!)).toContain('"reason": "before-assistant"')

    // Accept as suggested.
    await propose(
      page,
      'prp_dddddddddd',
      'The clerk counted the crates.',
      'The clerk counted the barrels.',
    )
    await page.reload()
    await chip(page).click()
    await popup(page).getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(popup(page)).toHaveCount(0)
    await expect(sceneText(page)).toContainText('counted the barrels.')

    // Dismiss: the proposal goes, the text stays.
    await propose(
      page,
      'prp_bbbbbbbbbb',
      'The clerk counted the barrels.',
      'The clerk counted nothing.',
    )
    await page.reload()
    await chip(page).click()
    await popup(page).getByRole('button', { name: 'Dismiss' }).click()
    await expect(popup(page)).toHaveCount(0)
    await expect(chip(page)).toHaveCount(0)
    await expect(sceneText(page)).toBeFocused()
    await expect(sceneText(page)).toContainText('The clerk counted the barrels.')
  })
}

test('a suggestion over several paragraphs: a button on each framed one, one popup, and nothing framed that does not change', async ({
  page,
}) => {
  await page.route('**/agent/**', (r) => r.fulfill({ status: 502, body: '' }))
  await createBrowserWorkspace(page)
  await sceneText(page).fill('Tomas came down to the quay at dusk.')
  for (const t of ['The clerk counted the crates.', 'Rain fell on the lanterns.', 'Nobody spoke.'])
    await page.keyboard.press('Enter').then(() => page.keyboard.type(t))
  await waitSaved(page)
  await proposeChanges(page, 'prp_eeeeeeeeee', [
    {
      before: 'Tomas came down to the quay at dusk.',
      after: 'Tomas came down to the quay at noon.',
    },
    // Reads exactly as it does: no change, so no frame.
    { before: 'The clerk counted the crates.', after: 'The clerk counted the crates.' },
    { before: 'Rain fell on the lanterns.', after: 'Rain fell on the lamps.' },
  ])
  await page.reload()
  await expect(page.locator('.suggestion-target')).toHaveCount(2)
  await expect(chip(page)).toHaveCount(2)
  // One Tab stop for the suggestion: its first button.
  expect(await chip(page).evaluateAll((b) => b.map((x) => (x as HTMLElement).tabIndex))).toEqual([
    0, -1,
  ])
  await chip(page).nth(1).click()
  const card = popup(page).locator('[data-proposal="prp_eeeeeeeeee"]')
  await expect(card.locator('[data-focused]')).toContainText('lamps')
  await expect(card.locator('del')).toHaveCount(2)
  // Edit and approve: only the changed paragraphs are offered.
  await popup(page).getByRole('button', { name: 'Edit' }).click()
  await expect(popup(page).getByRole('textbox')).toHaveCount(2)
  await popup(page).getByRole('textbox').nth(1).fill('Rain fell on the roofs.')
  await popup(page).getByRole('button', { name: 'Accept my text' }).click()
  await expect(popup(page)).toHaveCount(0)
  await expect(sceneText(page)).toContainText('quay at noon.')
  await expect(sceneText(page)).toContainText('Rain fell on the roofs.')
  await expect(sceneText(page)).toContainText('The clerk counted the crates.')
  await expect(sceneText(page)).toContainText('Nobody spoke.')
})

test('two suggestions on one paragraph: one button, one popup listing both, accepting one leaves the other', async ({
  page,
}) => {
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
    'Tomas came down at noon.',
  )
  await propose(
    page,
    'prp_bbbbbbbbbb',
    'Tomas came down to the quay at dusk.',
    'Tomas came down at night.',
  )
  await page.reload()
  await expect(page.locator('.suggestion-target')).toHaveCount(1)
  const both = page.getByRole('button', { name: /^Show 2 suggestions for/ })
  await expect(both).toHaveCount(1)
  await expect(both).toHaveText('2 suggestions')
  await expect(page.locator('button.suggestion-chip')).toHaveCount(1)
  await both.click()
  const dialog = page.getByRole('dialog', { name: 'Suggestions for this paragraph' })
  await expect(dialog.locator('[data-proposal]')).toHaveCount(2)
  await expect(dialog).toContainText('Suggestion 1 of 2')
  await expect(dialog).toContainText('Suggestion 2 of 2')
  expect(await serious(page, '[role="dialog"]')).toEqual([])
  // Accept the first: the paragraph changes, the other no longer applies but stays, to dismiss.
  await dialog
    .locator('[data-proposal="prp_aaaaaaaaaa"]')
    .getByRole('button', { name: 'Accept', exact: true })
    .click()
  // With one card left the popup is titled for one suggestion, so it is found by its role alone.
  const left = page.getByRole('dialog')
  await expect(left.locator('[data-proposal="prp_aaaaaaaaaa"]')).toHaveCount(0)
  await expect(left).not.toContainText('Suggestion 2 of')
  const other = left.locator('[data-proposal="prp_bbbbbbbbbb"]')
  await expect(other).toContainText('Out of date')
  await expect(other.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
  await other.getByRole('button', { name: 'Dismiss' }).click()
  await expect(left).toHaveCount(0)
  await expect(sceneText(page)).toContainText('Tomas came down at noon.')
  await expect(page.locator('button.suggestion-chip')).toHaveCount(0)
})

test('a suggestion whose paragraph changed is out of date and cannot be accepted', async ({
  page,
}) => {
  await page.route('**/agent/**', (r) => r.fulfill({ status: 502, body: '' }))
  await createBrowserWorkspace(page)
  await sceneText(page).fill('Tomas came down to the quay at night.')
  await waitSaved(page)
  await propose(page, 'prp_cccccccccc', 'Tomas came down to the quay at dusk.', 'Changed.')
  await page.reload()
  // Nothing in the text still reads as the suggestion saw it: no frame, one button that says so.
  await expect(page.locator('.suggestion-target')).toHaveCount(0)
  const stale = page.getByRole('button', { name: /^Suggestion · out of date/ })
  await expect(stale).toHaveText('Suggestion · out of date')
  await stale.click()
  const card = popup(page).locator('[data-proposal="prp_cccccccccc"]')
  await expect(card).toContainText('Out of date')
  await expect(popup(page).getByRole('button', { name: 'Accept' })).toHaveCount(0)
  await expect(popup(page).getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await expect(popup(page).getByRole('button', { name: 'Dismiss' })).toBeVisible()
  await expect(popup(page).getByRole('button', { name: 'Ask again' })).toBeVisible()
})

test('the caret moves, and typing lands, across a framed paragraph as if the button were not there', async ({
  page,
}) => {
  await page.route('**/agent/**', (r) => r.fulfill({ status: 502, body: '' }))
  await createBrowserWorkspace(page)
  await sceneText(page).fill('One two.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Three four.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Five six.')
  await waitSaved(page)
  await propose(page, 'prp_ffffffffff', 'Three four.', 'Three and four.')
  await page.reload()
  await expect(chip(page)).toHaveCount(1)
  const p = (n: number) => sceneText(page).locator('p').nth(n)
  /** The caret at the start or end of paragraph `n`'s own text (never inside the button). */
  const caret = (n: number, at: 'start' | 'end') =>
    p(n).evaluate((el, at) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, (t) =>
        t.parentElement!.closest('[contenteditable="false"]')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
      )
      const texts: Text[] = []
      while (walk.nextNode()) texts.push(walk.currentNode as Text)
      const t = at === 'start' ? texts[0]! : texts.at(-1)!
      window.getSelection()!.collapse(t, at === 'start' ? 0 : t.length)
    }, at)
  await p(0).click()
  // From the end of the paragraph before, Right goes to the framed one's start: typing lands in it.
  await caret(0, 'end')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('X')
  await expect(p(1)).toHaveText(/XThree four\.$/)
  await page.keyboard.press('Backspace')
  // From its start, Left goes back to the end of the paragraph before.
  await caret(1, 'start')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('Y')
  await expect(p(0)).toHaveText('One two.Y')
  await page.keyboard.press('Backspace')
  // Down from the paragraph before, and up from the one after, land in the framed paragraph.
  await caret(0, 'end')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.type('Z')
  await expect(p(1)).toHaveText(/Z/)
  await page.keyboard.press('Backspace')
  await caret(2, 'start')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.type('W')
  await expect(p(1)).toHaveText(/W/)
  await page.keyboard.press('Backspace')
  // Copying the whole text takes the text, never the button's words.
  await page.keyboard.press('ControlOrMeta+a')
  const copied = await sceneText(page).evaluate((el) => {
    const e = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true })
    el.dispatchEvent(e)
    return e.clipboardData!.getData('text/plain')
  })
  expect(copied).toContain('Three four.')
  expect(copied).not.toContain('Suggestion')
  // Undo takes back what was typed, and nothing of the button.
  await caret(1, 'end')
  await page.keyboard.type(' Q')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(p(1)).toHaveText(/Three four\.$/)
  await waitSaved(page)
  expect(await opfs.read(page, await firstScenePath(page))).toContain(
    'One two.\n\nThree four.\n\nFive six.',
  )
})

test('a change of spacing alone is shown, so the author never accepts what they did not see', async ({
  page,
}) => {
  await page.route('**/agent/**', (r) => r.fulfill({ status: 502, body: '' }))
  await createBrowserWorkspace(page)
  await sceneText(page).fill('Tomas came down. The clerk counted.')
  await waitSaved(page)
  await propose(
    page,
    'prp_gggggggggg',
    'Tomas came down. The clerk counted.',
    'Tomas came down.\n\nThe clerk counted.',
  )
  await page.reload()
  await expect(page.locator('.suggestion-target')).toHaveCount(1)
  await chip(page).click()
  const ins = popup(page).locator('ins[data-space]')
  await expect(ins).toContainText('↵↵')
  await expect(ins).toContainText('Added: line break')
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
    '1 suggestion could not be read (a newer Aurelia may have written it, or the file is damaged).',
  )
  await expect(inspector(page)).not.toContainText('No suggestions waiting.')
  expect(await opfs.read(page, file)).toBe(newer)
})
