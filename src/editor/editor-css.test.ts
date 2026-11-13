// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The test environment draws no CSS, so what the design asks of the writing surface is checked
// in the stylesheet itself: a gold caret, no frame around the text, and tokens for every colour.
const css = readFileSync('src/styles/editor.css', 'utf8')
const rule = (selector: string) =>
  new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('editor.css', () => {
  it('draws a gold caret and no ring or frame around the text', () => {
    const surface = rule('.manuscript .ProseMirror')
    expect(surface).toContain('caret-color: var(--gold-ink)')
    expect(surface).toContain('outline: none')
    expect(surface).not.toMatch(/border|padding|background|box-shadow|margin/)
  })

  it('uses a token for every colour, so both themes follow', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
  })

  it('has a rule for every setting the author can choose', () => {
    for (const attr of ['font', 'size', 'leading', 'paragraphs'])
      expect(css, attr).toContain(`.manuscript[data-${attr}=`)
    for (const value of [
      'sans',
      'mono',
      'small',
      'large',
      'larger',
      'tight',
      'roomy',
      'space',
      'wide',
    ])
      expect(css, value).toContain(`='${value}'`)
  })

  it('sizes headings in the text under the scene title, by the level kept in the file', () => {
    const size = (level: number) =>
      Number(
        /font-size: ([\d.]+)em/.exec(rule(`.manuscript .ProseMirror [data-level='${level}']`))?.[1],
      )
    expect([size(1), size(2), size(3)]).toEqual([1.3, 1.15, 1.05])
  })

  it('selects in gold, and leaves the measure to the page (the stylesheet sets the type, not the width)', () => {
    expect(rule('.manuscript .ProseMirror ::selection')).toContain('var(--gold-line)')
    expect(css).not.toMatch(/max-width/)
  })

  it('draws a block kept as written with a plain rule, not a dash, capitals or a monospace face', () => {
    const raw = rule('.manuscript .ProseMirror pre[data-raw-block]')
    expect(raw).toContain('border-left: 2px solid var(--line-2)')
    expect(raw).not.toMatch(/dashed|monospace|font-mono/)
    expect(rule('.manuscript .ProseMirror pre[data-raw-block]::before')).not.toContain('uppercase')
  })
})
