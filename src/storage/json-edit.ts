// SPDX-License-Identifier: AGPL-3.0-or-later
// Edits one top-level key of a JSON file as text, so every other byte stays as it was: key order,
// indentation, line endings, the trailing newline, keys this version does not know (ADR-0003 rule 6).

const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c)

/** The end of the string that starts at `from`. */
function stringEnd(text: string, from: number): number {
  let j = from + 1
  while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
  return j + 1
}

/** The end of the value that starts at `from`: a string, an object or array, or a bare word. */
function valueEnd(text: string, from: number): number {
  const c = text[from]
  if (c === '"') return stringEnd(text, from)
  if (c === '{' || c === '[') {
    let depth = 0
    for (let i = from; i < text.length;) {
      const d = text[i]
      if (d === '"') {
        i = stringEnd(text, i)
        continue
      }
      if (d === '{' || d === '[') depth++
      else if (d === '}' || d === ']') depth--
      i++
      if (depth === 0) return i
    }
    return text.length
  }
  let i = from
  while (i < text.length && !/[\s,}\]]/.test(text[i]!)) i++
  return i
}

/**
 * Where the top-level `key`'s value sits: `[start, end)`. With a repeated key it is the LAST one,
 * the one `JSON.parse` reads. Null when the key is not there.
 */
export function topLevelValueSpan(text: string, key: string): [number, number] | null {
  const span = memberSpan(text, key)
  return span ? [span[1], span[2]] : null
}

/** Where the last top-level member `key` sits: `[key start, value start, value end)`. */
function memberSpan(text: string, key: string): [number, number, number] | null {
  const wanted = JSON.stringify(key)
  let depth = 0
  let expectKey = false
  let found: [number, number, number] | null = null
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === '"') {
      const end = stringEnd(text, i)
      if (depth === 1 && expectKey) {
        expectKey = false
        let j = end
        while (/[\s:]/.test(text[j] ?? '')) j++
        if (text.slice(i, end) === wanted) found = [i, j, valueEnd(text, j)]
      }
      i = end
      continue
    }
    if (c === '{' || c === '[') {
      depth++
      if (c === '{' && depth === 1) expectKey = true
    } else if (c === '}' || c === ']') depth--
    else if (c === ',' && depth === 1) expectKey = true
    i++
  }
  return found
}

/** The indentation the file's own members use, else two spaces. */
function memberIndent(text: string): string {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? '  '
}

/**
 * The text with the top-level `key` set to `value`: replaced in place, or added as the last member.
 * New text is laid out the way the file already is (its indentation and line endings).
 */
export function setTopLevel(text: string, key: string, value: unknown): string {
  const indent = memberIndent(text)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const body = JSON.stringify(value, null, indent).replace(/\n/g, `${eol}${indent}`)
  const span = topLevelValueSpan(text, key)
  if (span) return text.slice(0, span[0]) + body + text.slice(span[1])
  const close = text.lastIndexOf('}')
  if (close < 0) throw new Error('This file is not a JSON object.')
  let end = close
  while (isSpace(text[end - 1])) end--
  const empty = text[end - 1] === '{'
  const member = `${indent}${JSON.stringify(key)}: ${body}`
  return `${text.slice(0, end)}${empty ? '' : ','}${eol}${member}${text.slice(end)}`
}

/** The text without the top-level `key` (and its comma); the same text when the key is not there. */
export function removeTopLevel(text: string, key: string): string {
  const span = memberSpan(text, key)
  if (!span) return text
  let [from, , to] = span
  const after = /^\s*,/.exec(text.slice(to))
  if (after) to += after[0].length
  else {
    // The last member: the comma before it goes instead.
    const before = /,\s*$/.exec(text.slice(0, from))
    if (before) from -= before[0].length
  }
  // The member's own line goes with it, so no blank line is left behind.
  const line = /[ \t]*$/.exec(text.slice(0, from))![0]
  if (
    /^\r?\n/.test(text.slice(to)) &&
    (from - line.length === 0 || /\n$/.test(text.slice(0, from - line.length)))
  ) {
    from -= line.length
    to += /^\r?\n/.exec(text.slice(to))![0].length
  }
  return text.slice(0, from) + text.slice(to)
}
