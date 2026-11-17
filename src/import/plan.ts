// SPDX-License-Identifier: AGPL-3.0-or-later
// What an import will make, before it makes anything (ADR-0014): a new book as plain data, and the
// report of what could not be read. Reading a file never writes; only the plan's files are written.
import { freshKeys } from '@/domain/order'
import { countWords } from '@/domain/prose'
import { CURRENT_SCHEMA_VERSION } from '@/domain/schema/common'
import { checkTitle, MAX_TITLE } from '@/domain/titles'
import { newHead } from '@/storage/frontmatter'
import { bookPath, chapterPath, scenePath } from '@/storage/paths'
import { newSceneText } from '@/storage/scene-file'
import type { Scene } from '@/domain/schema/scene'

/** A line of the report: what happened, and which files, passages or names it is about. */
export interface ReportItem {
  text: string
  names: string[]
}

export interface Report {
  /** What could not be read, each with the reason. */
  unread: ReportItem[]
  /** What was read, but not the way the author may expect. */
  notes: ReportItem[]
}

export const emptyReport = (): Report => ({ unread: [], notes: [] })

/** Where each line of a report is, with the names under it, so adding one is not a search of the rest (a story can have 20,000 links). */
const seen = new WeakMap<ReportItem[], Map<string, { item: ReportItem; names: Set<string> }>>()

/** Add a name under a line of the report: the same words are one line with a list of names. */
export function report(list: ReportItem[], text: string, name?: string) {
  let lines = seen.get(list)
  if (!lines) seen.set(list, (lines = new Map()))
  let line = lines.get(text)
  if (!line) {
    const item = { text, names: [] }
    list.push(item)
    lines.set(text, (line = { item, names: new Set() }))
  }
  if (name !== undefined && !line.names.has(name)) {
    line.names.add(name)
    line.item.names.push(name)
  }
}

export interface PlanScene {
  /** Names the scene inside the plan (a choice's target); never written. */
  key: string
  title: string
  body: string
  choices: { label: string; target: string }[]
  ending?: boolean
}

export interface PlanChapter {
  title: string
  scenes: PlanScene[]
}

export interface ImportPlan {
  source: 'markdown' | 'twine'
  title: string
  mode: 'linear' | 'branching'
  chapters: PlanChapter[]
  /** The key of the scene a reader starts in (a branching book). */
  start?: string
  report: Report
}

/** The title a book, chapter or scene can have: trimmed, without hidden characters, not too long. */
export function titleOf(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE)
    .trim()
  return checkTitle(cleaned).ok ? cleaned : fallback
}

export function planStats(plan: ImportPlan) {
  const scenes = plan.chapters.flatMap((c) => c.scenes)
  return {
    chapters: plan.chapters.length,
    scenes: scenes.length,
    choices: scenes.reduce((n, s) => n + s.choices.length, 0),
    words: scenes.reduce((n, s) => n + countWords(s.body), 0),
  }
}

/** The IDs a plan's files are made with. */
export interface PlanIds {
  universe: string
  book: string
  chapters: string[]
  /** Scene IDs by the plan's keys. */
  scenes: Map<string, string>
  /** A choice's ID, for scene key and position. */
  choice: (sceneKey: string, n: number) => string
}

/** IDs for everything a plan makes. `fresh` hands out IDs nothing else has (the session's, or a new folder's). */
export function planIds(
  plan: ImportPlan,
  universe: string,
  fresh: (prefix: 'bok' | 'chp' | 'scn' | 'chc') => string,
): PlanIds {
  const scenes = new Map<string, string>()
  const choices = new Map<string, string>()
  for (const chapter of plan.chapters)
    for (const scene of chapter.scenes) {
      scenes.set(scene.key, fresh('scn'))
      scene.choices.forEach((_, n) => choices.set(`${scene.key}:${n}`, fresh('chc')))
    }
  return {
    universe,
    book: fresh('bok'),
    chapters: plan.chapters.map(() => fresh('chp')),
    scenes,
    choice: (key, n) => choices.get(`${key}:${n}`)!,
  }
}

const V = CURRENT_SCHEMA_VERSION
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

/**
 * The book's files, content first (the book's own file, its chapters, its scenes): what points at
 * them (the universe's list of books) is written after, by the caller, so a stop leaves a book
 * that is shown, never one that is hidden. `book.json` starts with an empty outline cache, which the
 * caller's outline sync fills.
 */
export function planFiles(plan: ImportPlan, ids: PlanIds): { path: string; text: string }[] {
  const chapterKeys = freshKeys(plan.chapters.length)
  const files = [
    {
      path: bookPath(ids.universe, ids.book),
      text: json({
        title: plan.title,
        schemaVersion: V,
        id: ids.book,
        mode: plan.mode,
        ...(plan.start && ids.scenes.get(plan.start) ? { start: ids.scenes.get(plan.start) } : {}),
        outline: [],
      }),
    },
  ]
  plan.chapters.forEach((chapter, i) => {
    const id = ids.chapters[i]!
    files.push({
      path: chapterPath(ids.universe, ids.book, id),
      text: newHead({
        title: chapter.title,
        schemaVersion: V,
        id,
        book: ids.book,
        order: chapterKeys[i]!,
      }),
    })
  })
  plan.chapters.forEach((chapter, i) => {
    const keys = freshKeys(chapter.scenes.length)
    chapter.scenes.forEach((scene, j) => {
      const id = ids.scenes.get(scene.key)!
      const choices = scene.choices.flatMap((c, n) => {
        const target = ids.scenes.get(c.target)
        return target ? [{ id: ids.choice(scene.key, n), label: c.label, target }] : []
      })
      const meta: Scene = {
        title: scene.title,
        schemaVersion: V,
        id,
        chapter: ids.chapters[i]!,
        order: keys[j]!,
        ...(scene.ending ? { ending: true } : {}),
        ...(choices.length ? { choices } : {}),
      }
      files.push({
        path: scenePath(ids.universe, ids.book, id),
        text: newSceneText(meta, scene.body),
      })
    })
  })
  return files
}
