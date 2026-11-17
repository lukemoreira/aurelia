// SPDX-License-Identifier: AGPL-3.0-or-later
// What the Continuity view draws (ADR-0006 §5), as plain data: the presence map, arc lanes, POV
// balance, story time against reading order, pacing — and the state of the story at a scene, in
// words, for the inspector and the cards. Every figure here has a text twin, because each of these
// is a real table on the screen (and a "Table view" list), never a picture alone.
import { EXITS, STATUS_WORDS, type Status } from './change-kinds'
import {
  type ContinuityFinding,
  arcActivity,
  mainCharacters,
  silentStretches,
} from './continuity-checks'
import { stateAt, type ContinuityModel } from './continuity'
import { personState, type Line } from './continuity-state'
import { colourOf } from './scene-details'
import { byStart, keyWords } from './story-time'

type Tone = 'ember' | 'tide' | 'moss' | 'plum'
const toneOf = (m: ContinuityModel, id: string): Tone | undefined =>
  colourOf(m.data.records.find((r) => r.meta.id === id))

// ---- Presence map -------------------------------------------------------------------------------

export interface PresenceCell {
  state: 'pov' | 'on' | 'mentioned' | 'none'
  /** A death or an exit in this chapter. */
  exit?: 'dies' | 'leaves'
  /** A finding about this person in this chapter. */
  finding: boolean
  /** The cell in words, for the table's text. */
  text: string
}

export interface PresenceRow {
  id: string
  name: string
  /** "Main · POV", plus the role the sheet gives. */
  role: string
  tone?: Tone
  main: boolean
  scenes: number
  cells: PresenceCell[]
}

const STATE_WORDS = {
  pov: 'Point of view',
  on: 'On the page',
  mentioned: 'Mentioned',
  none: 'Not present',
}
const EXIT_WORDS = { dies: 'dies', leaves: 'leaves' }
const RANK = { none: 0, mentioned: 1, on: 2, pov: 3 }

/** Characters × chapters: who is on the page where, who is point of view, who is only spoken of, and where one dies. */
export function presenceMap(
  m: ContinuityModel,
  findings: readonly ContinuityFinding[],
): PresenceRow[] {
  const flagged = new Set(
    findings
      .filter((f) => f.subject && f.group !== 'threads')
      .map((f) => `${f.subject}:${m.byId.get(f.scene)?.chapter}`),
  )
  const main = mainCharacters(m)
  const rows = new Map<string, { cells: PresenceCell[]; scenes: number }>()
  const row = (id: string) => {
    let r = rows.get(id)
    if (!r) {
      r = {
        cells: m.chapters.map(() => ({ state: 'none' as const, finding: false, text: '' })),
        scenes: 0,
      }
      rows.set(id, r)
    }
    return r
  }
  const raise = (id: string, chapter: number, state: PresenceCell['state']) => {
    const cell = row(id).cells[chapter]!
    if (RANK[state] > RANK[cell.state]) cell.state = state
  }
  for (const s of m.scenes) {
    const p = m.presence.get(s.id)!
    for (const who of p.present) {
      row(who).scenes++
      raise(who, s.chapter, who === p.pov ? 'pov' : 'on')
    }
    for (const who of p.mentioned) raise(who, s.chapter, 'mentioned')
    for (const c of m.changes(s.id))
      if (c.kind === 'status' && c.who && m.characters.has(c.who)) {
        const value = (c.value ?? '').trim().toLowerCase()
        if (EXITS.has(value))
          row(c.who).cells[s.chapter]!.exit = value === 'dead' ? 'dies' : 'leaves'
      }
  }
  const out: PresenceRow[] = []
  for (const [id, { cells, scenes }] of rows) {
    const povs = [...m.presence.values()].some((p) => p.pov === id)
    const role = (
      m.data.records.find((r) => r.meta.id === id)?.meta as { role?: string } | undefined
    )?.role
    for (const [i, cell] of cells.entries()) {
      cell.finding = flagged.has(`${id}:${i}`)
      cell.text = [
        STATE_WORDS[cell.state],
        cell.exit ? EXIT_WORDS[cell.exit] : '',
        cell.finding ? 'finding' : '',
      ]
        .filter(Boolean)
        .join(', ')
    }
    const tone = toneOf(m, id)
    out.push({
      id,
      name: m.nameOf(id),
      role: [role, main.has(id) ? 'Main' : '', povs ? 'POV' : ''].filter(Boolean).join(' · '),
      ...(tone ? { tone } : {}),
      main: main.has(id),
      scenes,
      cells,
    })
  }
  return out.sort(
    (a, b) =>
      Number(b.main) - Number(a.main) || b.scenes - a.scenes || a.name.localeCompare(b.name),
  )
}

/** A row as runs of chapters with the same words, for the "Table view" list: "Chapters 1–3: point of view". */
export function presenceRuns(
  row: PresenceRow,
  chapters: readonly { number: number }[],
): { from: number; to: number; text: string }[] {
  const runs: { from: number; to: number; text: string }[] = []
  row.cells.forEach((cell, i) => {
    if (cell.text === STATE_WORDS.none) return
    const last = runs.at(-1)
    const number = chapters[i]?.number ?? i + 1
    if (last && last.text === cell.text && last.to === (chapters[i - 1]?.number ?? i))
      last.to = number
    else runs.push({ from: number, to: number, text: cell.text })
  })
  return runs
}

// ---- Arc lanes -----------------------------------------------------------------------------------

export interface LaneCell {
  kind: 'beat' | 'advanced' | 'silent' | 'none'
  text: string
}
export interface ArcLane {
  id: string
  name: string
  tone?: Tone
  cells: LaneCell[]
  silent: number
}

const LANE_WORDS = { beat: 'Beat', advanced: 'Moves on', silent: 'Silent', none: 'Nothing' }

/** Each arc's beats across the chapters, and where it goes quiet. */
export function arcLanes(m: ContinuityModel): ArcLane[] {
  const silent = silentStretches(m)
  const lanes: ArcLane[] = []
  for (const [id, { chapters, beats }] of arcActivity(m)) {
    if (!chapters.size) continue
    const gaps = silent.filter((s) => s.arc === id)
    const tone = toneOf(m, id)
    lanes.push({
      id,
      name: m.nameOf(id),
      ...(tone ? { tone } : {}),
      silent: gaps.length,
      cells: m.chapters.map((_, i) => {
        const kind = beats.has(i)
          ? 'beat'
          : chapters.has(i)
            ? 'advanced'
            : gaps.some((g) => i >= g.from && i <= g.to)
              ? 'silent'
              : 'none'
        return { kind, text: LANE_WORDS[kind] }
      }),
    })
  }
  return lanes.sort(
    (a, b) =>
      b.cells.filter((c) => c.kind !== 'none').length -
      a.cells.filter((c) => c.kind !== 'none').length,
  )
}

/** A lane as a line to read: "Beat in chapters 7, 9 · moves on in chapter 3 · silent in chapters 4–12". */
export function laneWords(lane: ArcLane, chapters: readonly { number: number }[]): string {
  const numbers = (kind: LaneCell['kind']) => {
    const at = lane.cells.flatMap((c, i) => (c.kind === kind ? [chapters[i]?.number ?? i + 1] : []))
    const runs: string[] = []
    for (let i = 0; i < at.length; i++) {
      let j = i
      while (kind === 'silent' && at[j + 1] === at[j]! + 1) j++
      runs.push(j > i ? `${at[i]}–${at[j]}` : `${at[i]}`)
      i = j
    }
    return runs.length ? `${runs.join(', ')}` : ''
  }
  const part = (kind: LaneCell['kind'], word: string) => {
    const n = numbers(kind)
    return n ? `${word} in chapter${n.includes(',') || n.includes('–') ? 's' : ''} ${n}` : ''
  }
  return [part('beat', 'beat'), part('advanced', 'moves on'), part('silent', 'silent')]
    .filter(Boolean)
    .join(' · ')
}

// ---- POV balance ----------------------------------------------------------------------------------

export interface PovShare {
  id: string
  name: string
  tone?: Tone
  words: number
  scenes: number
  /** Whole percent of the words that have a point of view. */
  share: number
}

export function povBalance(m: ContinuityModel): PovShare[] {
  const by = new Map<string, { words: number; scenes: number }>()
  for (const s of m.scenes) {
    const pov = m.presence.get(s.id)!.pov
    if (!pov) continue
    const now = by.get(pov) ?? { words: 0, scenes: 0 }
    by.set(pov, { words: now.words + s.doc.words, scenes: now.scenes + 1 })
  }
  const total = [...by.values()].reduce((n, v) => n + v.words, 0)
  return [...by]
    .map(([id, v]) => {
      const tone = toneOf(m, id)
      return {
        id,
        name: m.nameOf(id),
        ...(tone ? { tone } : {}),
        ...v,
        share: total ? Math.round((v.words / total) * 100) : 0,
      }
    })
    .sort((a, b) => b.words - a.words)
}

// ---- Story time against reading order --------------------------------------------------------------

export interface TimePoint {
  scene: string
  ref: string
  title: string
  /** Place in reading order, 0-based. */
  x: number
  /** Place among the distinct moments of the book, 0-based: later moments are higher. */
  rank: number
  words: string
  order: 'in order' | 'flashback' | 'flash-forward'
  /** A time-order finding is about this scene. */
  jump: boolean
}

export interface TimeChart {
  calendar?: string
  /** Scenes in the book: the width of the reading-order axis. */
  scenes: number
  /** Where each (nth) chapter begins on the reading-order axis. */
  ticks: { x: number; number: number }[]
  points: TimePoint[]
  moments: number
  /** Scenes in another calendar: not compared. */
  elsewhere: number
  untimed: number
}

export function timeChart(m: ContinuityModel, findings: readonly ContinuityFinding[]): TimeChart {
  const timed = m.scenes.filter((s) => s.span)
  const use = new Map<string, number>()
  for (const s of timed) use.set(s.span!.calendar, (use.get(s.span!.calendar) ?? 0) + 1)
  const calendar = [...use].sort((a, b) => b[1] - a[1])[0]?.[0]
  const same = timed.filter((s) => s.span!.calendar === calendar)
  const sorted = [...same].sort((a, b) => byStart(a.span!, b.span!))
  const rank = new Map<string, number>()
  let n = -1
  sorted.forEach((s, i) => {
    if (i === 0 || byStart(sorted[i - 1]!.span!, s.span!) !== 0) n++
    rank.set(s.id, n)
  })
  const jumps = new Set(findings.filter((f) => f.check === 'time-order').map((f) => f.scene))
  const cal = m.calendars.find((c) => c.id === calendar)
  return {
    ...(calendar ? { calendar: cal?.name ?? 'Another calendar' } : {}),
    scenes: m.scenes.length,
    ticks: m.chapters
      .slice(0, m.chapterCount)
      .filter((c, i) => c.scenes.length && i % Math.max(1, Math.ceil(m.chapterCount / 10)) === 0)
      .map((c) => ({ x: c.scenes[0]!.index, number: c.number })),
    moments: n + 1,
    elsewhere: timed.length - same.length,
    untimed: m.scenes.length - timed.length,
    points: same.map((s) => ({
      scene: s.id,
      ref: s.ref,
      title: s.title,
      x: s.index,
      rank: rank.get(s.id)!,
      words: keyWords(s.doc.meta.time!.at, cal),
      order: s.doc.meta.flashback
        ? 'flashback'
        : s.doc.meta.flashForward
          ? 'flash-forward'
          : 'in order',
      jump: jumps.has(s.id),
    })),
  }
}

// ---- Pacing ------------------------------------------------------------------------------------------

export interface Pace {
  id: string
  number: number
  title: string
  scenes: number
  words: number
  /** What the chapter was meant to be: its own target, else its scenes' targets together. */
  target?: number
}

export function pacing(m: ContinuityModel): Pace[] {
  return m.chapters.map((c) => {
    const sum = c.scenes.reduce((n, s) => n + (s.doc.meta.target ?? 0), 0)
    const target = c.target ?? (sum || undefined)
    return {
      id: c.id,
      number: c.number,
      title: c.title,
      scenes: c.scenes.length,
      words: c.words,
      ...(target ? { target } : {}),
    }
  })
}

/** How many of this book's set-ups have been paid off, by a pay-off anywhere in the workspace. */
export function setupTally(m: ContinuityModel): { total: number; paid: number } {
  const paid = new Set<string>()
  for (const s of m.data.scenes)
    for (const c of s.meta.changes ?? []) if (c.kind === 'payoff' && c.of) paid.add(c.of)
  let total = 0
  let done = 0
  for (const s of m.scenes)
    for (const c of m.changes(s.id))
      if (c.kind === 'setup') {
        total++
        if (c.id && paid.has(c.id)) done++
      }
  return { total, paid: done }
}

// ---- The numbers above the map -----------------------------------------------------------------------

export interface Stat {
  value: string
  label: string
}

export function continuityStats(
  m: ContinuityModel,
  rows: readonly PresenceRow[],
  findings: readonly ContinuityFinding[] = [],
): Stat[] {
  const withChanges = m.scenes.filter((s) => m.changes(s.id).length).length
  const lanes = arcLanes(m)
  const quiet = lanes.filter((l) => l.silent).length
  const flashbacks = m.scenes.filter((s) => s.offBeat).length
  const jumps = findings.filter((f) => f.check === 'time-order').length
  return [
    { value: `${withChanges} of ${m.scenes.length}`, label: 'scenes have changes recorded' },
    {
      value: `${rows.length}`,
      label: rows.length === 1 ? 'character on the page' : 'characters on the page',
    },
    { value: `${lanes.length}`, label: `${lanes.length === 1 ? 'arc' : 'arcs'} · ${quiet} silent` },
    {
      value: `${m.scenes.filter((s) => s.span).length}`,
      label: `scenes with a story time · ${flashbacks} told out of order on purpose · ${jumps} jump${jumps === 1 ? '' : 's'} not marked`,
    },
  ]
}

// ---- State at a scene, in words -----------------------------------------------------------------------

export interface StateItem {
  text: string
  /** "since 9.3": the scene that made it so. */
  since?: string
  /** "on some paths": not every way of reaching the scene has it. */
  some: boolean
}
export interface StateRow {
  label: string
  items: StateItem[]
}

/** What is true of a person at the end of a scene, as rows to read: only what has been recorded. */
export function stateRows(m: ContinuityModel, sceneId: string, who: string): StateRow[] {
  const after = stateAt(m, sceneId)
  const scene = m.byId.get(sceneId)
  if (!after || !scene) return []
  const s = personState(after, who)
  const item = (l: Line, text: string): StateItem => ({
    text,
    ...(l.since && m.byId.get(l.since) ? { since: m.byId.get(l.since)!.ref } : {}),
    some: !l.every,
  })
  const rows: StateRow[] = []
  const add = (label: string, items: StateItem[]) => items.length && rows.push({ label, items })
  add(
    'Status',
    s.status.map((l) => item(l, STATUS_WORDS[(l.text || 'alive') as Status] ?? l.text)),
  )
  add(
    'Condition',
    s.condition.map((l) => item(l, l.text)),
  )
  // On the page, a person is where the scene is — unless this scene itself sends them elsewhere. A place
  // they went to scenes ago says where they were then, not where this scene finds them.
  const sentAway = m.changes(sceneId).some((c) => c.kind === 'location' && c.who === who)
  const here = scene.doc.meta.location
  const at =
    here && m.presence.get(sceneId)!.present.has(who) && !sentAway
      ? [{ text: m.nameOf(here), some: false }]
      : s.place.map((l) => item(l, m.nameOf(l.text)))
  add('Where', at)
  add(
    'Goal',
    s.goal.map((l) => item(l, l.text)),
  )
  add(
    'Holds',
    s.holds.map((l) => item(l, m.nameOf(l.text))),
  )
  add(
    'Has learned',
    s.knows.map((l) => item(l, l.text)),
  )
  add(
    'Believes',
    s.traits.map((l) => item(l, l.text)),
  )
  add(
    'Relationships',
    s.relations.flatMap((r) => r.lines.map((l) => item(l, `${m.nameOf(r.with)}: ${l.text}`))),
  )
  return rows
}

/** What the inspector shows of a scene: the people on the page with their state, and the findings about it. */
export function sceneContinuity(
  m: ContinuityModel,
  findings: readonly ContinuityFinding[],
  sceneId: string,
) {
  const p = m.presence.get(sceneId)
  const people = [...(p?.present ?? [])]
    .sort(
      (a, b) =>
        Number(b === p?.pov) - Number(a === p?.pov) || m.nameOf(a).localeCompare(m.nameOf(b)),
    )
    .map((id) => ({ id, name: m.nameOf(id), pov: id === p?.pov, rows: stateRows(m, sceneId, id) }))
  return {
    people,
    findings: findings.filter((f) => f.scene === sceneId || f.related.includes(sceneId)),
  }
}
