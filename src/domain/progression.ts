// SPDX-License-Identifier: AGPL-3.0-or-later
// A character's progression (ADR-0006 §2, M6b): where they are on the page chapter by chapter, and every
// change recorded about them in reading order. The state at a scene is `stateRows`; this adds the table
// and the log around it. Reads any model — one book's, or the books of a universe end to end. Plain TS.
import { CHANGE_LABEL, changeText, type Change, type ChangeKind } from './change-kinds'
import type { ContinuityModel } from './continuity'

export interface ProgressionScene {
  id: string
  /** "11.2", and in a universe the book first: "Saltmarch · 11.2". */
  ref: string
  /** "11.2 · The Customs Stair" (with the book first in a universe). */
  name: string
  /** On the page (named, linked or added), not only spoken of. */
  present: boolean
}

export interface ProgressionChapter {
  key: string
  /** "Chapter 11", or "Unfiled scenes". */
  label: string
  title: string
  /** The book (and part) it is in, when it has them. */
  part?: string
  scenes: number
  words: number
  pov: boolean
  changes: number
  /** The last scene of the chapter: where the scrubber goes to see the state at its end. */
  last?: string
  /** Its scenes' places in reading order, first to last (empty chapter: first is after last). */
  first: number
  end: number
  /** The row in words, for the table's text and the list. */
  text: string
}

export interface LogEntry {
  /** Place in reading order: the scrubber's number for this scene. */
  at: number
  scene: string
  ref: string
  sceneTitle: string
  kind: string
  text: string
}

export interface Progression {
  scenes: ProgressionScene[]
  chapters: ProgressionChapter[]
  log: LogEntry[]
  /** Where the scrubber starts: the last scene they are on the page in. */
  start: number
}

/** The kinds that belong to a person; a beat, a set-up and a pay-off are about the story. */
const ABOUT_PEOPLE: ReadonlySet<string> = new Set<ChangeKind>([
  'status',
  'condition',
  'location',
  'knows',
  'relation',
  'holds',
  'loses',
  'trait',
  'goal',
])

/** A change is about someone when it is theirs, or when another person's relationship points at them. */
export const aboutPerson = (c: Change, who: string) =>
  ABOUT_PEOPLE.has(c.kind) && (c.who === who || (c.kind === 'relation' && c.with === who))

const n = (count: number, word: string) =>
  `${count.toLocaleString('en')} ${word}${count === 1 ? '' : 's'}`

/** `withBook`: the books of a universe are read together, so every place names its book ("Saltmarch · 1.2"). */
export function progression(m: ContinuityModel, who: string, withBook = false): Progression {
  const bookOf = (id: string) => m.data.books.find((b) => b.id === id)?.title ?? 'Untitled book'
  const place = (book: string, text: string) => (withBook ? `${bookOf(book)} · ${text}` : text)
  const scenes: ProgressionScene[] = []
  const log: LogEntry[] = []
  let start = Math.max(0, m.scenes.length - 1)
  let last = -1
  for (const s of m.scenes) {
    const present = m.presence.get(s.id)?.present.has(who) ?? false
    scenes.push({
      id: s.id,
      ref: place(s.book, s.ref),
      name: place(s.book, m.sceneName(s.id)),
      present,
    })
    if (present) last = s.index
    for (const c of m.changes(s.id))
      if (aboutPerson(c, who))
        log.push({
          at: s.index,
          scene: s.id,
          ref: place(s.book, s.ref),
          sceneTitle: s.title,
          kind: CHANGE_LABEL[c.kind as ChangeKind],
          text: changeText(c, (id) => (id ? m.nameOf(id) : '')),
        })
  }
  if (last >= 0) start = last
  const changesIn = new Map<string, number>()
  for (const e of log) changesIn.set(e.scene, (changesIn.get(e.scene) ?? 0) + 1)
  const chapters = m.chapters.map((c, i): ProgressionChapter => {
    const here = c.scenes.filter((s) => m.presence.get(s.id)?.present.has(who))
    const words = here.reduce((sum, s) => sum + s.doc.words, 0)
    const pov = c.scenes.some((s) => m.presence.get(s.id)?.pov === who)
    const changes = c.scenes.reduce((sum, s) => sum + (changesIn.get(s.id) ?? 0), 0)
    // a merged chapter's part is headed by its book, which the label says already
    const book = bookOf(c.book)
    const part =
      withBook && c.part?.startsWith(book) ? c.part.slice(book.length).replace(/^ · /, '') : c.part
    const label = place(c.book, c.id ? `Chapter ${c.number}` : 'Unfiled scenes')
    const last = c.scenes.at(-1)?.id
    return {
      key: c.id || `unfiled-${i}`,
      label,
      title: c.title,
      // the part and the book it is in; in a universe the label already says the book
      ...(part ? { part } : {}),
      scenes: here.length,
      words,
      pov,
      changes,
      ...(last ? { last } : {}),
      first: c.scenes[0]?.index ?? 0,
      end: c.scenes.at(-1)?.index ?? -1,
      text: here.length
        ? [
            n(here.length, 'scene'),
            n(words, 'word'),
            pov ? 'point of view' : '',
            changes ? n(changes, 'change') : '',
          ]
            .filter(Boolean)
            .join(', ')
        : changes
          ? `Not on the page, ${n(changes, 'change')}`
          : 'Not on the page',
    }
  })
  return { scenes, chapters, log, start }
}

/** "Shows on Tomas Brandt’s and Elena Vasquez’s progression.": whose Progression tab a change lands on. */
export function showsOn(
  c: Change,
  name: (id: string) => string,
  isPerson: (id: string) => boolean,
): string {
  const ids = [c.who, c.kind === 'relation' ? c.with : undefined].filter(
    (id, i, all): id is string => !!id && isPerson(id) && all.indexOf(id) === i,
  )
  if (!ids.length || !ABOUT_PEOPLE.has(c.kind)) return ''
  const first = ids.map((id) => `${name(id)}’s`)
  return `Shows on ${first.join(' and ')} progression.`
}
