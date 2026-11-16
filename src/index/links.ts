// SPDX-License-Identifier: AGPL-3.0-or-later

/** A `[[…]]` or `![[…]]` in a text (ADR-0003 dialect), where it sits and what it points at. */
export interface LinkRef {
  /** Offsets in the text: `start` is the `[[` (or the `!` of an embed), `end` is after the `]]`. */
  start: number
  end: number
  embed: boolean
  /** The part before `|`, trimmed: a name, or `id:…`. */
  target: string
  /** Where the target sits in the text, so it can be rewritten on its own. */
  targetAt: [number, number]
  /** The visible text after `|`, if any. */
  label?: string
  labelAt?: [number, number]
  /** The ID of an `id:…` link. */
  id?: string
}

// `[[Name]]`, `[[Name|label]]`, `[[Name\|label]]` (inside a table), `![[Name]]`. No brackets or line
// breaks inside; the pipe splits the target from the label.
const LINK = /(!?)\[\[([^[\]\n|\\]+?)(?:\\?\|([^[\]\n]*))?\]\]/g

export type Range = [start: number, end: number]

/** Where inline code and fences sit: a link inside them is text, not a link, and no name is found there. */
export function codeRanges(text: string): Range[] {
  if (!text.includes('`') && !text.includes('~~~')) return []
  const out: Range[] = []
  const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|$)|$)/gm
  for (const m of text.matchAll(fence)) out.push([m.index, m.index + m[0].length])
  for (const m of text.matchAll(/`+[^`\n]+`+/g)) out.push([m.index, m.index + m[0].length])
  return out.sort((a, b) => a[0] - b[0])
}

/** The text with code as blanks of the same length. */
function maskCode(text: string): string {
  let out = text
  for (const [from, to] of codeRanges(text))
    out = out.slice(0, from) + out.slice(from, to).replace(/[^\n]/g, ' ') + out.slice(to)
  return out
}

/** Every link in a text, in order. A link behind a backslash, or in code, is not one. */
export function parseLinks(text: string): LinkRef[] {
  if (!text.includes('[[')) return []
  const masked = maskCode(text)
  const out: LinkRef[] = []
  for (const m of masked.matchAll(LINK)) {
    const start = m.index
    const embed = m[1] === '!'
    const open = start + m[1]!.length
    if (!embed && text[start - 1] === '\\') continue // `\[[` is the author escaping it
    const raw = m[2]!
    const lead = raw.length - raw.trimStart().length
    const target = raw.trim()
    if (!target) continue
    const targetFrom = open + 2 + lead
    const link: LinkRef = {
      start,
      end: start + m[0].length,
      embed,
      target,
      targetAt: [targetFrom, targetFrom + target.length],
    }
    if (m[3] !== undefined) {
      const labelFrom = start + m[0].length - 2 - m[3].length
      link.label = m[3]
      link.labelAt = [labelFrom, labelFrom + m[3].length]
    }
    if (target.startsWith('id:')) link.id = target.slice(3).trim()
    out.push(link)
  }
  return out
}

/** A title Markdown would read (`*`, `_`, `[`, `<`…) or a link could not hold: it is written by its ID, not by name. */
export const needsId = (title: string) => /[*_~[\]<>\\|`]/.test(title)

/** The text of a link as the author would write it: `[[Name]]`, or `[[id:…|Name]]` when a name is not enough. */
export function linkText(name: string, opts: { id?: string; embed?: boolean } = {}): string {
  const bang = opts.embed ? '!' : ''
  return opts.id ? `${bang}[[id:${opts.id}|${name}]]` : `${bang}[[${name}]]`
}
