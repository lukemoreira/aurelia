// SPDX-License-Identifier: AGPL-3.0-or-later
// Rename everywhere (ADR-0010 §6): find every place a record's name is written, say which are
// certain, and rewrite the texts the author ticked. Pure: nothing here reads or writes a file.
import type { Alias } from '@/domain/schema/record'
import { parseMarkdown } from '@/editor/markdown/parse'
import { parseLinks, type Range } from './links'
import {
  buildMatcher,
  findNames,
  ignoreKey,
  isCommonWord,
  nameRoles,
  shortForms,
  skipZones,
  startsSentence,
  type NameForm,
} from './names'
import { fold } from './palette-search'
import type { WorkspaceIndex } from './workspace-index'

/** One way the record is written, and what it becomes. `to === from` keeps it. */
export interface RenameForm {
  from: string
  to: string
}

export interface RenamePlace {
  /** Unique in the plan: the file and where in it. */
  key: string
  docId: string
  kind: 'scene' | 'record'
  /** "Book 1 · The Gate": where the file is. */
  where: string
  /** The book a scene (or a book's own notes) belongs to. */
  bookId?: string
  start: number
  end: number
  old: string
  next: string
  /** A few words either side, on one line. */
  before: string
  after: string
  /** Why the place is not ticked by itself, in the author's words. */
  uncertain?: string
  /** A shared name the file around it points to this record: ticked, with why, for the author to check. */
  guess?: string
}

export interface RenamePlan {
  forms: (RenameForm & { count: number })[]
  places: RenamePlace[]
  /** The text of every file with a place, as it was read: a file that differs now is refused. */
  bodies: Map<string, string>
}

/**
 * What each way of writing a record's name becomes when its title changes. Words that changed
 * one for one carry through ("Elena Vasquez" → "Helena Vasquez" makes "Elena" "Helena"); a form
 * that holds none of them is kept ("Lena", "Vasquez"). When the title gains or loses words, only
 * the title itself changes: the author edits the rest. A character's short forms are forms too
 * (ADR-0010, 2026-11-20), and a name word follows its role: the old first name becomes the new
 * first name ("Elena Vasquez" → "Helena Marie Vasquez" makes "Elena" "Helena").
 */
export function proposeForms(
  oldTitle: string,
  newTitle: string,
  aliases: readonly Alias[],
  character = false,
): RenameForm[] {
  const words = (t: string) => t.trim().split(/\s+/)
  const [from, to] = [words(oldTitle), words(newTitle)]
  const map = new Map<string, string>()
  if (from.length === to.length) from.forEach((w, i) => w !== to[i] && map.set(w, to[i]!))
  const role = new Map<string, string>()
  if (character) {
    const [a, b] = [nameRoles(oldTitle), nameRoles(newTitle)]
    const one = (x: (string | undefined)[], y: (string | undefined)[]) => {
      const [p, q] = [x.filter(Boolean), y.filter(Boolean)]
      if (p.length === 1 && q.length === 1 && !role.has(p[0]!)) role.set(p[0]!, q[0]!)
    }
    one(a.nicknames, b.nicknames)
    one([a.first], [b.first])
    one([a.last], [b.last])
  }
  const carry = (form: string) =>
    role.get(form) ??
    words(form)
      .map((w) => map.get(w) ?? w)
      .join(' ')
  const forms: RenameForm[] = [{ from: oldTitle.trim(), to: newTitle.trim() }]
  const add = (text: string) => {
    if (text && text !== oldTitle.trim() && !forms.some((f) => f.from === text))
      forms.push({ from: text, to: carry(text) })
  }
  for (const a of aliases) add(a.text.trim())
  if (character) shortForms(oldTitle).forEach(add)
  return forms
}

const CONTEXT = 36
/** The words around a place, trimmed to whole words, on one line. */
export function around(text: string, start: number, end: number) {
  const clean = (s: string) => s.replace(/\s+/g, ' ')
  let before = clean(text.slice(Math.max(0, start - CONTEXT), start))
  let after = clean(text.slice(end, end + CONTEXT))
  if (start > CONTEXT) before = `…${before.replace(/^\S*\s/, '')}`
  if (end + CONTEXT < text.length) after = `${after.replace(/\s\S*$/, '')}…`
  return { before, after }
}

/** The word is inside quotes that read as a title (“Elena of the Tides”), not as speech. */
function insideTitleQuote(text: string, start: number): boolean {
  const para = Math.max(text.lastIndexOf('\n', start), -1) + 1
  const curly = text.lastIndexOf('“', start)
  const straight = [...text.slice(para, start)].filter((c) => c === '"').length % 2 === 1
  let from = -1
  let to = -1
  if (curly >= para && curly > text.lastIndexOf('”', start)) {
    from = curly
    to = text.indexOf('”', start)
  } else if (straight) {
    from = text.lastIndexOf('"', start)
    to = text.indexOf('"', start)
  }
  if (from < 0 || to < 0) return false
  const span = text.slice(from + 1, to)
  if (/[,.!?;:—]/.test(span)) return false
  const words = span.trim().split(/\s+/)
  return words.length <= 8 && words.every((w) => w.length <= 3 || /^\p{Lu}/u.test(w))
}

/** One record's title, or the titles of several: "Elena Moreau", "Elena Moreau or Elena Marsh". */
const titles = (index: Pick<WorkspaceIndex, 'targetOf'>, ids: string[], join: string) =>
  ids.map((id) => index.targetOf(id)?.title ?? 'another record').join(join)

const REASON = {
  shared: 'Uncertain — another record has this name',
  ask: 'Uncertain — you asked to be asked about this name',
  'sentence-start': 'Uncertain — it may be an ordinary word',
} as const

/**
 * Every place the record's name is written, in reading order. `before` is how the record was named
 * when the author started (its names, not the new ones: the plan is made after the title is
 * saved, and the text still says the old name). Explicit links count: `[[Elena Vasquez]]` changes
 * its name, `[[id:chr_…|Elena]]` its label and never its ID. Plain-text names follow ADR-0010: a
 * tagged name is ticked, a suggestion or a title in quotes is not. A character's short forms
 * ("Elena" of "Elena Vasquez") are read too, by the rules the index reads them by; a short form
 * another character shares is a guess where the file names this record and not the other.
 */
export function planRename(
  index: Pick<WorkspaceIndex, 'documents' | 'formsFor' | 'resolveName' | 'scope' | 'targetOf'>,
  recordId: string,
  oldNames: { title: string; aliases: readonly Alias[] },
  forms: RenameForm[],
): RenamePlan {
  const changing = new Map(forms.map((f) => [fold(f.from), f] as const))
  const old: NameForm[] = [
    { recordId, text: oldNames.title, mode: 'auto' },
    ...oldNames.aliases.map((a): NameForm => ({ recordId, text: a.text, mode: a.match ?? 'auto' })),
  ]
  // The old title's short forms (ADR-0010, 2026-11-20): never one this record said never to.
  const off = new Set(oldNames.aliases.filter((a) => a.match === 'never').map((a) => fold(a.text)))
  const target = index.targetOf(recordId)
  const character = target?.recordType === 'character'
  const short = character ? shortForms(oldNames.title).filter((t) => !off.has(fold(t))) : []
  // The new title's own short forms: another character's same one is shared after the rename, not theirs.
  const fresh = new Set(character ? shortForms(target.title).filter((t) => !off.has(fold(t))) : [])
  const matchers = new Map<
    string,
    { matcher: ReturnType<typeof buildMatcher>; asked: Set<string>; taken: Set<string> }
  >()
  const places: RenamePlace[] = []
  const counts = new Map<string, number>()
  const bodies = new Map<string, string>()
  const home = index.scope(recordId)

  for (const doc of index.documents()) {
    // A name is only read where the record is seen from (ADR-0010 §2): a book's own record is
    // not renamed in another book, nor in a shared record's notes.
    if (home && !sees(doc.scope, home)) continue
    const raw = keptAsWritten(doc.body)
    const key = `${doc.scope.universe}|${doc.scope.book ?? ''}`
    let names = matchers.get(key)
    if (!names) {
      // The index is built after the rename: a short form the new title shares is asked there,
      // but here it is the other's alone (the matcher still finds a name two records share).
      const others = index
        .formsFor(doc.scope)
        .filter((f) => f.recordId !== recordId)
        .map((f) =>
          f.derived && f.mode === 'ask' && !isCommonWord(f.text)
            ? { ...f, mode: 'auto' as const }
            : f,
        )
      const explicit = [...others.filter((f) => !f.derived), ...old]
      // A short form that is any record's title or alias is left to that name.
      const taken = new Set(explicit.filter((f) => f.mode !== 'never').map((f) => f.text.trim()))
      const derived = short
        .filter((t) => !taken.has(t))
        .map((text): NameForm => ({ recordId, text, mode: isCommonWord(text) ? 'ask' : 'auto' }))
      names = {
        matcher: buildMatcher([...others, ...old, ...derived]),
        // Names the author asked to be asked about: never guessed, always asked.
        asked: new Set(explicit.filter((f) => f.mode === 'ask').map((f) => f.text.trim())),
        // Another record's names: a place renamed to one of them is never ticked.
        taken: new Set(
          others
            .filter((f) => f.mode !== 'never' && !(f.derived && fresh.has(f.text.trim())))
            .map((f) => f.text.trim()),
        ),
      }
      matchers.set(key, names)
    }
    const { matcher, asked } = names
    const kept = (at: number) => raw.some(([a, b]) => at >= a && at < b)
    const found: RenamePlace[] = []
    const add = (
      start: number,
      end: number,
      inLink: false | 'target' | 'label',
      uncertain?: string,
      guess?: string,
    ) => {
      // Raw HTML, fences, link definitions: kept as written, never rewritten.
      if (kept(start)) return
      const text = doc.body.slice(start, end)
      const form = changing.get(fold(text))
      counts.set(fold(text), (counts.get(fold(text)) ?? 0) + 1)
      if (!form || form.to === text) return
      // A name Markdown would read (`*`, `_`, `[`…) is written escaped in text; inside a link it cannot be.
      if (inLink && /[[\]|\\]/.test(form.to)) return
      // A link's label never changes what the link points to.
      if (inLink !== 'label' && names.taken.has(form.to.trim()))
        uncertain ??= `Uncertain — ${form.to.trim()} is also another record’s name`
      found.push({
        key: `${doc.id}:${start}`,
        docId: doc.id,
        kind: doc.kind,
        where: doc.where,
        start,
        end,
        old: text,
        next: inLink ? form.to : escapeMarkdown(form.to, atLineStart(doc.body, start)),
        ...(doc.scope.book ? { bookId: doc.scope.book } : {}),
        ...around(doc.body, start, end),
        ...(uncertain ? { uncertain } : guess ? { guess } : {}),
      })
    }

    const links = parseLinks(doc.body)
    const mentions = findNames(doc.body, matcher, skipZones(doc.body, links))
    // The records the file names for certain: an unshared name, or a link (this record also by an old name).
    // A record's notes name their own record. Nothing kept as written names anyone.
    const named = new Set<string>(doc.kind === 'record' ? [doc.id] : [])
    for (const m of mentions)
      if (m.status === 'tagged' && !kept(m.start) && !doc.ignore.has(ignoreKey(doc.body, m)))
        named.add(m.recordIds[0]!)
    for (const l of links) {
      if (kept(l.start)) continue
      const r = l.id !== undefined ? undefined : index.resolveName(l.target, doc.scope)
      if (l.id !== undefined) named.add(l.id)
      else if (r?.status === 'ok') named.add(r.target.id)
      else if (r?.status === 'missing' && old.some((f) => fold(f.text) === fold(l.target)))
        named.add(recordId)
    }
    const here = doc.kind === 'scene' ? 'this scene' : 'this note'
    /** A shared name: a guess where the file names this record and none of the others. */
    const shared = (m: (typeof mentions)[number]) => {
      const rest = m.recordIds.filter((r) => r !== recordId)
      const elsewhere = rest.filter((r) => named.has(r))
      if (named.has(recordId) && !elsewhere.length)
        return {
          guess: `Probably ${oldNames.title}: ${here} names ${oldNames.title}, not ${titles(index, rest, ' or ')}.`,
        }
      if (!named.has(recordId) && elsewhere.length)
        return { uncertain: `Uncertain — ${here} names ${titles(index, elsewhere, ' and ')}.` }
      return { uncertain: REASON.shared }
    }

    for (const l of links) {
      if (l.id !== undefined) {
        if (l.id !== recordId) continue
      } else {
        const r = index.resolveName(l.target, doc.scope)
        const ours = (r.status === 'ok' && r.target.id === recordId) || r.status === 'missing'
        if (!ours || !changing.has(fold(l.target))) continue
        if (r.status === 'missing' && !old.some((f) => fold(f.text) === fold(l.target))) continue
        add(l.targetAt[0], l.targetAt[1], 'target')
      }
      if (l.labelAt && l.label?.trim()) {
        const lead = l.label.length - l.label.trimStart().length
        add(l.labelAt[0] + lead, l.labelAt[0] + lead + l.label.trim().length, 'label')
      }
    }

    for (const m of mentions) {
      if (!m.recordIds.includes(recordId)) continue
      const answered = doc.ignore.has(ignoreKey(doc.body, m))
      // "Not a name" answered a question; a place that was a question stays out of the list. A real
      // name that now carries that answer's number is not counted as certain.
      if (answered && m.status === 'suggest') continue
      if (m.reason === 'shared') {
        const s = shared(m)
        const why =
          isCommonWord(m.text) && startsSentence(doc.body, m.start)
            ? REASON['sentence-start']
            : !s.guess
              ? s.uncertain
              : insideTitleQuote(doc.body, m.start)
                ? 'Uncertain — inside a title in quotes'
                : // An ordinary word, or a name the author asked about, is never guessed.
                  isCommonWord(m.text) || asked.has(m.text)
                  ? REASON.shared
                  : undefined
        add(m.start, m.end, false, why, s.guess)
        continue
      }
      const why =
        m.status === 'suggest'
          ? // A short form that is an ordinary word is asked, though the author never asked.
            REASON[m.reason === 'ask' && !asked.has(m.text) ? 'sentence-start' : m.reason!]
          : answered
            ? `Uncertain — you said an earlier “${m.text}” is not a name`
            : insideTitleQuote(doc.body, m.start)
              ? 'Uncertain — inside a title in quotes'
              : undefined
      add(m.start, m.end, false, why)
    }

    found.sort((a, b) => a.start - b.start)
    if (found.length) {
      places.push(...found)
      bodies.set(doc.id, doc.body)
    }
  }
  return {
    forms: forms.map((f) => ({ ...f, count: counts.get(fold(f.from)) ?? 0 })),
    places,
    bodies,
  }
}

/** Whether text in `doc` is read with the record that lives in `home`. */
const sees = (
  doc: { universe: string; book?: string },
  home: { universe: string; book?: string },
) => doc.universe === home.universe && (!home.book || doc.book === home.book)

/** Backslash-escape what Markdown would read in a name written into plain text; at a line's start, what would make it a heading or a list too. */
export function escapeMarkdown(name: string, lineStart = false): string {
  const out = name.replace(/[\\`*_~<>[\]|]/g, '\\$&').replace(/&(?=#?\w+;)/g, '\\&')
  return lineStart
    ? out.replace(/^(#{1,6}|[-+])(?=\s|$)/, '\\$1').replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
    : out
}

/** `at` is the first thing on its line or in a list item or quote on it (`- `, `1. `, `> `), where `#`, `-` or `1.` would start a block. */
export const atLineStart = (text: string, at: number) =>
  /^[ \t]{0,3}(?:(?:[-+*]|\d{1,9}[.)])[ \t]+|>[ \t]*)*$/.test(
    text.slice(text.lastIndexOf('\n', at - 1) + 1, at),
  )

/** Where the file keeps text as written: raw HTML, a fence or an indented code block, a link definition. A table's cells and a footnote's words are text like any other. */
export function keptAsWritten(body: string): Range[] {
  if (!/[<|`~]|\[\^|\]:|^(?: {4}|\t)/m.test(body)) return []
  const { blocks, exact } = parseMarkdown(body)
  if (!exact) return []
  const out: Range[] = []
  let at = 0
  for (const b of blocks) {
    if (b.json.type === 'rawBlock') out.push([at, at + b.src.length])
    at += b.src.length
  }
  return out
}

/** Places by where they are, in reading order. */
export function groupPlaces(places: RenamePlace[]) {
  const out: { where: string; places: RenamePlace[] }[] = []
  for (const p of places) {
    const last = out.at(-1)
    if (last?.where === p.where) last.places.push(p)
    else out.push({ where: p.where, places: [p] })
  }
  return out
}

/** Places ticked by default: every one that is certain, and every guess. */
export const certainPlaces = (plan: RenamePlan) =>
  new Set(plan.places.filter((p) => !p.uncertain).map((p) => p.key))

/** A text with some places rewritten. Throws if the text is no longer the one the places were found in. */
export function applyPlaces(body: string, places: RenamePlace[]): string {
  let out = body
  for (const p of [...places].sort((a, b) => b.start - a.start)) {
    if (out.slice(p.start, p.end) !== p.old)
      throw new Error('The text changed since the places were found.')
    out = out.slice(0, p.start) + p.next + out.slice(p.end)
  }
  return out
}

/** The files to change, each with its new text: the plan's places that are ticked, grouped by file. */
export function rewrites(plan: RenamePlan, ticked: ReadonlySet<string>) {
  const byDoc = new Map<string, RenamePlace[]>()
  for (const p of plan.places)
    if (ticked.has(p.key)) byDoc.set(p.docId, [...(byDoc.get(p.docId) ?? []), p])
  return [...byDoc].map(([docId, places]) => {
    const before = plan.bodies.get(docId)!
    return {
      docId,
      kind: places[0]!.kind,
      before,
      after: applyPlaces(before, places),
      count: places.length,
    }
  })
}

/** The record's other names after the rename: each changed form takes its new text, the rest stay. */
export function renamedAliases(aliases: readonly Alias[], forms: RenameForm[]): Alias[] {
  const to = new Map(forms.map((f) => [f.from, f.to] as const))
  return aliases.map((a) => ({ ...a, text: to.get(a.text.trim())?.trim() || a.text }))
}
