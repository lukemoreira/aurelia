// SPDX-License-Identifier: AGPL-3.0-or-later
// What the Plan view shows of a book: the outline table's rows, the corkboard's columns, the arcs
// a scene can advance and the scenes an arc advances across a universe's books.
import { bookOutline, bookUnfiled, sceneLabels } from './outline'
import type { Scene } from './schema/scene'
import { colourOf } from './scene-details'
import { splitFindings, storyFindings, storyGraph } from './story-graph'
import type { SceneDoc, WorkspaceData } from './workspace-data'

type Status = NonNullable<Scene['status']>
/** A CSS colour (a token) or nothing, for an arc or a status. */
type Colour = string | undefined

export interface ArcRef {
  id: string
  name: string
  /** `var(--ember)`…; nothing when the arc has no colour yet. */
  colour: Colour
}
export interface PovRef {
  id: string
  name: string
  colour: Colour
}

export interface PlanScene {
  id: string
  ref: string
  title: string
  summary: string
  status?: Status
  pov?: PovRef
  /** The arcs that can be shown (those the book can see). */
  arcs: ArcRef[]
  /** Every arc ID stored on the scene, seen or not: what an edit must keep. */
  arcIds: string[]
  words: number
  /** Open findings of the story map (branching books only). */
  findings: number
}

export interface PlanChapter {
  id: string
  title: string
  number: number
  status?: Status
  words: number
  target?: number
  arcs: ArcRef[]
  scenes: PlanScene[]
}

export interface PlanPart {
  /** Absent for chapters that sit straight under the book, and for Unfiled. */
  id?: string
  title?: string
  status?: Status
  chapters: PlanChapter[]
}

const token = (c: string | undefined): Colour => (c ? `var(--${c})` : undefined)

/** Status colours, as the status dot draws them. */
export const STATUS_COLOURS: Record<Status, string> = {
  idea: 'var(--ink-3)',
  outline: 'var(--tide)',
  draft: 'var(--warn)',
  revised: 'var(--plum)',
  final: 'var(--ok)',
}

/** The arcs a book's scenes can advance: shared by its universe, or private to the book. */
export function arcsFor(data: WorkspaceData, bookId: string): ArcRef[] {
  const universe = data.universes.find((u) => u.books.includes(bookId))
  return data.records
    .filter(
      (r) =>
        r.meta.type === 'arc' &&
        (r.meta.scope === 'universe'
          ? r.universe === universe?.id
          : r.meta.scope === `book:${bookId}`),
    )
    .map((r) => ({ id: r.meta.id, name: r.meta.title, colour: token(colourOf(r)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The book as the Plan view shows it: parts, chapters and scenes with everything a row or card needs. */
export function planParts(data: WorkspaceData, bookId: string): PlanPart[] {
  const arcs = new Map(arcsFor(data, bookId).map((a) => [a.id, a]))
  const records = new Map(data.records.map((r) => [r.meta.id, r]))
  const refs = sceneLabels(data, bookId)
  const book = data.books.find((b) => b.id === bookId)
  const open = new Map<string, number>()
  if (book?.mode === 'branching') {
    const split = splitFindings(storyFindings(storyGraph(data, bookId)), book.dismissedFindings)
    for (const f of split.active) open.set(f.scene, (open.get(f.scene) ?? 0) + 1)
  }
  const arcRefs = (ids: string[] | undefined) =>
    (ids ?? []).flatMap((id) => (arcs.has(id) ? [arcs.get(id)!] : []))
  const scene = (s: SceneDoc): PlanScene => {
    const pov = s.meta.pov ? records.get(s.meta.pov) : undefined
    return {
      id: s.meta.id,
      ref: refs.get(s.meta.id) ?? '',
      title: s.meta.title,
      summary: s.meta.summary ?? '',
      ...(s.meta.status ? { status: s.meta.status } : {}),
      ...(pov
        ? { pov: { id: pov.meta.id, name: pov.meta.title, colour: token(colourOf(pov)) } }
        : {}),
      arcs: arcRefs(s.meta.arcs),
      arcIds: s.meta.arcs ?? [],
      words: s.words,
      findings: open.get(s.meta.id) ?? 0,
    }
  }
  const parts = bookOutline(data, bookId).map((group): PlanPart => ({
    ...(group.part ? { id: group.part.id, title: group.part.title } : {}),
    ...(group.part?.status ? { status: group.part.status } : {}),
    chapters: group.chapters.map((c): PlanChapter => {
      const target = (c.chapter as { target?: number }).target
      return {
        id: c.chapter.id,
        title: c.chapter.title,
        number: c.number,
        ...(c.chapter.status ? { status: c.chapter.status } : {}),
        words: c.words,
        ...(target ? { target } : {}),
        arcs: arcRefs((c.chapter as { arcs?: string[] }).arcs),
        scenes: c.scenes.map(scene),
      }
    }),
  }))
  const unfiled = bookUnfiled(data, bookId)
  if (unfiled.length)
    parts.push({
      title: 'Unfiled',
      chapters: [
        {
          id: '',
          title: 'Unfiled',
          number: 0,
          words: unfiled.reduce((n, s) => n + s.words, 0),
          arcs: [],
          scenes: unfiled.map(scene),
        },
      ],
    })
  return parts
}

export type PlanRow =
  | { kind: 'part'; id: string; title: string; status?: Status; chapters: number; words: number }
  | { kind: 'chapter'; id: string; chapter: PlanChapter; unfiled: boolean }
  | { kind: 'scene'; id: string; scene: PlanScene; chapter: string }

/** The outline table's rows in reading order: part, its chapters, each chapter's scenes. */
export function planRows(parts: PlanPart[]): PlanRow[] {
  return parts.flatMap((p): PlanRow[] => [
    ...(p.id
      ? [
          {
            kind: 'part' as const,
            id: p.id,
            title: p.title ?? '',
            ...(p.status ? { status: p.status } : {}),
            chapters: p.chapters.length,
            words: p.chapters.reduce((n, c) => n + c.words, 0),
          },
        ]
      : []),
    ...p.chapters.flatMap((c): PlanRow[] => [
      { kind: 'chapter' as const, id: c.id || 'unfiled', chapter: c, unfiled: !c.id },
      ...c.scenes.map((s) => ({ kind: 'scene' as const, id: s.id, scene: s, chapter: c.id })),
    ]),
  ])
}

/** The arcs a book's scenes advance, for the legend: only the ones in use, in name order. */
export function arcsInUse(parts: PlanPart[]): ArcRef[] {
  const seen = new Map<string, ArcRef>()
  for (const p of parts)
    for (const c of p.chapters) for (const s of c.scenes) for (const a of s.arcs) seen.set(a.id, a)
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export interface ArcBeat {
  id: string
  ref: string
  title: string
  status?: Status
}
export interface ArcBook {
  book: { id: string; title: string }
  beats: ArcBeat[]
}

/**
 * The scenes that advance an arc, book by book in the universe's own book order (ADR-0002 §4),
 * each in reading order. A book none of whose scenes advance it is left out.
 */
export function arcBeats(data: WorkspaceData, arcId: string): ArcBook[] {
  const home = data.records.find((r) => r.meta.id === arcId)?.universe
  const universe = data.universes.find((u) => u.id === home)
  const books = (universe?.books ?? []).flatMap((id) => data.books.find((b) => b.id === id) ?? [])
  return books.flatMap((b): ArcBook[] => {
    const refs = sceneLabels(data, b.id)
    const beats = [
      ...bookOutline(data, b.id).flatMap((g) => g.chapters.flatMap((c) => c.scenes)),
      ...bookUnfiled(data, b.id),
    ]
      .filter((s) => s.meta.arcs?.includes(arcId))
      .map((s): ArcBeat => ({
        id: s.meta.id,
        ref: refs.get(s.meta.id) ?? '',
        title: s.meta.title,
        ...(s.meta.status ? { status: s.meta.status } : {}),
      }))
    return beats.length ? [{ book: { id: b.id, title: b.title }, beats }] : []
  })
}

export const rowTitle = (r: PlanRow) =>
  r.kind === 'part' ? r.title : r.kind === 'chapter' ? r.chapter.title : r.scene.title
export const rowStatus = (r: PlanRow) =>
  r.kind === 'part' ? r.status : r.kind === 'chapter' ? r.chapter.status : r.scene.status
export const rowWords = (r: PlanRow) =>
  r.kind === 'part' ? r.words : r.kind === 'chapter' ? r.chapter.words : r.scene.words
