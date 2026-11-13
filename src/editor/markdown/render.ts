// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Mark, Node } from '@tiptap/pm/model'

/** Marks outermost first, so one text always opens its marks in the same order. */
const MARK_ORDER = ['link', 'underline', 'bold', 'italic', 'strike', 'verbatim']
const rank = (m: Mark) => {
  const i = MARK_ORDER.indexOf(m.type.name)
  return i < 0 ? MARK_ORDER.length : i
}
const sortMarks = (marks: readonly Mark[]) => [...marks].sort((a, b) => rank(a) - rank(b))

const linkTarget = (href: string) =>
  /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href

function opening(m: Mark): string {
  switch (m.type.name) {
    case 'link':
      return '['
    case 'underline':
      return '<u>'
    case 'bold':
      return '**'
    case 'italic':
      return '*'
    case 'strike':
      return '~~'
    default:
      return ''
  }
}
function closing(m: Mark): string {
  switch (m.type.name) {
    case 'link':
      return `](${linkTarget(String(m.attrs.href ?? ''))})`
    case 'underline':
      return '</u>'
    default:
      return opening(m)
  }
}

/**
 * Written as typed: a wiki link, an embed, a footnote reference, a block ID. A name with a mark's
 * own characters in it (`*`, a backtick, `<`, `~`, `\`, or `_` at its edge) is not one, and is escaped.
 */
const KEPT_AS_WRITTEN =
  /(!?\[\[(?:[^\]\n`*<>\\~_]|(?<=[\p{L}\p{N}])_(?=[\p{L}\p{N}]))*\]\]|\[\^[\w-]+\]|\^blk-[\w-]+)/u
const WORD = /[\p{L}\p{N}]/u

/** Plain text with what would read as Markdown escaped. Text edges count as the middle of a word. */
function escapePlain(s: string, manyTildes: boolean): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    const prev = s[i - 1]
    const next = s[i + 1]
    if (c === '\\' || c === '`' || c === '[' || c === ']') out += `\\${c}`
    else if (c === '*') out += prev && next && /\s/.test(prev) && /\s/.test(next) ? c : '\\*'
    else if (c === '_') out += prev && next && WORD.test(prev) && WORD.test(next) ? c : '\\_'
    else if (c === '<') out += next && /[A-Za-z/!?]/.test(next) ? '\\<' : c
    else if (c === '~') out += manyTildes || !prev || !next ? '\\~' : c
    else if (c === '&') out += /^#?\w+;/.test(s.slice(i + 1)) ? '\\&' : c
    else out += c
  }
  return out
}

/** The start of a line that would turn into a heading, a list, a quote or a rule. */
function escapeLineStart(line: string): string {
  return (
    line
      .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
      .replace(/^([-+*])(?=\s|$)/, '\\$1')
      .replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
      .replace(/^(>)/, '\\$1')
      // A line that starts like a footnote's definition would read back as a kept block.
      .replace(/^(\[\^[\w-]+\]):/, '$1\\:')
      // A line of only equals or dashes under text makes a heading; dashes, colons and bars, a table.
      .replace(/^(=)(?=[= \t]*$)/, '\\$1')
      .replace(/^([ \t]*)(?=[|:\- \t]*-[|:\- \t]*$)([|:-])/, '$1\\$2')
  )
}

function escapeText(text: string, atLineStart: boolean, manyTildes: boolean): string {
  const escaped = text
    .split(KEPT_AS_WRITTEN)
    .map((part, i) => (i % 2 ? part : escapePlain(part, manyTildes)))
    .join('')
  return escaped
    .split('\n')
    .map((line, k) => (k > 0 || atLineStart ? escapeLineStart(line) : line))
    .join('\n')
}

interface Segment {
  text: string
  marks: Mark[]
  /** Written as is: a hard break, or text kept verbatim. */
  raw: boolean
  /** A hard break: how it is written depends on what comes before it. */
  br?: boolean
}

/** Leading and trailing ASCII punctuation. A backslash is punctuation, so an escape such as `\*` moves whole. */
const LEADING_PUNCTUATION = /^(?:[!-/:-@[-`{-~])+/
const TRAILING_PUNCTUATION = /[!-/:-@[-`{-~]+$/
/** A bare address: a backslash after it would be part of it. */
const ENDS_IN_ADDRESS = /(?:https?:\/\/|www\.)\S*$/

interface Open {
  mark: Mark
  /** Where its opening is in the output, and where what it holds begins. */
  at: number
  inside: number
}

/** The text of a paragraph or a heading: its marks as Markdown, its words escaped. */
export function renderInline(block: Node): string {
  const segments: Segment[] = []
  block.forEach((child) => {
    const marks = sortMarks(child.marks)
    if (child.isText)
      segments.push({
        text: child.text!,
        marks,
        raw: marks.some((m) => m.type.name === 'verbatim'),
      })
    else if (child.type.name === 'hardBreak')
      segments.push({ text: '', marks, raw: true, br: true })
  })
  // A break that ends a paragraph is no break (`\` there reads as a backslash).
  while (segments.at(-1)?.br) segments.pop()
  const inHeading = block.type.name === 'heading'

  // Two single tildes in one paragraph read as strikethrough, whatever lies between them.
  const manyTildes =
    segments.reduce((n, s) => n + (s.raw ? 0 : (s.text.match(/~/g)?.length ?? 0)), 0) > 1

  let out = ''
  let active: Open[] = []
  /** What was written last is plain text (not a delimiter or text kept as written). */
  let plainTail = false

  // A mark never ends in a space (`**bold **` is not bold): the space moves out. Nor does it end
  // in punctuation when a letter follows (`**hello.**She` is not bold either): that moves out
  // too. A mark that holds only spaces or punctuation is not written.
  const closeFrom = (k: number, next?: string) => {
    for (let j = active.length - 1; j >= k; j--) {
      const { mark, at, inside } = active[j]!
      const held = out.slice(inside)
      let moved = ''
      if (plainTail && next && WORD.test(next)) moved = TRAILING_PUNCTUATION.exec(held)?.[0] ?? ''
      if (!held.trim() || (moved && held.length === moved.length)) {
        out = out.slice(0, at) + held
        continue
      }
      const trailing = moved ? '' : (/[ \t]+$/.exec(held)?.[0] ?? '')
      out =
        out.slice(0, out.length - moved.length - trailing.length) + closing(mark) + moved + trailing
      plainTail = !!moved
    }
    active = active.slice(0, k)
  }

  for (const seg of segments) {
    let { text } = seg
    let want = seg.marks
    let k = 0
    while (k < active.length && k < want.length && active[k]!.mark.eq(want[k]!)) k++
    if (!seg.raw && !text.trim()) want = want.slice(0, k)
    closeFrom(k, seg.raw ? undefined : seg.text[0])
    for (let j = k; j < want.length; j++) {
      if (j === k && !seg.raw) {
        const lead = /^[ \t]+/.exec(text)?.[0] ?? ''
        out += lead
        text = text.slice(lead.length)
        // `a**"Hi"**` does not open a mark either: punctuation that follows a letter moves out.
        const punctuation = want[j]!.type.name !== 'link' && WORD.test(out.slice(-1))
        const outside = punctuation ? (LEADING_PUNCTUATION.exec(text)?.[0] ?? '') : ''
        out += escapeText(outside, false, manyTildes)
        text = text.slice(outside.length)
      }
      const mark = want[j]!
      active.push({ mark, at: out.length, inside: out.length + opening(mark).length })
      out += opening(mark)
    }
    if (seg.br) out += inHeading ? ' ' : ENDS_IN_ADDRESS.test(out) ? '  \n' : '\\\n'
    else out += seg.raw ? text : escapeText(text, out === '' || out.endsWith('\n'), manyTildes)
    plainTail = !seg.raw
  }
  closeFrom(0)
  return out
}

const LIST_TYPES = ['bulletList', 'orderedList', 'taskList']

/** A paragraph or heading with nothing in it has no Markdown; a block with text always has. */
export const isBlank = (node: Node) =>
  (node.type.name === 'paragraph' ||
    node.type.name === 'heading' ||
    node.type.name === 'rawBlock') &&
  node.content.size === 0

const prefixLines = (text: string, prefix: string) =>
  text
    .split('\n')
    .map((l) => (l ? prefix + l : prefix.trimEnd()))
    .join('\n')

/** The children of a quote, a callout or a list item, as Markdown separated by blank lines. */
function renderChildren(node: Node): string {
  const parts: string[] = []
  node.forEach((child) => {
    if (!isBlank(child)) parts.push(renderBlock(child))
  })
  return parts.join('\n\n')
}

function renderItem(item: Node): { text: string; spread: boolean } {
  const kids: Node[] = []
  item.forEach((child) => {
    if (!isBlank(child)) kids.push(child)
  })
  let text = ''
  let spread = false
  // The first block starts on the marker's line, whatever it is (`- # Heading`, `1. > quote`).
  kids.forEach((child, i) => {
    const part = renderBlock(child)
    if (i === 0) text = part
    else {
      // A list straight under its item stays tight; any other block needs a blank line.
      const tight = LIST_TYPES.includes(child.type.name)
      spread ||= !tight
      text += (tight ? '\n' : '\n\n') + part
    }
  })
  return { text, spread }
}

/** `marker`: the list's own `-`, `*` or `+`, or `.` or `)` after the number. */
function renderList(list: Node, marker?: string): string {
  const ordered = list.type.name === 'orderedList'
  const start = ordered ? Number(list.attrs.start ?? 1) : 1
  const parts: string[] = []
  // A list written with blank lines between its items stays that way.
  let spread = !!list.attrs.loose
  list.forEach((item, _offset, i) => {
    const mark = ordered ? `${start + i}${marker ?? '.'} ` : `${marker ?? '-'} `
    const box = item.type.name === 'taskItem' ? (item.attrs.checked ? '[x] ' : '[ ] ') : ''
    const body = renderItem(item)
    spread ||= body.spread
    const indent = ' '.repeat(mark.length)
    const lines = body.text.split('\n').map((l, k) => (k > 0 && l ? indent + l : l))
    parts.push((mark + box + lines.join('\n')).trimEnd())
  })
  return parts.join(spread ? '\n\n' : '\n')
}

/** The kinds of list that Markdown reads as one list when they follow each other with the same marker. */
export const LIST_FAMILY: Record<string, string> = {
  bulletList: 'bullet',
  taskList: 'bullet',
  orderedList: 'ordered',
}

/** The markers a list can use, the first being the usual one: another starts a new list. */
export const LIST_MARKERS: Record<string, string[]> = {
  bullet: ['-', '*', '+'],
  ordered: ['.', ')'],
}

/**
 * One block as Markdown, without the blank lines that follow it. `marker` is the list marker
 * chosen so that a list beside a list of its own family does not read back as one list.
 */
export function renderBlock(node: Node, marker?: string): string {
  switch (node.type.name) {
    case 'heading':
      // A heading is one line: a setext one that ran over two reads as a heading and a paragraph.
      return `${'#'.repeat(Number(node.attrs.level ?? 1))} ${renderInline(node).replace(/\n/g, ' ')}`
    case 'sceneBreak':
      return '* * *'
    case 'rawBlock':
      return node.textContent
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return renderList(node, marker)
    case 'blockquote':
      return prefixLines(renderChildren(node), '> ')
    case 'callout': {
      const title = String(node.attrs.title ?? '')
      const head = `> [!${node.attrs.kind}]${title ? ` ${title}` : ''}`
      const body = renderChildren(node)
      return body ? `${head}\n${prefixLines(body, '> ')}` : head
    }
    default:
      return renderInline(node)
  }
}
