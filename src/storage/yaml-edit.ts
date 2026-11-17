// SPDX-License-Identifier: AGPL-3.0-or-later
import YAML, { isMap, isScalar, isSeq, visit } from 'yaml'
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
  return frame(parts, yaml)
}

/** The file with `yaml` (ending in a line break) as its frontmatter: the fences and the body as they were. */
function frame(parts: NonNullable<ReturnType<typeof splitDocument>>, yaml: string): string {
  const start = parts.head.indexOf('\n') + 1 // after the opening fence
  const tail = parts.yaml ? parts.head.slice(start + parts.yaml.length) : parts.head.slice(start)
  return `${parts.head.slice(0, start)}${yaml}${parts.yaml ? tail.replace(/^\r?\n/, '') : tail}${parts.body}`
}

/**
 * One change to one item of a list of small objects (a scene's `choices`, with IDs; its `changes`,
 * which have none, so they are found by their place in the list). An `update` with a field set to
 * `undefined` takes that field away.
 */
export type ListEdit =
  | { op: 'update'; id: string; fields: Record<string, unknown> }
  | { op: 'update'; at: number; fields: Record<string, unknown> }
  | { op: 'remove'; id: string }
  | { op: 'remove'; at: number }
  | { op: 'add'; item: Record<string, unknown> }

/** An item as the text of one flow map: `{ id: "x", label: "y" }`. */
function itemText(item: Record<string, unknown>): string {
  const doc = new YAML.Document([item])
  visit(doc, {
    Scalar: (k, n) => {
      if (k !== 'key' && typeof n.value === 'string') n.type = 'QUOTE_DOUBLE'
    },
    Seq: (_, seq) => {
      for (const it of seq.items) if (isMap(it)) it.flow = true
    },
  })
  return doc.toString({ lineWidth: 0 }).replace(/^- /, '').trimEnd()
}

/**
 * Change one item of a block list in the frontmatter, and nothing else: the comments and the
 * spacing of the other items, and every other key, stay byte for byte. Undefined when it cannot
 * be done that way (no such list, a flow list, the last item going, an item that is not there):
 * the caller then sets the whole key, which is always right but rewrites the list.
 */
export function patchListItem(text: string, key: string, edit: ListEdit): string | undefined {
  const parts = splitDocument(text)
  if (!parts) return undefined
  const eol = parts.head.includes('\r\n') ? '\r\n' : '\n'
  const source = parts.yaml ? parts.yaml + eol : ''
  const doc = YAML.parseDocument(source)
  const map = doc.contents
  if (doc.errors[0] || !isMap(map) || map.flow) return undefined
  const seq = map.items.find((p) => isScalar(p.key) && p.key.value === key)?.value
  if (!seq || !isSeq(seq) || seq.flow || !seq.items.length || !seq.items.every((i) => isMap(i)))
    return undefined
  const items = seq.items as YAML.YAMLMap[]
  const at =
    edit.op === 'add'
      ? items.length - 1
      : 'at' in edit
        ? edit.at
        : items.findIndex((i) => i.get('id') === edit.id)
  const item = items[at]
  if (!item?.range) return undefined
  // An item that ends in a block scalar (`quote: |`) already owns its line break: the line-based
  // edits below would take the next item with it. The caller sets the whole list instead.
  if (source[item.range[1] - 1] === '\n') return undefined
  const lineStart = source.lastIndexOf('\n', item.range[0] - 1) + 1
  const lineEnd = source.indexOf('\n', item.range[1]) + 1
  let yaml: string
  if (edit.op === 'update') {
    const merged = { ...(item.toJSON() as object), ...edit.fields }
    yaml = source.slice(0, item.range[0]) + itemText(merged) + source.slice(item.range[1])
  } else if (edit.op === 'remove') {
    if (items.length < 2) return undefined
    yaml = source.slice(0, lineStart) + source.slice(lineEnd)
  } else {
    const prefix = source.slice(lineStart, item.range[0]) // "  - ": the list's own indentation
    yaml = source.slice(0, lineEnd) + prefix + itemText(edit.item) + eol + source.slice(lineEnd)
  }
  if (yaml === source) return text
  // Never write what does not read back as exactly the list that was meant.
  const was = items.map((i) => i.toJSON() as Record<string, unknown>)
  const meant =
    edit.op === 'update'
      ? was.map((x, i) => (i === at ? { ...x, ...edit.fields } : x))
      : edit.op === 'remove'
        ? was.filter((_, i) => i !== at)
        : [...was, edit.item]
  const now = YAML.parseDocument(yaml)
  const list = isMap(now.contents) ? now.contents.get(key) : undefined
  if (now.errors[0] || JSON.stringify(list) !== JSON.stringify(meant)) return undefined
  return frame(parts, yaml)
}
