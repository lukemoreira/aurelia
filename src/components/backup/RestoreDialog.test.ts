// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import type { useRestore } from '@/composables/useRestore'
import RestoreDialog from './RestoreDialog.vue'

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
  }
}

const fake = (extra: Record<string, unknown> = {}) =>
  reactive({
    open: true,
    step: 'workspaces',
    loading: false,
    busy: false,
    error: '',
    listings: [],
    picked: { folder: 'Aurelia/My Book (wsp_x)', name: 'My Book' },
    versions: [],
    problems: [],
    serverState: 'available',
    canKeepInBrowser: true,
    canPickFolder: true,
    restore: vi.fn(),
    back: vi.fn(),
    ...extra,
  }) as unknown as ReturnType<typeof useRestore>

afterEach(() => {
  document.body.innerHTML = ''
})

describe('RestoreDialog', () => {
  it('moves focus to the new step’s heading on every step, so it is never lost with the button that was pressed', async () => {
    const r = fake()
    const wrapper = mount(RestoreDialog, { props: { restore: r }, attachTo: document.body })
    await settle()
    const active = () => document.activeElement as HTMLElement
    for (const [step, words] of [
      ['versions', 'My Book'],
      ['destination', 'Where should “My Book” go?'],
      ['problems', 'The backup did not pass the check'],
      ['workspaces', 'Backups on your server'],
    ] as const) {
      ;(r as unknown as { step: string }).step = step
      await settle()
      expect(active().textContent, step).toContain(words)
      expect(active().hasAttribute('data-step-focus'), step).toBe(true)
    }
    ;(r as unknown as { step: string }).step = 'sign-in'
    await settle()
    expect(active().textContent).toContain('Sign in again')
    wrapper.unmount()
  })

  it('keeps the button that is working enabled (focus stays on it) and says it is busy', async () => {
    const r = fake({ step: 'destination' })
    const wrapper = mount(RestoreDialog, { props: { restore: r }, attachTo: document.body })
    await settle()
    const button = () =>
      [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Keep it in this browser'),
      )!
    button().focus()
    ;(r as unknown as { busy: boolean }).busy = true
    await settle()
    expect(button().disabled).toBe(false)
    expect(button().getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(button())
    wrapper.unmount()
  })

  it('says why "Keep it in this browser" is off', async () => {
    const r = fake({ step: 'destination', canKeepInBrowser: false })
    const wrapper = mount(RestoreDialog, { props: { restore: r }, attachTo: document.body })
    await settle()
    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Keep it in this browser'),
    )!
    expect(button.disabled).toBe(true)
    const why = document.getElementById(button.getAttribute('aria-describedby')!)!
    expect(why.textContent).toContain('cannot keep files for Aurelia')
    wrapper.unmount()
  })

  it('offers "…and keep it in sync" only when the copy can join the sync, and ticks the composable’s flag', async () => {
    const r = fake({ step: 'destination', canKeepInSync: false, keepInSync: false })
    const wrapper = mount(RestoreDialog, { props: { restore: r }, attachTo: document.body })
    await settle()
    const box = () => document.querySelector('[role="checkbox"]') as HTMLElement | null
    expect(box()).toBeNull()
    ;(r as unknown as { canKeepInSync: boolean }).canKeepInSync = true
    await settle()
    expect(box()).not.toBeNull()
    expect(document.body.textContent).toContain('Keep it in sync with your other devices')
    box()!.click()
    await settle()
    expect((r as unknown as { keepInSync: boolean }).keepInSync).toBe(true)
    wrapper.unmount()
  })

  it('says which backups are kept in sync', async () => {
    const r = fake({
      listings: [
        {
          folder: 'Aurelia/My Book (wsp_x)',
          name: 'My Book',
          lastBackup: new Date().toISOString(),
          deviceName: 'Chrome on macOS',
          sync: true,
          files: 3,
          size: 3000,
        },
      ],
    })
    const wrapper = mount(RestoreDialog, { props: { restore: r }, attachTo: document.body })
    await settle()
    expect(document.body.textContent).toContain('Kept in sync')
    wrapper.unmount()
  })

  it('counts what did not pass and keeps the file names in a fold-out', async () => {
    const r = fake({
      step: 'problems',
      problems: [
        { path: 'universes/unv_a/books/bok_b/scenes/scn_c.md', kind: 'changed' },
        { path: 'universes/unv_a/books/bok_b/scenes/scn_d.md', kind: 'changed' },
        { path: 'aurelia.json', kind: 'missing' },
      ],
    })
    const wrapper = mount(RestoreDialog, { props: { restore: r }, attachTo: document.body })
    await settle()
    const text = document.body.textContent!
    expect(text).toContain('2 files do not match what was backed up')
    expect(text).toContain('1 file is missing from your server')
    const details = document.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('scn_c.md')
    expect(text.replace(details.textContent!, '')).not.toContain('scn_c.md')
    wrapper.unmount()
  })
})
