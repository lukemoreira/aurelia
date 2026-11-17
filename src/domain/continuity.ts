// SPDX-License-Identifier: AGPL-3.0-or-later
// A book read for continuity (ADR-0006): its scenes in reading order, who is on the page where,
// and the state of the story at every scene. The checks and the Continuity view read this one
// model. Plain TS: the index hands in what the texts name, so Node can run the same code (ADR-0008).
import { bookOutline, bookUnfiled, UNFILED } from './outline'
import type { Change } from './change-kinds'
import { join, runFlow, type Flow, type State } from './continuity-state'
import type { SceneDoc, WorkspaceData } from './workspace-data'
import type { Calendar } from './schema/universe'
import { spanOf, type Span } from './story-time'
import { storyGraph, type StoryGraph } from './story-graph'

/** What the texts say, which only the index can read. */
export interface ContinuityInput {
  data: WorkspaceData
  bookId: string
  /** The records a scene's text names, by tagged name or `[[link]]` (ADR-0010). */
  named: (sceneId: string) => readonly string[]
  /** Links in a scene's text that point nowhere, or at more than one thing. */
  brokenLinks: (sceneId: string) => readonly { text: string; status: 'missing' | 'ambiguous' }[]
}

export interface SceneInfo {
  id: string
  doc: SceneDoc
  /** The book it is in. */
  book: string
  title: string
  /** "7.2": chapter number, then the place in the chapter. */
  ref: string
  /** Position in reading (outline) order. */
  index: number
  /** Position of its chapter among the book's chapters. */
  chapter: number
  /** In story time marked as before the story's present or after it: out of reading order on purpose. */
  offBeat: boolean
  span?: Span
}

export interface ChapterInfo {
  /** The book it is in. */
  book: string
  /** Empty for the scenes of no chapter, shown together as "Unfiled". */
  id: string
  title: string
  number: number
  /** The title of the part it is in, when the book has parts. */
  part?: string
  scenes: SceneInfo[]
  words: number
  target?: number
}

export interface Presence {
  pov?: string
  /** On the page: named in the text or added by the author, and not unticked. */
  present: ReadonlySet<string>
  /** Named in the text, but the author unticked them: spoken of, not there. */
  mentioned: ReadonlySet<string>
}

export interface ContinuityModel {
  input: ContinuityInput
  data: WorkspaceData
  bookId: string
  scenes: SceneInfo[]
  byId: ReadonlyMap<string, SceneInfo>
  chapters: ChapterInfo[]
  /** How many of `chapters` are real chapters: the "Unfiled" stand-in, when there is one, comes after them. */
  chapterCount: number
  /** Only for a branching book: the scene graph the flow runs over. */
  graph: StoryGraph | undefined
  presence: ReadonlyMap<string, Presence>
  flow: Flow
  /** The characters of this book: its universe's, and its own. */
  characters: ReadonlyMap<string, string>
  calendars: Calendar[]
  nameOf: (id: string) => string
  /** "7.2 · Curfew Bells" */
  sceneName: (id: string) => string
  changes: (sceneId: string) => readonly Change[]
}

/** Where a book of a universe begins: what is true at the end of the one before it. */
export interface BookStart {
  state: State
  /** What a scene of an earlier book is called, for a finding that points back at it. */
  sceneName: (id: string) => string | undefined
}

export function continuityModel(input: ContinuityInput, start?: BookStart): ContinuityModel {
  const { data, bookId } = input
  const book = data.books.find((b) => b.id === bookId)
  const universe = data.universes.find((u) => u.books.includes(bookId))

  // Chapters and scenes in reading order. Scenes of no chapter are kept, as one "Unfiled" chapter.
  const chapters: ChapterInfo[] = []
  const scenes: SceneInfo[] = []
  const add = (
    id: string,
    title: string,
    number: number,
    docs: SceneDoc[],
    target?: number,
    part?: string,
  ) => {
    const chapter = chapters.length
    const info: ChapterInfo = {
      book: bookId,
      id,
      title,
      number,
      scenes: [],
      words: docs.reduce((n, s) => n + s.words, 0),
      ...(target ? { target } : {}),
      ...(part ? { part } : {}),
    }
    docs.forEach((doc, i) => {
      const span = doc.meta.time ? spanOf(doc.meta.time) : undefined
      const scene: SceneInfo = {
        id: doc.meta.id,
        doc,
        book: bookId,
        title: doc.meta.title,
        ref: number === 0 ? String(i + 1) : `${number}.${i + 1}`,
        index: scenes.length,
        chapter,
        offBeat: doc.meta.flashback === true || doc.meta.flashForward === true,
        ...(span ? { span } : {}),
      }
      scenes.push(scene)
      info.scenes.push(scene)
    })
    chapters.push(info)
  }
  for (const group of bookOutline(data, bookId))
    for (const c of group.chapters)
      add(c.chapter.id, c.chapter.title, c.number, c.scenes, c.chapter.target, group.part?.title)
  const unfiled = bookUnfiled(data, bookId)
  if (unfiled.length) add('', UNFILED, 0, unfiled)
  const byId = new Map(scenes.map((s) => [s.id, s]))

  // Characters this book can see: shared by its universe, or its own.
  const characters = new Map<string, string>()
  for (const r of data.records)
    if (
      r.meta.type === 'character' &&
      (r.meta.scope === 'universe'
        ? r.universe === universe?.id
        : r.meta.scope === `book:${bookId}`)
    )
      characters.set(r.meta.id, r.meta.title)

  const presence = new Map<string, Presence>()
  for (const s of scenes) {
    const meta = s.doc.meta
    const removed = new Set(meta.characters?.remove ?? [])
    const named = input.named(s.id).filter((id) => characters.has(id))
    const pov = meta.pov && characters.has(meta.pov) ? meta.pov : undefined
    const wanted = [...named, ...(meta.characters?.add ?? []).filter((id) => characters.has(id))]
    const present = new Set(wanted.filter((id) => !removed.has(id) || id === pov))
    if (pov) present.add(pov)
    presence.set(s.id, {
      ...(pov ? { pov } : {}),
      present,
      mentioned: new Set(named.filter((id) => !present.has(id))),
    })
  }

  // The flow: a straight book reads in outline order; a branching one by its choices.
  const graph = book?.mode === 'branching' ? storyGraph(data, bookId) : undefined
  const order = scenes.map((s) => s.id)
  const preds = new Map<string, string[]>()
  const entries = new Set<string>()
  if (graph) {
    const out = new Map<string, string[]>()
    for (const e of graph.edges)
      if (!e.broken) {
        preds.set(e.target, [...(preds.get(e.target) ?? []), e.from])
        out.set(e.from, [...(out.get(e.from) ?? []), e.target])
      }
    // A scene a reader can get to hears only from scenes a reader can get to: what an orphan scene
    // does is not something that has happened on a path from the start.
    for (const [id, ps] of preds)
      if (graph.reachable.has(id))
        preds.set(
          id,
          ps.filter((p) => graph.reachable.has(p)),
        )
    if (graph.start) entries.add(graph.start)
    // Scenes nobody leads to start from where the book starts (the empty state, or in a universe the end of the book before), so they are still checked: first those with no
    // way in at all, then (for a loop nothing leads into) the first scene of each that is left.
    const covered = new Set(graph.reachable)
    const cover = (from: string) => {
      const queue = [from]
      covered.add(from)
      for (let i = 0; i < queue.length; i++)
        for (const n of out.get(queue[i]!) ?? [])
          if (!covered.has(n)) {
            covered.add(n)
            queue.push(n)
          }
    }
    const begin = (id: string) => {
      entries.add(id)
      cover(id)
    }
    for (const id of order) if (!covered.has(id) && !preds.get(id)?.length) begin(id)
    for (const id of order) if (!covered.has(id)) begin(id)
  } else {
    // A straight book reads chapter by chapter; scenes of no chapter are not part of that chain.
    const chain = scenes.filter((s) => chapters[s.chapter]!.id)
    chain.forEach((s, i) => {
      if (i === 0) entries.add(s.id)
      else preds.set(s.id, [chain[i - 1]!.id])
    })
    for (const s of scenes) if (!chapters[s.chapter]!.id) entries.add(s.id)
  }
  const changes = (id: string): readonly Change[] => byId.get(id)?.doc.meta.changes ?? []
  // A flash-forward shows what will be true later: its changes hold in the scene itself and in no
  // scene after it in reading order (they apply at their story time). A flashback's still carry on.
  const flow = runFlow({
    order,
    preds,
    entries,
    changes,
    carries: (id) => byId.get(id)?.doc.meta.flashForward !== true,
    ...(start ? { initial: start.state } : {}),
  })

  const nameOf = (id: string) =>
    data.records.find((r) => r.meta.id === id)?.meta.title ?? 'Someone no longer here'
  const sceneName = (id: string) => {
    const s = byId.get(id)
    return s ? `${s.ref} · ${s.title}` : (start?.sceneName(id) ?? 'a scene that is no longer here')
  }
  return {
    input,
    data,
    bookId,
    scenes,
    byId,
    chapters,
    chapterCount: chapters.filter((c) => c.id).length,
    graph,
    presence,
    flow,
    characters,
    calendars: universe?.calendars ?? [],
    nameOf,
    sceneName,
    changes,
  }
}

/** What is true when a book ends, as the next book of the universe begins from it; undefined for a book with no scenes. */
export function endState(m: ContinuityModel): State | undefined {
  const g = m.graph
  const last = (id: string) => {
    const s = m.byId.get(id)
    return s?.doc.meta.flashForward ? m.flow.before.get(id) : m.flow.after.get(id)
  }
  let ends: string[]
  if (g) {
    const leads = new Set(g.edges.filter((e) => !e.broken).map((e) => e.from))
    ends = [...g.reachable].filter((id) => !leads.has(id))
    // A story that only loops has no end: what holds on any scene a reader can reach is what is carried on.
    if (!ends.length) ends = [...g.reachable]
  } else {
    const chain = m.scenes.filter((s) => m.chapters[s.chapter]!.id)
    ends = chain.length ? [chain.at(-1)!.id] : []
  }
  const states = ends.flatMap((id) => last(id) ?? [])
  return states.length ? join(states) : undefined
}

/** The state of the story at the end of a scene, for the inspector and the cards. */
export const stateAt = (m: ContinuityModel, sceneId: string): State | undefined =>
  m.flow.after.get(sceneId)

/** Whether two scenes can be read in one playthrough (always, in a straight book): one leads to the other. */
export function coReachable(m: ContinuityModel): (a: string, b: string) => boolean {
  const g = m.graph
  if (!g) return () => true
  const out = new Map<string, string[]>()
  for (const e of g.edges) if (!e.broken) out.set(e.from, [...(out.get(e.from) ?? []), e.target])
  const reach = new Map<string, Set<string>>()
  const from = (id: string) => {
    let seen = reach.get(id)
    if (seen) return seen
    seen = new Set<string>()
    const queue = [id]
    for (let i = 0; i < queue.length; i++)
      for (const n of out.get(queue[i]!) ?? [])
        if (!seen.has(n)) {
          seen.add(n)
          queue.push(n)
        }
    reach.set(id, seen)
    return seen
  }
  return (a, b) => a === b || from(a).has(b) || from(b).has(a)
}
