// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import type { SessionView } from '@/storage/session'
import ConflictDialog from './ConflictDialog.vue'
import FilesDialog from './FilesDialog.vue'

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
  }
}
afterEach(() => (document.body.innerHTML = ''))

const view = {
  readOnly: false,
  problems: [],
  duplicates: [],
  copies: [
    {
      path: 'universes/unv_a/books/bok_b/scenes/scn_c (Aurelia copy 0a1b2c3d).md',
      original: 'universes/unv_a/books/bok_b/scenes/scn_c.md',
      title: 'The bells',
    },
  ],
} as unknown as SessionView

const mountFiles = (sync: boolean) =>
  mount(FilesDialog, {
    props: { view, busy: '', error: '', sync, open: true },
    attachTo: document.body,
  })
const buttons = () => [...document.querySelectorAll('button')].map((b) => b.textContent?.trim())

describe('the list of files with two versions', () => {
  it('shows the scene’s title, and the file names only in a fold-out', async () => {
    const w = mountFiles(true)
    await settle()
    const item = document.querySelector('li') as HTMLElement
    expect(item.textContent).toContain('“The bells” — two versions')
    const details = item.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('scn_c')
    // Outside the fold-out no ID reaches the author.
    const outside = item.textContent!.replace(details.textContent!, '')
    expect(outside).not.toMatch(/scn_|unv_|bok_/)
    w.unmount()
  })

  it('after a sync, says the versions in plain words; otherwise the buttons are as they were', async () => {
    let w = mountFiles(true)
    await settle()
    expect(buttons()).toEqual(
      expect.arrayContaining(['Keep the text in the scene', 'Use the set-aside text']),
    )
    w.unmount()
    w = mountFiles(false)
    await settle()
    expect(buttons()).toEqual(expect.arrayContaining(['Keep the original', 'Keep this copy']))
    w.unmount()
  })
})

describe('the conflict dialog', () => {
  const conflict = { path: 'a.md', title: 'The bells', mine: 'mine', theirs: 'theirs' }
  it('says the other text is another device’s when the workspace is synced', async () => {
    const w = mount(ConflictDialog, {
      props: { conflict, busy: false, error: '', sync: true, open: true },
      attachTo: document.body,
    })
    await settle()
    expect(document.body.textContent).toContain('The other device’s version')
    expect(buttons()).toContain('Use the other device’s version')
    expect(document.body.textContent).not.toContain('The file’s version')
    w.unmount()
  })
})
