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
function escapeLineStart(whole: string): string {
  // Spaces before it do not change what it is.
  const [, space = '', line = ''] = /^([ \t]*)([\s\S]*)$/.exec(whole) ?? []
  return (
    space +
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

/** Leading and trailing punctuation and symbols (an emoji counts). A backslash is punctuation, so an escape such as `\*` moves whole. */
const LEADING_PUNCTUATION = /^[\p{P}\p{S}]+/u
const TRAILING_PUNCTUATION = /[\p{P}\p{S}]+$/u
/** The HTML block starts that can interrupt a paragraph (CommonMark's kinds 1 to 6). */
const INTERRUPTING_HTML = new RegExp(
  '^<(?:(?:script|pre|style|textarea)(?:\\s|>|$)|!--|\\?|![A-Za-z]|!\\[CDATA\\[|/?(?:' +
    'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|' +
    'dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|' +
    'header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|' +
    'param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul' +
    ')(?:\\s|/?>|$))',
  'i',
)
/** A tag that is all of its line (CommonMark's kind 7: it starts an HTML block, but cannot interrupt a paragraph). */
const TAG_ALONE = /^<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>[ \t]*$/
const startsHtmlBlock = (text: string, after: Segment[]) =>
  INTERRUPTING_HTML.test(text) ||
  (TAG_ALONE.test(text) &&
    // Only spaces, then the end of the line (or of the paragraph), follow it.
    /^[ \t]*(\n|$)/.test(after.map((s) => (s.raw ? '\0' : s.text)).join('')))
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
  // `<u>` and `</u>` written as text would pair up into an underline: they are escaped.
  const tags = segments.filter((s) => s.raw && /^<\/?u>$/.test(s.text))
  if (
    tags.length &&
    (segments.some((s) => s.marks.some((m) => m.type.name === 'underline')) ||
      (tags.some((s) => s.text === '<u>') && tags.some((s) => s.text === '</u>')))
  )
    for (const s of tags) s.raw = false
  // A break that ends a paragraph is no break (`\` there reads as a backslash).
  // Nor is one at its start, or one with only spaces after it.
  const blank = (s?: Segment) => !!s && (s.br || (!s.raw && !s.text.trim()))
  while (blank(segments[0])) segments.shift()
  while (blank(segments.at(-1))) segments.pop()
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
      const rest = held.slice(0, held.length - moved.length)
      if (!rest.trim()) {
        out = out.slice(0, at) + held
        continue
      }
      const trailing = /\s+$/.exec(rest)?.[0] ?? ''
      // A `*` that stood between spaces was left as it is; with the space gone it would join the closing one.
      if (trailing) {
        const star = out.length - moved.length - trailing.length - 1
        if (out[star] === '*' && /\s/.test(out[star - 1] ?? ''))
          out = out.slice(0, star) + '\\*' + out.slice(star + 1)
      }
      out =
        out.slice(0, out.length - moved.length - trailing.length) + closing(mark) + trailing + moved
      plainTail = !!moved
    }
    active = active.slice(0, k)
  }

  for (const [n, seg] of segments.entries()) {
    // A tag kept as written that opens the paragraph and starts an HTML block would end it
    // there: it is written as text instead (escaped, the same words).
    if (seg.raw && !seg.br && out === '' && startsHtmlBlock(seg.text, segments.slice(n + 1)))
      seg.raw = false
    let { text } = seg
    // Spaces at the start of a block are dropped by Markdown, and written first they would make
    // an indented code block or move an item out of its list.
    if (out === '' && !seg.raw) text = text.replace(/^\s+/, '')
    // What follows a line break in the text is not a blank line: that would end the paragraph.
    else if (!seg.raw && /\n[ \t]*$/.test(out)) text = text.replace(/^\s+/, '')
    let want = seg.marks
    let k = 0
    while (k < active.length && k < want.length && active[k]!.mark.eq(want[k]!)) k++
    if (!seg.raw && !text.trim()) want = want.slice(0, k)
    closeFrom(k, seg.raw ? undefined : seg.text[0])
    // Text kept as written cannot move its punctuation out of a mark, and `a*<b>*` is no emphasis:
    // straight after a letter, such a mark is not written.
    if (
      seg.raw &&
      !seg.br &&
      want.length > k &&
      WORD.test(out.slice(-1)) &&
      /^[\p{P}\p{S}]/u.test(text)
    )
      want = want.slice(0, k)
    for (let j = k; j < want.length; j++) {
      if (j === k && !seg.raw) {
        const lead = /^\s+/.exec(text)?.[0] ?? ''
        out += lead
        text = text.slice(lead.length)
        // `a**"Hi"**` does not open a mark either: punctuation that follows a letter moves out.
        const punctuation = want[j]!.type.name !== 'link' && WORD.test(out.slice(-1))
        let outside = punctuation ? (LEADING_PUNCTUATION.exec(text)?.[0] ?? '') : ''
        // The spaces after what moved out are not the mark's either: it must not open on one.
        if (outside) outside += /^[ \t]*/.exec(text.slice(outside.length))![0]
        out += escapeText(outside, false, manyTildes)
        text = text.slice(outside.length)
      }
      const mark = want[j]!
      active.push({ mark, at: out.length, inside: out.length + opening(mark).length })
      out += opening(mark)
    }
    if (seg.br) out += inHeading ? ' ' : ENDS_IN_ADDRESS.test(out) ? '  \n' : '\\\n'
    else if (seg.raw) {
      // A tag that opens a line can start an HTML block and end the paragraph; indented four
      // spaces it stays a line of it (the spaces are not part of the line's text).
      // A line of it that would start a heading, a list or a quote is indented the same way.
      const lines = text
        .split('\n')
        .map((l, k) => (k > 0 && /^ {0,3}\S/.test(l) && escapeLineStart(l) !== l ? `    ${l}` : l))
        .join('\n')
      out +=
        (/\n[ \t]{0,3}$/.test(out) && startsHtmlBlock(text, segments.slice(n + 1)) ? '    ' : '') +
        lines
    } else if (text.startsWith(':') && /(^|\n)\[\^[\w-]+\]$/.test(out)) {
      // `[^1]` kept as written, then a colon, at the start of a line: a footnote's definition.
      out += `\\:${escapeText(text.slice(1), false, manyTildes)}`
    } else if (ENDS_IN_ADDRESS.test(out)) {
      // Straight after a bare address a backslash is part of the address: its run is not escaped.
      const run = /^\S*/.exec(text)![0]
      out += run + escapeText(text.slice(run.length), false, manyTildes)
    } else out += escapeText(text, /(^|\n)[ \t]*$/.test(out), manyTildes)
    plainTail = !seg.raw
  }
  closeFrom(0)
  out = out.replace(/\n+$/, '')
  if (inHeading) out = out.replace(/[ \t]+$/, '')
  // A closing run of `#` after a space is a heading's own closing sequence, not its text.
  return inHeading ? out.replace(/(^|[ \t])(#+)$/, '$1\\$2') : out
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

/** The kind of a list and the marker it was written with. */
interface ListMarker {
  family: string
  marker: string
}
/** Lists that follow each other must not read as one: the marker of a list straight after `before`, when it must differ. */
const markerBeside = (child: Node, before?: ListMarker) => {
  const family = LIST_FAMILY[child.type.name]
  return family && before?.family === family
    ? LIST_MARKERS[family]!.find((m) => m !== before.marker)
    : undefined
}
const markerUsed = (child: Node, chosen?: string): ListMarker | undefined => {
  const family = LIST_FAMILY[child.type.name]
  return family ? { family, marker: chosen ?? LIST_MARKERS[family]![0]! } : undefined
}

/** The children of a quote, a callout or a list item, as Markdown separated by blank lines. */
function renderChildren(node: Node): string {
  const parts: string[] = []
  let before: ListMarker | undefined
  node.forEach((child) => {
    if (isBlank(child)) return
    const chosen = markerBeside(child, before)
    parts.push(renderBlock(child, chosen))
    before = markerUsed(child, chosen)
  })
  return parts.join('\n\n')
}

/** A list that can start straight under a paragraph, without a blank line between. */
function interruptsParagraph(list: Node): boolean {
  let filled = false
  list.firstChild?.forEach((c) => {
    if (!isBlank(c)) filled = true
  })
  // An empty item, or a number but 1, cannot interrupt a paragraph: it would be a line of it.
  return filled && (list.type.name !== 'orderedList' || Number(list.attrs.start ?? 1) === 1)
}

function renderItem(item: Node, marker = '-'): { text: string; spread: boolean } {
  const kids: Node[] = []
  item.forEach((child) => {
    if (!isBlank(child)) kids.push(child)
  })
  let text = ''
  let spread = false
  // The first block starts on the marker's line, whatever it is (`- # Heading`, `1. > quote`).
  let before: ListMarker | undefined
  kids.forEach((child, i) => {
    const family = LIST_FAMILY[child.type.name]
    // Lists that follow each other in an item must not read as one list: another marker.
    let chosen = markerBeside(child, before)
    // `- * * *` is one rule and no item: a break that opens an item is written with underscores,
    // and a bullet list that opens one takes another marker (`- - -` is a rule too).
    let part = i === 0 && child.type.name === 'sceneBreak' ? '___' : renderBlock(child, chosen)
    if (
      i === 0 &&
      family === 'bullet' &&
      /^([-*])\1{2,}$/.test(`${marker} ${part.split('\n')[0]}`.replace(/ /g, ''))
    ) {
      chosen = marker === '-' ? '*' : '-'
      part = renderBlock(child, chosen)
    }
    before = markerUsed(child, chosen)
    if (i === 0) text = part
    else {
      // A list straight under its item's paragraph stays tight; any other block needs a blank line.
      const tight =
        LIST_TYPES.includes(child.type.name) &&
        interruptsParagraph(child) &&
        kids[i - 1]!.type.name === 'paragraph' &&
        // `- |` under a line of text is the row that makes it a table.
        !/^[\s|:-]+$/.test(part.split('\n')[0]!)
      spread ||= !tight
      text += (tight ? '\n' : '\n\n') + part
    }
  })
  return { text, spread }
}

/** `marker`: the list's own `-`, `*` or `+`, or `.` or `)` after the number. */
/** How a list's first item was laid out in the file: its indent, and where its text began. */
export interface ListShape {
  indent: number
  width: number
}

function renderList(list: Node, marker?: string, shape?: ListShape): string {
  const ordered = list.type.name === 'orderedList'
  const start = ordered ? Number(list.attrs.start ?? 1) : 1
  const parts: string[] = []
  // A list written with blank lines between its items stays that way.
  let spread = !!list.attrs.loose
  list.forEach((item, _offset, i) => {
    const mark = ordered ? `${start + i}${marker ?? '.'}` : `${marker ?? '-'}`
    // Written with the item's old indent and gap, so the text after it (kept as read, and
    // indented to match) is still outside the item that it was outside of.
    const first = ' '.repeat(shape?.indent ?? 0) + mark
    const prefix = first + ' '.repeat(Math.max(1, (shape?.width ?? 0) - first.length))
    const box = item.type.name === 'taskItem' ? (item.attrs.checked ? '[x] ' : '[ ] ') : ''
    const body = renderItem(item, ordered ? undefined : (marker ?? '-'))
    spread ||= body.spread
    const indent = ' '.repeat(prefix.length)
    const lines = body.text.split('\n').map((l, k) => (k > 0 && l ? indent + l : l))
    parts.push((prefix + box + lines.join('\n')).trimEnd())
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
export function renderBlock(node: Node, marker?: string, shape?: ListShape): string {
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
      return renderList(node, marker, shape)
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
