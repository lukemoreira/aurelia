// SPDX-License-Identifier: AGPL-3.0-or-later
// A branching book as a graph (ADR-0004): scenes are nodes, choices are edges, the start scene is
// `book.start` (else the first scene). Plain TS: the story map, the checks and Play mode read it.
import { bookScenes, sceneLabels } from './outline'
import type { WorkspaceData } from './workspace-data'

export interface StoryChoice {
  id: string
  label: string
  target: string
  /** Set when the target is not a scene of this book. */
  broken?: 'deleted' | 'other-book'
}

export interface StoryNode {
  id: string
  title: string
  /** "2.1": chapter number and place in the chapter. */
  ref: string
  ending: boolean
  choices: StoryChoice[]
}

export interface StoryEdge extends StoryChoice {
  from: string
}

export interface StoryGraph {
  book: string
  start: string | undefined
  /** Scene IDs in outline (writing) order. */
  order: string[]
  nodes: Map<string, StoryNode>
  /** Every choice, in outline order. */
  edges: StoryEdge[]
  /** Scenes a reader can get to from the start. */
  reachable: Set<string>
  /** Scenes an ending can be reached from, endings included. */
  canEnd: Set<string>
  /** Scenes from which a dead end or a broken choice can be reached: what is wrong there is named already. */
  leadsToTrouble: Set<string>
  /** How many working choices lead into each scene. */
  waysIn: Map<string, number>
}

function search(starts: string[], next: (id: string) => string[]): Set<string> {
  const seen = new Set(starts)
  const queue = [...starts]
  for (let i = 0; i < queue.length; i++)
    for (const n of next(queue[i]!))
      if (!seen.has(n)) {
        seen.add(n)
        queue.push(n)
      }
  return seen
}

export function storyGraph(data: WorkspaceData, bookId: string): StoryGraph {
  const book = data.books.find((b) => b.id === bookId)
  const scenes = bookScenes(data, bookId)
  const order = scenes.map((s) => s.meta.id)
  const inBook = new Set(order)
  const anywhere = new Set(data.scenes.map((s) => s.meta.id))
  const refs = sceneLabels(data, bookId)

  const nodes = new Map<string, StoryNode>()
  const edges: StoryEdge[] = []
  for (const s of scenes) {
    const choices = (s.meta.choices ?? []).map((c): StoryChoice => {
      const broken = inBook.has(c.target)
        ? undefined
        : anywhere.has(c.target)
          ? ('other-book' as const)
          : ('deleted' as const)
      return { id: c.id, label: c.label, target: c.target, ...(broken ? { broken } : {}) }
    })
    nodes.set(s.meta.id, {
      id: s.meta.id,
      title: s.meta.title,
      ref: refs.get(s.meta.id) ?? '',
      ending: s.meta.ending === true,
      choices,
    })
    for (const c of choices) edges.push({ ...c, from: s.meta.id })
  }

  const start = book?.start && inBook.has(book.start) ? book.start : order[0]
  const working = edges.filter((e) => !e.broken)
  const out = new Map<string, string[]>()
  const into = new Map<string, string[]>()
  const waysIn = new Map<string, number>()
  for (const e of working) {
    out.set(e.from, [...(out.get(e.from) ?? []), e.target])
    into.set(e.target, [...(into.get(e.target) ?? []), e.from])
    waysIn.set(e.target, (waysIn.get(e.target) ?? 0) + 1)
  }
  const reachable = search(start ? [start] : [], (id) => out.get(id) ?? [])
  const endings = order.filter((id) => nodes.get(id)!.ending)
  const canEnd = search(endings, (id) => into.get(id) ?? [])
  const trouble = order.filter((id) => {
    const n = nodes.get(id)!
    return (!n.ending && n.choices.length === 0) || n.choices.some((c) => c.broken)
  })
  const leadsToTrouble = search(trouble, (id) => into.get(id) ?? [])
  return { book: bookId, start, order, nodes, edges, reachable, canEnd, leadsToTrouble, waysIn }
}

export type FindingCheck = 'broken-choice' | 'dead-end' | 'unreachable' | 'no-ending'
export type FindingSeverity = 'error' | 'warning' | 'note'

/** What the author can do about a finding from the problems list. */
export type FindingFix = 'pick-scene' | 'mark-ending' | 'add-way-in' | 'add-choice'

export interface StoryFinding {
  check: FindingCheck
  severity: FindingSeverity
  /** The scene to show and open. */
  scene: string
  choice?: string
  title: string
  body: string
  fix: FindingFix
  /** Check id + sorted subject IDs (ADR-0006): what "Mark intended" stores in `book.json`. */
  fingerprint: string
}

export const fingerprintOf = (check: string, ...ids: string[]) =>
  `${check}:${[...ids].sort().join(',')}`

/** Whether a fingerprint belongs to one of the story map's four checks (the Continuity list adds its own). */
export const isStoryFingerprint = (fingerprint: string) =>
  /^(broken-choice|dead-end|unreachable|no-ending):/.test(fingerprint)

const RANK: Record<FindingSeverity, number> = { error: 0, warning: 1, note: 2 }

/**
 * The four checks of ADR-0004 §8: broken choice, dead end, unreachable, and no ending reachable
 * from here. Errors first, then in outline order. Each problem is named where it is: a scene that
 * only leads to a dead end or a broken choice is not also told it has no way to an ending.
 */
export function storyFindings(g: StoryGraph): StoryFinding[] {
  const found: StoryFinding[] = []
  const title = (id: string) => `“${g.nodes.get(id)?.title ?? ''}”`
  const hasEnding = g.order.some((id) => g.nodes.get(id)!.ending)
  for (const id of g.order) {
    const n = g.nodes.get(id)!
    for (const c of n.choices) {
      if (!c.broken) continue
      const gone =
        c.broken === 'other-book' ? 'a scene in another book' : 'a scene that is not there any more'
      found.push({
        check: 'broken-choice',
        severity: 'error',
        scene: id,
        choice: c.id,
        title: 'Broken choice',
        body: `“${c.label}” in ${title(id)} points to ${gone}.`,
        fix: 'pick-scene',
        fingerprint: fingerprintOf('broken-choice', c.id, id, c.target),
      })
    }
    if (!n.ending && n.choices.length === 0)
      found.push({
        check: 'dead-end',
        severity: 'warning',
        scene: id,
        title: 'Dead end',
        body: `${title(id)} has no choices and is not marked as an ending.`,
        fix: 'mark-ending',
        fingerprint: fingerprintOf('dead-end', id),
      })
    if (!g.reachable.has(id))
      found.push({
        check: 'unreachable',
        severity: 'warning',
        scene: id,
        title: 'Unreachable',
        body: `No path from the start reaches ${title(id)}.`,
        fix: 'add-way-in',
        fingerprint: fingerprintOf('unreachable', id),
      })
    else if (
      hasEnding &&
      !n.ending &&
      n.choices.length > 0 &&
      !g.canEnd.has(id) &&
      !g.leadsToTrouble.has(id)
    )
      found.push({
        check: 'no-ending',
        severity: 'warning',
        scene: id,
        title: 'No ending from here',
        body: `Whatever the reader picks in ${title(id)}, no path leads to an ending.`,
        fix: 'add-choice',
        fingerprint: fingerprintOf('no-ending', id),
      })
  }
  // With no ending anywhere, one finding says so, instead of one for every scene.
  if (!hasEnding && g.start)
    found.push({
      check: 'no-ending',
      severity: 'warning',
      scene: g.start,
      title: 'No ending',
      body: 'No scene is marked as an ending, so no path can finish. Add a choice to a scene, or mark one as an ending.',
      fix: 'add-choice',
      fingerprint: fingerprintOf('no-ending', g.book),
    })
  return found.sort((a, b) => RANK[a.severity] - RANK[b.severity])
}

/**
 * The findings the author has not marked as intended, and the ones they have. An Error is never
 * set aside (a choice to nowhere is not a thing to intend), whatever the list says.
 */
export function splitFindings(found: StoryFinding[], dismissed: readonly string[] = []) {
  const set = new Set(dismissed)
  const hidden = (f: StoryFinding) => set.has(f.fingerprint) && f.severity !== 'error'
  return { active: found.filter((f) => !hidden(f)), dismissed: found.filter(hidden) }
}

/** The words above the problems list: how big the story is and whether it can be finished. */
export function storySummary(g: StoryGraph) {
  const endings = g.order.filter((id) => g.nodes.get(id)!.ending)
  return {
    scenes: g.order.length,
    choices: g.edges.length,
    endings: endings.length,
    endingsReachable: endings.filter((id) => g.reachable.has(id)).length,
  }
}

// ---- Play mode: the path a reader has taken, as scene IDs (the first is the start) ------------

export const playStart = (g: StoryGraph): string[] => (g.start ? [g.start] : [])

/** The path with the chosen choice's scene added; unchanged when the choice leads nowhere. */
export function playChoose(g: StoryGraph, path: string[], choiceId: string): string[] {
  const here = g.nodes.get(path.at(-1) ?? '')
  const choice = here?.choices.find((c) => c.id === choiceId)
  return choice && !choice.broken ? [...path, choice.target] : path
}

export const playBack = (path: string[]): string[] => (path.length > 1 ? path.slice(0, -1) : path)

/** Back to an earlier step of the path (the "path taken" list). */
export const playJump = (path: string[], index: number): string[] =>
  index >= 0 && index < path.length ? path.slice(0, index + 1) : path
