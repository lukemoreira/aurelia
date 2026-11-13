// SPDX-License-Identifier: AGPL-3.0-or-later
import { StorageError } from './errors'

/**
 * Where the top-level `"name"` value sits in the text of `aurelia.json`: `[start, end)`, quotes
 * included. With a repeated key it is the LAST one, the one `JSON.parse` reads.
 */
function nameSpan(text: string): [number, number] | null {
  const stringEnd = (from: number) => {
    let j = from + 1
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
    return j + 1
  }
  let depth = 0
  let expectKey = false
  let found: [number, number] | null = null
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === '"') {
      const end = stringEnd(i)
      if (depth === 1 && expectKey) {
        expectKey = false
        let j = end
        while (/[\s:]/.test(text[j] ?? '')) j++
        if (text.slice(i, end) === '"name"' && text[j] === '"') found = [j, stringEnd(j)]
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

/**
 * `aurelia.json` with only the name's value replaced: every other byte (key order, indentation,
 * line endings, the trailing newline, keys this version does not know) stays as it was.
 */
export function renameInWorkspaceJson(text: string, name: string): string {
  const span = nameSpan(text)
  if (!span)
    throw new StorageError('other', 'Aurelia could not find the name in the workspace file.')
  return `${text.slice(0, span[0])}${JSON.stringify(name)}${text.slice(span[1])}`
}

/** The workspace name a text of `aurelia.json` holds, or undefined when it holds none. */
export function workspaceNameIn(text: string): string | undefined {
  try {
    const name: unknown = (JSON.parse(text) as { name?: unknown }).name
    return typeof name === 'string' ? name : undefined
  } catch {
    return undefined
  }
}
