// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { isPinChord, matchShortcut, type Shortcut } from './useKeyboardShortcuts'

const nav: Shortcut = { code: 'Backslash', run: () => {} }
const inspector: Shortcut = { code: 'Backslash', alt: true, run: () => {} }
const palette: Shortcut = { code: 'KeyK', run: () => {} }
const all = [nav, inspector, palette]
const key = (init: KeyboardEventInit & { altGraph?: boolean }) => {
  const e = new KeyboardEvent('keydown', init)
  // happy-dom answers AltGraph with altKey; a real browser does not.
  e.getModifierState = (k) => k === 'AltGraph' && !!init.altGraph
  return e
}

describe('matchShortcut on a Mac', () => {
  const mac = (e: KeyboardEvent, list = all) => matchShortcut(e, list, true)

  it('takes Cmd and nothing else: Ctrl+K is text editing', () => {
    expect(mac(key({ code: 'KeyK', metaKey: true }))).toBe(palette)
    expect(mac(key({ code: 'KeyK', ctrlKey: true }))).toBeUndefined()
    expect(mac(key({ code: 'KeyK', ctrlKey: true, metaKey: true }))).toBeUndefined()
  })

  it('keeps the navigator and the inspector shortcuts apart', () => {
    expect(mac(key({ code: 'Backslash', metaKey: true }))).toBe(nav)
    expect(mac(key({ code: 'Backslash', metaKey: true, altKey: true }))).toBe(inspector)
  })
})

describe('matchShortcut elsewhere', () => {
  const pc = (e: KeyboardEvent) => matchShortcut(e, all, false)

  it('takes Ctrl and not the Windows key', () => {
    expect(pc(key({ code: 'KeyK', ctrlKey: true }))).toBe(palette)
    expect(pc(key({ code: 'KeyK', metaKey: true }))).toBeUndefined()
  })

  it('keeps the navigator and the inspector shortcuts apart', () => {
    expect(pc(key({ code: 'Backslash', ctrlKey: true }))).toBe(nav)
    expect(pc(key({ code: 'Backslash', ctrlKey: true, altKey: true }))).toBe(inspector)
  })

  it('ignores AltGr, which is Ctrl+Alt and types a letter', () => {
    expect(
      pc(key({ code: 'Backslash', ctrlKey: true, altKey: true, altGraph: true })),
    ).toBeUndefined()
  })

  it('ignores a bare key, a shifted chord and a key nobody asked for', () => {
    expect(pc(key({ code: 'KeyK' }))).toBeUndefined()
    expect(pc(key({ code: 'KeyK', ctrlKey: true, shiftKey: true }))).toBeUndefined()
    expect(pc(key({ code: 'KeyJ', ctrlKey: true }))).toBeUndefined()
  })
})

describe('isPinChord', () => {
  it('is Alt+P by code, whatever character the key types', () => {
    expect(isPinChord(key({ code: 'KeyP', key: 'π', altKey: true }))).toBe(true)
    expect(isPinChord(key({ code: 'KeyP', key: 'p', altKey: true }))).toBe(true)
  })

  it('is not P alone, nor with Ctrl or Cmd', () => {
    expect(isPinChord(key({ code: 'KeyP' }))).toBe(false)
    expect(isPinChord(key({ code: 'KeyP', altKey: true, ctrlKey: true }))).toBe(false)
    expect(isPinChord(key({ code: 'KeyP', altKey: true, metaKey: true }))).toBe(false)
  })
})
