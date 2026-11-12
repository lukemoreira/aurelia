// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest'
import { leavePanelFocus, MAIN_CONTENT_ID } from './useFocusMain'

afterEach(() => {
  document.body.innerHTML = ''
})

const page = () => {
  document.body.innerHTML = `
    <div data-panel="navigator"><button id="in-nav">a</button></div>
    <div id="${MAIN_CONTENT_ID}" tabindex="0"><button id="in-main">b</button></div>
    <div data-panel="inspector"><button id="in-inspector">c</button></div>`
  const el = (id: string) => document.getElementById(id) as HTMLElement
  return { main: el(MAIN_CONTENT_ID), el }
}

describe('leavePanelFocus', () => {
  it('moves focus to the main content when it is inside the panel that closes', () => {
    const { main, el } = page()
    el('in-nav').focus()
    leavePanelFocus('navigator')
    expect(document.activeElement).toBe(main)
  })

  it('leaves focus alone when it is elsewhere', () => {
    const { el } = page()
    el('in-inspector').focus()
    leavePanelFocus('navigator')
    expect(document.activeElement).toBe(el('in-inspector'))
    el('in-main').focus()
    leavePanelFocus('inspector')
    expect(document.activeElement).toBe(el('in-main'))
  })
})
