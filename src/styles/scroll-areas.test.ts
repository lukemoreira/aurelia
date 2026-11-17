// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Hidden screen-reader text (`sr-only`) is position: absolute. In a scroll area that is not
// positioned itself, it is placed against an outer box, so the scroll area does not hold it: it
// sticks out and makes the outer pane, or the whole page, scroll too. Two scroll bars, or an app
// that scrolls out of the window. So every class list that makes a scroll area also positions it.
const SCROLL = /(?:^|[\s'"])(?:[\w-]+:)*overflow-(?:[xy]-)?(?:auto|scroll)(?=[\s'"]|$)/
const POSITIONED = /(?:^|[\s'"])(?:relative|absolute|fixed|sticky)(?=[\s'"]|$)/

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return sources(path)
    return /\.(vue|ts)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path] : []
  })
}

describe('scroll areas', () => {
  it('each one is positioned, so what is inside it stays inside it', () => {
    const loose = sources('src').flatMap((file) =>
      // A double-quoted attribute may hold single-quoted class lists (a :class ternary): read it whole.
      [...readFileSync(file, 'utf8').matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g)]
        .map((m) => m[1] ?? m[2] ?? m[3] ?? '')
        .filter((list) => SCROLL.test(list) && !POSITIONED.test(list))
        .map((list) => `${file}: ${list}`),
    )
    expect(loose).toEqual([])
  })
})
