// SPDX-License-Identifier: AGPL-3.0-or-later
// The continuity checks of ADR-0006 §4: rule-based, offline, each one a pure function of the model
// that says what it found, where and why. A check never changes text. Findings are Error / Warning /
// Note, carry a fingerprint (check + subject IDs + scene IDs) so "Mark intended" can hide them, and —
// in a branching book — say whether they hold on every path or on some.
import { EXITS } from './change-kinds'
import { coReachable, type ContinuityModel, type SceneInfo } from './continuity'
import { holderSets, statusFacts } from './continuity-state'
import { certainlyBefore, keyWords, overlaps, sameMoment } from './story-time'
import { fingerprintOf, storyFindings, type FindingSeverity } from './story-graph'

export type ContinuityCheck =
  | 'appears-after-exit'
  | 'two-places'
  | 'time-order'
  | 'item-two-hands'
  | 'setup-unpaid'
  | 'payoff-orphan'
  | 'silent-arc'
  | 'long-absence'
  | 'broken-link'

/** The tabs of the findings list. */
export type FindingGroup = 'characters' | 'time' | 'threads' | 'story'

export interface ContinuityFinding {
  /** A continuity check, or one of the story map's (dead end, unreachable…). */
  check: string
  group: FindingGroup
  severity: FindingSeverity
  /** The scene to open. */
  scene: string
  /** The other scenes the finding is about. */
  related: string[]
  /** The character or arc it is about, when it is about one. */
  subject?: string
  title: string
  body: string
  /** What "Mark intended" stores in `book.json`. */
  fingerprint: string
  /** False for a choice that points nowhere: that is mended, not intended. */
  intendable: boolean
  /** Words in the scene's text where the problem is, for "Go to" to select (a link that points nowhere). */
  at?: string
  /** Holds on every path that reaches the scene, or only on some (branching books). */
  paths?: 'every' | 'some'
  /** Only possible: the times overlap but are not known to be the same. Shown collapsed. */
  possible?: true
}

/** A thread with no beat for this many chapters is silent. */
export const SILENT_ARC_CHAPTERS = 6
/** A main character off the page for this many chapters has been away a long time. */
export const LONG_ABSENCE_CHAPTERS = 8

const RANK: Record<FindingSeverity, number> = { error: 0, warning: 1, note: 2 }

const pathWords = (m: ContinuityModel, paths: 'every' | 'some') =>
  m.graph ? (paths === 'every' ? ' (on every path)' : ' (on some paths)') : ''

type Make = Omit<ContinuityFinding, 'check' | 'fingerprint' | 'intendable' | 'related'> & {
  related?: string[]
  ids: string[]
  intendable?: boolean
}
const finding = (check: ContinuityCheck, f: Make): ContinuityFinding => {
  const { ids, related, intendable, ...rest } = f
  return {
    ...rest,
    check,
    related: related ?? [],
    fingerprint: fingerprintOf(check, ...ids),
    intendable: intendable ?? true,
  }
}

/** Someone present in a scene after they died or left (not in a flashback, and not the scene that brings them back). */
export function appearsAfterExit(m: ContinuityModel): ContinuityFinding[] {
  const out: ContinuityFinding[] = []
  for (const s of m.scenes) {
    if (s.offBeat) continue
    const before = m.flow.before.get(s.id)
    const pres = m.presence.get(s.id)
    if (!before || !pres) continue
    const changed = new Set(
      m
        .changes(s.id)
        .filter((c) => c.kind === 'status')
        .map((c) => c.who),
    )
    for (const who of pres.present) {
      if (changed.has(who)) continue
      const facts = statusFacts(before, who)
      const gone = facts.filter((f) => EXITS.has(f.value))
      if (!gone.length) continue
      const paths = gone.length === facts.length ? 'every' : 'some'
      const exit = gone[0]!
      const how = exit.value === 'dead' ? `is dead since` : `left the story at`
      out.push(
        finding('appears-after-exit', {
          group: 'characters',
          severity: paths === 'every' ? 'error' : 'warning',
          scene: s.id,
          related: [exit.at],
          subject: who,
          title: 'Appears after death or exit',
          body: `${m.nameOf(who)} ${how} ${m.sceneName(exit.at)}, but appears in ${m.sceneName(s.id)}.${pathWords(m, paths)}`,
          // the evidence is part of the finding: a death somewhere else, or a second one, is not the one marked intended
          ids: [who, s.id, ...gone.map((f) => f.at)],
          paths,
        }),
      )
    }
  }
  return out
}

const placeOf = (s: SceneInfo, who: string) =>
  s.doc.meta.changes?.find((c) => c.kind === 'location' && c.who === who && c.with)?.with ??
  s.doc.meta.location

/** One person in two places at the same story time. Only equal times to the minute are an Error-grade clash. */
export function twoPlaces(m: ContinuityModel): ContinuityFinding[] {
  const out: ContinuityFinding[] = []
  const timed = m.scenes.filter((s) => s.span)
  const together = coReachable(m)
  const maybe = new Map<string, { found: ContinuityFinding; more: number }>()
  const placeName = (id: string) =>
    m.data.records.find((r) => r.meta.id === id)?.meta.title ?? 'a place no longer here'
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++) {
      const [a, b] = [timed[i]!, timed[j]!]
      if (!overlaps(a.span!, b.span!) || !together(a.id, b.id)) continue
      const exact = sameMoment(a.span!, b.span!)
      const [pa, pb] = [m.presence.get(a.id)!, m.presence.get(b.id)!]
      for (const who of pa.present) {
        if (!pb.present.has(who)) continue
        const [x, y] = [placeOf(a, who), placeOf(b, who)]
        if (!x || !y || x === y) continue
        const when = exact
          ? ` at ${keyWords(
              a.doc.meta.time!.at,
              m.calendars.find((c) => c.id === a.span!.calendar),
            )}`
          : ''
        const found = finding('two-places', {
          group: 'time',
          severity: exact ? 'warning' : 'note',
          scene: b.id,
          related: [a.id],
          subject: who,
          title: exact ? 'Two places at once' : 'Possibly two places at once',
          body: exact
            ? `${m.nameOf(who)} is at ${placeName(x)} (${m.sceneName(a.id)}) and at ${placeName(y)} (${m.sceneName(b.id)})${when}.`
            : `${m.nameOf(who)} is at ${placeName(x)} (${m.sceneName(a.id)}) and at ${placeName(y)} (${m.sceneName(b.id)}), and their times overlap.`,
          ids: [who, a.id, b.id],
          ...(exact ? {} : { possible: true as const }),
        })
        // A day-long scene beside a dozen timed ones overlaps with all of them: one note for the same
        // person and the same two places, the first time it happens, and how many more there are.
        if (exact) out.push(found)
        else {
          const key = `${who}|${[x, y].sort().join(',')}`
          const kept = maybe.get(key)
          if (kept) kept.more++
          else maybe.set(key, { found, more: 0 })
        }
      }
    }
  for (const { found, more } of maybe.values())
    out.push(
      more
        ? {
            ...found,
            body: `${found.body} The same overlap comes up ${more} more ${more === 1 ? 'time' : 'times'}.`,
          }
        : found,
    )
  return out
}

/** A scene that happens before the one it follows, and is not marked as a flashback. */
export function timeOrder(m: ContinuityModel): ContinuityFinding[] {
  const out: ContinuityFinding[] = []
  const flag = (earlier: SceneInfo, later: SceneInfo) =>
    out.push(
      finding('time-order', {
        group: 'time',
        severity: 'warning',
        scene: later.id,
        related: [earlier.id],
        title: 'Time order',
        body: `${m.sceneName(later.id)} happens before ${m.sceneName(earlier.id)} in story time and is not marked as a flashback.`,
        ids: [earlier.id, later.id],
      }),
    )
  if (m.graph) {
    for (const e of m.graph.edges) {
      const [a, b] = [m.byId.get(e.from), m.byId.get(e.target)]
      if (e.broken || !a?.span || !b?.span || a.offBeat || b.offBeat) continue
      if (certainlyBefore(b.span, a.span)) flag(a, b)
    }
    return out
  }
  // A straight book: each scene is compared with the last one in order, leaving out flashbacks and flash-forwards.
  const base = new Map<string, SceneInfo>() // the last scene in order, in each calendar: calendars are never compared
  for (const s of m.scenes) {
    if (!s.span || s.offBeat) continue
    const last = base.get(s.span.calendar)
    if (last?.span && certainlyBefore(s.span, last.span)) flag(last, s)
    base.set(s.span.calendar, s)
  }
  return out
}

/** An item held by two people at once, where a change gives it to the second. */
export function itemInTwoHands(m: ContinuityModel): ContinuityFinding[] {
  const out: ContinuityFinding[] = []
  for (const s of m.scenes) {
    const after = m.flow.after.get(s.id)
    if (!after) continue
    const items = new Set(
      m
        .changes(s.id)
        .filter((c) => c.kind === 'holds' && c.item)
        .map((c) => c.item!),
    )
    for (const item of items) {
      const sets = holderSets(after, item)
      const crowded = sets.filter((h) => h.who.length > 1)
      if (!crowded.length) continue
      const paths = crowded.length === sets.length ? 'every' : 'some'
      const names = crowded[0]!.who.map((w) => m.nameOf(w)).sort((a, b) => a.localeCompare(b))
      out.push(
        finding('item-two-hands', {
          group: 'characters',
          severity: 'warning',
          scene: s.id,
          title: 'Item in two hands',
          body: `${m.nameOf(item)} is held by ${names.slice(0, -1).join(', ')} and by ${names.at(-1)} in ${m.sceneName(s.id)}.${pathWords(m, paths)}`,
          ids: [item, s.id, ...crowded[0]!.who],
          paths,
        }),
      )
    }
  }
  return out
}

/** A set-up nothing pays off, and a pay-off with nothing to pay. */
export function setupWithoutPayoff(m: ContinuityModel): ContinuityFinding[] {
  const out: ContinuityFinding[] = []
  const paid = new Set<string>()
  const known = new Set<string>()
  for (const s of m.data.scenes)
    for (const c of s.meta.changes ?? []) {
      if (c.kind === 'payoff' && c.of) paid.add(c.of)
      if (c.kind === 'setup' && c.id) known.add(c.id)
    }
  for (const s of m.scenes)
    for (const c of s.doc.meta.changes ?? []) {
      if (c.kind === 'setup' && !(c.id && paid.has(c.id)))
        out.push(
          finding('setup-unpaid', {
            group: 'threads',
            severity: 'note',
            scene: s.id,
            title: 'Set-up without pay-off',
            body: `“${c.value ?? 'A set-up'}” (${s.ref}) is never paid off.`,
            ids: [c.id ?? `setup:${(c.value ?? '').trim()}`, s.id],
          }),
        )
      if (c.kind === 'payoff' && !(c.of && known.has(c.of)))
        out.push(
          finding('payoff-orphan', {
            group: 'threads',
            severity: 'warning',
            scene: s.id,
            title: 'Pay-off without set-up',
            body: `${m.sceneName(s.id)} pays off a set-up that is not there.`,
            ids: [c.of ?? `payoff:${(c.value ?? '').trim()}`, s.id],
          }),
        )
    }
  return out
}

/** The arcs a book can see, with the chapters where each moves on: a beat, or a scene that advances it. */
export function arcActivity(
  m: ContinuityModel,
): Map<string, { chapters: Set<number>; beats: Set<number> }> {
  const universe = m.data.universes.find((u) => u.books.includes(m.bookId))
  const arcs = new Map<string, { chapters: Set<number>; beats: Set<number> }>()
  for (const r of m.data.records)
    if (
      r.meta.type === 'arc' &&
      (r.meta.scope === 'universe'
        ? r.universe === universe?.id
        : r.meta.scope === `book:${m.bookId}`)
    )
      arcs.set(r.meta.id, { chapters: new Set(), beats: new Set() })
  for (const s of m.scenes) {
    if (s.chapter >= m.chapterCount) continue // scenes of no chapter are not part of the book's run of chapters
    for (const id of s.doc.meta.arcs ?? []) arcs.get(id)?.chapters.add(s.chapter)
    for (const c of s.doc.meta.changes ?? [])
      if (c.kind === 'beat' && c.who && arcs.has(c.who)) {
        arcs.get(c.who)!.chapters.add(s.chapter)
        arcs.get(c.who)!.beats.add(s.chapter)
      }
  }
  return arcs
}

/** The chapter numbers a stretch covers, "4–12". */
const span = (m: ContinuityModel, from: number, to: number) =>
  from === to
    ? `${m.chapters[from]!.number}`
    : `${m.chapters[from]!.number}–${m.chapters[to]!.number}`

/** The first scene at or after a chapter, to open when the finding is about a stretch of chapters. */
const sceneFrom = (m: ContinuityModel, chapter: number) =>
  m.chapters.slice(chapter).find((c) => c.scenes.length)?.scenes[0]?.id ?? m.scenes[0]?.id ?? ''

/** The runs of chapters (first, last) where an arc has no beat and no scene advancing it. */
export function silentStretches(m: ContinuityModel): { arc: string; from: number; to: number }[] {
  const out: { arc: string; from: number; to: number }[] = []
  for (const [arc, { chapters }] of arcActivity(m)) {
    const at = [...chapters].sort((a, b) => a - b)
    // Only a gap between two beats: what comes after the last one is an arc that has ended, not one gone quiet.
    at.slice(0, -1).forEach((c, i) => {
      const next = at[i + 1]!
      if (next - c - 1 >= SILENT_ARC_CHAPTERS) out.push({ arc, from: c + 1, to: next - 1 })
    })
  }
  return out
}

/** A thread that goes quiet: no beat, and no scene advancing it, for a run of chapters. */
export function silentArc(m: ContinuityModel): ContinuityFinding[] {
  return silentStretches(m).map(({ arc, from, to }) => {
    const scene = sceneFrom(m, from)
    return finding('silent-arc', {
      group: 'threads',
      severity: 'warning',
      scene,
      subject: arc,
      title: 'Silent arc',
      body: `${m.nameOf(arc)} has no beat for ${to - from + 1} chapters (${span(m, from, to)}).`,
      ids: [arc, scene],
    })
  })
}

/** The people who carry the story: point of view in at least two chapters, or on the page in a fifth of them. */
export function mainCharacters(m: ContinuityModel): Set<string> {
  const chapters = new Map<string, Set<number>>()
  const pov = new Map<string, Set<number>>()
  for (const s of m.scenes) {
    if (s.chapter >= m.chapterCount) continue
    const p = m.presence.get(s.id)!
    if (p.pov) pov.set(p.pov, (pov.get(p.pov) ?? new Set()).add(s.chapter))
    for (const who of p.present) chapters.set(who, (chapters.get(who) ?? new Set()).add(s.chapter))
  }
  const enough = Math.max(3, Math.ceil(m.chapterCount / 5))
  return new Set([
    ...[...pov].filter(([, c]) => c.size >= 2).map(([id]) => id),
    ...[...chapters].filter(([, c]) => c.size >= enough).map(([id]) => id),
  ])
}

/** A main character off the page for a long run of chapters (and not because they died or left). */
export function longAbsence(m: ContinuityModel): ContinuityFinding[] {
  const out: ContinuityFinding[] = []
  const exits = new Map<string, number>()
  for (const s of m.scenes)
    for (const c of s.doc.meta.flashForward ? [] : m.changes(s.id))
      if (c.kind === 'status' && c.who && EXITS.has((c.value ?? '').trim().toLowerCase()))
        exits.set(c.who, Math.min(exits.get(c.who) ?? Infinity, s.chapter))
  for (const who of mainCharacters(m)) {
    const on = new Set<number>()
    for (const s of m.scenes)
      if (s.chapter < m.chapterCount && m.presence.get(s.id)!.present.has(who)) on.add(s.chapter)
    const at = [...on].sort((a, b) => a - b)
    const gone = exits.get(who)
    at.forEach((c, i) => {
      const next = at[i + 1] ?? m.chapterCount
      const tail = i === at.length - 1
      if (next - c - 1 < LONG_ABSENCE_CHAPTERS || (tail && gone !== undefined && gone >= c)) return
      const scene = sceneFrom(m, c + 1)
      out.push(
        finding('long-absence', {
          group: 'characters',
          severity: 'warning',
          scene,
          subject: who,
          title: 'Long absence',
          body: `${m.nameOf(who)} (main character) has not appeared for ${next - c - 1} chapters (${span(m, c + 1, next - 1)}).`,
          ids: [who, scene],
        }),
      )
    })
  }
  return out
}

/** A `[[link]]` in the text that points to nothing, or to more than one thing. */
export function brokenLinks(m: ContinuityModel): ContinuityFinding[] {
  const out: ContinuityFinding[] = []
  for (const s of m.scenes) {
    const seen = new Set<string>()
    for (const l of m.input.brokenLinks(s.id)) {
      if (seen.has(`${l.status}:${l.text}`)) continue
      seen.add(`${l.status}:${l.text}`)
      const missing = l.status === 'missing'
      out.push(
        finding('broken-link', {
          group: 'story',
          severity: missing ? 'warning' : 'note',
          scene: s.id,
          title: missing ? 'Broken link' : 'Link to more than one thing',
          body: missing
            ? `“[[${l.text}]]” in ${m.sceneName(s.id)} points to nothing.`
            : `“[[${l.text}]]” in ${m.sceneName(s.id)} could be more than one thing.`,
          at: l.text,
          ids: [s.id, l.status, l.text],
        }),
      )
    }
  }
  return out
}

/** The story map's checks (dead ends, unreachable scenes, broken choices) in the same list, for a branching book. */
export function branchingFindings(m: ContinuityModel): ContinuityFinding[] {
  if (!m.graph) return []
  return storyFindings(m.graph).map((f) => ({
    check: f.check,
    group: 'story',
    severity: f.severity,
    scene: f.scene,
    related: [],
    title: f.title,
    body: f.body,
    fingerprint: f.fingerprint,
    intendable: f.severity !== 'error', // a choice to nowhere is mended, not intended
  }))
}

const CHECKS = [
  appearsAfterExit,
  twoPlaces,
  timeOrder,
  itemInTwoHands,
  setupWithoutPayoff,
  silentArc,
  longAbsence,
  brokenLinks,
]

/** Every finding of the book: the continuity checks, and in a branching book the story map's. Worst first, then in reading order. */
export function continuityFindings(m: ContinuityModel): ContinuityFinding[] {
  // Two findings with one fingerprint are one finding (a hand-written set-up written twice in a scene).
  const all = [
    ...new Map(
      [...CHECKS.flatMap((check) => check(m)), ...branchingFindings(m)].map((f) => [
        f.fingerprint,
        f,
      ]),
    ).values(),
  ]
  const place = (f: ContinuityFinding) => m.byId.get(f.scene)?.index ?? 0
  return all.sort((a, b) => RANK[a.severity] - RANK[b.severity] || place(a) - place(b))
}

/** The findings still open, and the ones the author has marked as intended (only a finding that can be intended is set aside). */
export function splitDismissed(
  found: readonly ContinuityFinding[],
  dismissed: readonly string[] = [],
) {
  const set = new Set(dismissed)
  const hidden = (f: ContinuityFinding) => f.intendable && set.has(f.fingerprint)
  return { active: found.filter((f) => !hidden(f)), dismissed: found.filter(hidden) }
}
