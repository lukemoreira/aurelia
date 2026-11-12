// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

function vars(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]!.trim()]),
  )
}

const light = vars(/^:root\s*\{([^}]*)\}/m.exec(css)![1]!)
const dark = vars(/^\[data-theme=["']dark["']\]\s*\{([^}]*)\}/m.exec(css)![1]!)
const systemDark = vars(/:root:not\(\[data-theme=["']light["']\]\)\s*\{([^}]*)\}/.exec(css)![1]!)

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground, background(s), minimum ratio]
const PAIRS: [string, string[], number][] = [
  ['ink', ['canvas', 'surface', 'chrome'], 4.5],
  ['ink-2', ['canvas', 'surface', 'chrome'], 4.5],
  ['ink-3', ['canvas', 'surface', 'chrome'], 4.5],
  ['gold-ink', ['canvas', 'surface', 'gold-soft'], 4.5],
  ['warn', ['warn-soft'], 4.5],
  ['danger', ['danger-soft'], 4.5],
  ['ok', ['ok-soft', 'chrome'], 4.5],
  ['info', ['info-soft'], 4.5],
  ['on-gold', ['gold'], 4.5],
  ['on-accent', ['ember', 'tide', 'moss', 'plum'], 4.5],
  ['field', ['surface'], 3],
]

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast', (_name, theme) => {
  it.each(PAIRS.flatMap(([fg, bgs, min]) => bgs.map((bg) => [fg, bg, min] as const)))(
    '%s on %s is at least %d:1',
    (fg, bg, min) => {
      expect(contrast(theme[fg]!, theme[bg]!)).toBeGreaterThanOrEqual(min)
    },
  )
})

it('the system-dark block equals the dark block', () => {
  expect(systemDark).toEqual(dark)
})

it('both themes define the same tokens', () => {
  const colours = (t: Record<string, string>) =>
    Object.keys(t)
      .filter((k) => /^(?!radius|font)/.test(k))
      .sort()
  expect(colours(dark)).toEqual(colours(light))
})
