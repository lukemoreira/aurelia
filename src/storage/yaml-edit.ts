// SPDX-License-Identifier: AGPL-3.0-or-later
import YAML, { isMap, isScalar, visit } from 'yaml'
import { splitDocument } from './frontmatter'

/** Keys to set in a file's frontmatter. A value of `undefined` takes the key away. */
export type YamlPatch = Record<string, unknown>

/** One key as YAML text, ending in a line break: strings quoted, lists of small objects one to a line. */
function pairText(key: string, value: unknown, eol: string): string {
  const doc = new YAML.Document({ [key]: value })
  visit(doc, {
    Scalar: (k, n) => {
      if (k !== 'key' && typeof n.value === 'string') n.type = 'QUOTE_DOUBLE'
    },
    Seq: (_, seq) => {
      for (const item of seq.items) if (isMap(item)) item.flow = true
    },
  })
  return doc.toString({ lineWidth: 0 }).replace(/\n/g, eol)
}

interface Splice {
  from: number
  to: number
  text: string
}

/**
 * A Markdown file with some of its frontmatter keys set. The YAML is read through the `yaml`
 * Document API to find where each key sits, and only those places are rewritten: every other byte
 * — comments, spacing, key order, keys this version does not know, the file's line endings, the
 * body — stays exactly as it was (ADR-0003 rules 6 and 7). Strings are quoted on write. A patch
 * that changes nothing returns the very same text.
 */
export function patchFrontmatter(text: string, patch: YamlPatch): string {
  const parts = splitDocument(text)
  if (!parts) throw new Error('There are no details (frontmatter) at the top of this file.')
  const eol = parts.head.includes('\r\n') ? '\r\n' : '\n'
  // Every line ends with a line break, so a pair always ends where the next one starts.
  const source = parts.yaml ? parts.yaml + eol : ''
  const doc = YAML.parseDocument(source)
  const broken = doc.errors[0]
  if (broken)
    throw new Error(`The details at the top are not valid YAML (${broken.message.split('\n')[0]}).`)
  const map = doc.contents
  if (map !== null && !(isMap(map) && !map.flow))
    throw new Error('The details at the top are not a list of fields.')

  const now = (doc.toJS() ?? {}) as Record<string, unknown>
  const splices: Splice[] = []
  let added = ''
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(now[key]) === JSON.stringify(value)) continue
    const pair = map?.items.find((p) => isScalar(p.key) && p.key.value === key)
    const from = pair && isScalar(pair.key) ? pair.key.range![0] : -1
    if (!pair) {
      if (value !== undefined) added += pairText(key, value, eol)
      continue
    }
    const node = pair.value
    // A value that other lines point to (`&name`) is left alone: changing it would change them too.
    if (node && 'anchor' in node && node.anchor)
      throw new Error(
        `“${key}” carries a YAML anchor (&${node.anchor}) that other lines may point to, so Aurelia will not change it. Edit it by hand.`,
      )
    // Nothing after the colon (`summary:`) is a null: it has no text of its own to replace.
    const empty = !node || (isScalar(node) && node.value === null)
    // Where the pair ends: after its value, its trailing comment and its line break.
    const to = !empty
      ? Math.max(node.range![2], node.range![1])
      : source.indexOf('\n', pair.key.range![1] as number) + 1
    if (value === undefined) {
      splices.push({ from, to, text: '' })
    } else if (
      !empty &&
      isScalar(node) &&
      (node.type === undefined || /^(PLAIN|QUOTE_)/.test(node.type)) &&
      typeof value !== 'object'
    ) {
      // A one-line value changes in place, so the comment after it stays.
      splices.push({ from: node.range![0], to: node.range![1], text: JSON.stringify(value) })
    } else splices.push({ from, to, text: pairText(key, value, eol) })
  }
  if (!splices.length && !added) return text

  let yaml = source
  for (const s of splices.sort((a, b) => b.from - a.from))
    yaml = yaml.slice(0, s.from) + s.text + yaml.slice(s.to)
  yaml += added
  const start = parts.head.indexOf('\n') + 1 // after the opening fence
  const tail = parts.yaml ? parts.head.slice(start + parts.yaml.length) : parts.head.slice(start)
  return `${parts.head.slice(0, start)}${yaml}${parts.yaml ? tail.replace(/^\r?\n/, '') : tail}${parts.body}`
}
