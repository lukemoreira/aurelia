// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

type Listener = (e: { matches: boolean }) => void

let listeners: Listener[]
let osDark: boolean

beforeEach(() => {
  vi.resetModules()
  listeners = []
  osDark = false
  delete document.documentElement.dataset.theme
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return osDark
    },
    addEventListener: (_: string, fn: Listener) => listeners.push(fn),
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const load = async () => (await import('./useTheme')).useTheme()
const theme = () => document.documentElement.dataset.theme

describe('useTheme', () => {
  it('saves the choice per device and restores it', async () => {
    const first = await load()
    first.setTheme('dark')
    await nextTick()
    expect(theme()).toBe('dark')
    expect(localStorage.getItem('aurelia.theme')).toBe('dark')

    vi.resetModules()
    const again = await load()
    expect(again.choice.value).toBe('dark')
  })

  it('follows the system live when set to system', async () => {
    const t = await load()
    await nextTick()
    expect(theme()).toBe('light')
    listeners.forEach((fn) => fn({ matches: true }))
    await nextTick()
    expect(theme()).toBe('dark')
    expect(t.resolved.value).toBe('dark')
  })

  it('still works when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const t = await load()
    expect(t.choice.value).toBe('system')
    t.setTheme('dark')
    await nextTick()
    expect(theme()).toBe('dark')
    vi.restoreAllMocks()
  })
})
