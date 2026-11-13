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
})
