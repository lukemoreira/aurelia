// SPDX-License-Identifier: AGPL-3.0-or-later
import { StorageError } from './errors'
import { topLevelValueSpan } from './json-edit'

/**
 * `aurelia.json` with only the name's value replaced: every other byte (key order, indentation,
 * line endings, the trailing newline, keys this version does not know) stays as it was.
 */
export function renameInWorkspaceJson(text: string, name: string): string {
  const span = topLevelValueSpan(text, 'name')
  if (!span || text[span[0]] !== '"')
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
