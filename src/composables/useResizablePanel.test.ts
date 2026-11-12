// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useResizablePanel } from './useResizablePanel'

const opts = { key: 'panel.test', initial: 272, min: 200, max: 400, side: 'left' as const }
const key = (k: string, shiftKey = false) =>
  new KeyboardEvent('keydown', { key: k, shiftKey, cancelable: true })

const resizeWindowTo = (width: number) => {
  window.innerWidth = width
  window.dispatchEvent(new Event('resize'))
}
const originalWidth = window.innerWidth

beforeEach(() => localStorage.clear())
afterEach(() => resizeWindowTo(originalWidth))

describe('useResizablePanel', () => {
  it('grows a left panel with ArrowRight and shrinks it with ArrowLeft', () => {
    const p = useResizablePanel(opts)
    p.onKeydown(key('ArrowRight'))
    expect(p.width.value).toBe(288)
    p.onKeydown(key('ArrowLeft'))
    p.onKeydown(key('ArrowLeft'))
    expect(p.width.value).toBe(256)
  })

  it('reverses the arrows for a right panel', () => {
    const p = useResizablePanel({ ...opts, side: 'right' })
    p.onKeydown(key('ArrowLeft'))
    expect(p.width.value).toBe(288)
  })

  it('stays between the minimum and the maximum, and Home and End jump to them', () => {
    const p = useResizablePanel(opts)
    p.onKeydown(key('End'))
    expect(p.width.value).toBe(400)
    p.onKeydown(key('ArrowRight', true))
    expect(p.width.value).toBe(400)
    p.onKeydown(key('Home'))
    expect(p.width.value).toBe(200)
  })

  it('ignores other keys and leaves them alone', () => {
    const p = useResizablePanel(opts)
    const e = key('a')
    p.onKeydown(e)
    expect(e.defaultPrevented).toBe(false)
    expect(p.width.value).toBe(272)
  })

  it('saves its size and collapsed state for the next visit', async () => {
    const p = useResizablePanel(opts)
    p.onKeydown(key('ArrowRight', true))
    p.toggle()
    await Promise.resolve()
    const next = useResizablePanel(opts)
    expect([next.width.value, next.collapsed.value]).toEqual([336, true])
  })

  it('never takes more than 40% of the window, and gets its width back when the window grows', () => {
    const p = useResizablePanel(opts)
    p.onKeydown(key('End'))
    expect(p.width.value).toBe(400)
    resizeWindowTo(700) // 40% is 280
    expect(p.max.value).toBe(280)
    expect(p.width.value).toBe(280)
    resizeWindowTo(1600)
    expect(p.width.value).toBe(400)
  })

  it('keeps its minimum on a window too narrow for it', () => {
    const p = useResizablePanel(opts)
    resizeWindowTo(300)
    expect(p.width.value).toBe(200)
  })

  it('drags from the pointer, with the direction following the side', () => {
    const p = useResizablePanel(opts)
    p.onPointerDown({ clientX: 100, pointerId: 1, currentTarget: null } as unknown as PointerEvent)
    p.onPointerMove({ clientX: 140 } as PointerEvent)
    expect(p.width.value).toBe(312)
    p.onPointerUp()
    p.onPointerMove({ clientX: 300 } as PointerEvent)
    expect(p.width.value).toBe(312)
  })
})
