// SPDX-License-Identifier: AGPL-3.0-or-later
import YAML from 'yaml'

/**
 * A Markdown file split where the frontmatter ends. `head` is everything up to the body —
 * the fences, the YAML and the blank line after it — exactly as it was on disk, so that
 * writing `head + body` back changes nothing but the body (ADR-0003 rule 7).
 */
export interface SplitDocument {
  head: string
  yaml: string
  body: string
}

const FRONTMATTER =
  /^(\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*)/

export function splitDocument(text: string): SplitDocument | null {
  const m = FRONTMATTER.exec(text)
  if (!m) return null
  return { head: m[1]!, yaml: m[2] ?? '', body: text.slice(m[1]!.length) }
}

/** The frontmatter as plain data. Throws a readable message when the YAML is broken. */
export function parseFrontmatter(yaml: string): unknown {
  try {
    return YAML.parse(yaml) ?? {}
  } catch (e) {
    throw new Error(
      `The details at the top are not valid YAML (${(e as Error).message.split('\n')[0]}).`,
      { cause: e },
    )
  }
}

const usesCrlf = (head: string) => head.includes('\r\n')

/** The body as the editor shows it: always `\n`. */
export const bodyForEditor = (head: string, body: string) =>
  usesCrlf(head) ? body.replace(/\r\n/g, '\n') : body

/** The file for an edited body: the old head untouched, the body in the file's own line endings. */
export const withBody = (head: string, body: string) =>
  head + (usesCrlf(head) ? body.replace(/\r?\n/g, '\r\n') : body)

/** A new frontmatter block. Strings are always quoted and `title` comes first (ADR-0003 rules 7, 9). */
export const newHead = (meta: Record<string, unknown>) =>
  `---\n${YAML.stringify(meta, { defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' })}---\n\n`
