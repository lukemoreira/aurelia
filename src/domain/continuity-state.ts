// SPDX-License-Identifier: AGPL-3.0-or-later
// State is computed, never stored (ADR-0006 §2). Each scene's changes are folded in reading
// order; in a branching book the fold is a fixed-point dataflow over the scene graph. Every scene
// gets, for each fact, the SET of values it can have on the different paths that reach it, so a
// finding can say "on every path" or "on some paths" without listing the paths (which are
// unbounded once a book has hubs and loops). Each fact is a small state of its own — a person's
// status, an item's holders, one thing a person has learned — so the join is a union per fact and
// the sets only grow: the computation stops. Plain TS.
import { relationNow, type Change } from './change-kinds'

/** One value a fact can have, and the scene whose change gave it (empty before any change). */
export interface Fact {
  value: string
  at: string
}
/** The values a fact has on the paths that reach a place. */
type Possible = ReadonlyMap<string, Fact>
export type State = ReadonlyMap<string, Possible>

const keyOf = (f: Fact) => `${f.value}\u0001${f.at}`
const poss = (...facts: Fact[]): Possible => new Map(facts.map((f) => [keyOf(f), f]))
/** What a fact is before anything has changed it. */
const INITIAL: Possible = poss({ value: '', at: '' })
const EMPTY: State = new Map()

// The fact names. One place spells them, so the queries below and the changes agree.
const attr = {
  status: (who: string) => `status:${who}`,
  condition: (who: string) => `condition:${who}`,
  place: (who: string) => `place:${who}`,
  goal: (who: string) => `goal:${who}`,
  relation: (who: string, other: string) => `relation:${who}:${other}`,
  knows: (who: string, text: string) => `knows:${who}:${text}`,
  trait: (who: string, text: string) => `trait:${who}:${text}`,
  holders: (item: string) => `holders:${item}`,
}

const factsOf = (state: State, name: string): Possible => state.get(name) ?? INITIAL

/** A holders fact reads "chr_a@scn_1,chr_b@scn_4": each holder with the scene they took it in. */
const holdersOf = (value: string): Map<string, string> =>
  new Map(value ? value.split(',').map((x) => x.split('@') as [string, string]) : [])

/** How one change moves one fact: the fact's name and what its values become. */
function effect(
  c: Change,
  scene: string,
): [name: string, next: (now: Possible) => Possible] | undefined {
  const who = c.who
  const set = (value: string) => () => poss({ value, at: scene })
  switch (c.kind) {
    case 'status':
      return who && c.value ? [attr.status(who), set(c.value.trim().toLowerCase())] : undefined
    case 'condition':
      return who ? [attr.condition(who), set((c.value ?? '').trim())] : undefined
    case 'location':
      return who && c.with ? [attr.place(who), set(c.with)] : undefined
    case 'goal':
      return who && c.value?.trim() ? [attr.goal(who), set(c.value.trim())] : undefined
    case 'relation':
      return who && c.with && c.value?.trim()
        ? [attr.relation(who, c.with), set(relationNow(c.value))]
        : undefined
    case 'knows':
      return who && c.value?.trim() ? [attr.knows(who, c.value.trim()), set('yes')] : undefined
    case 'trait':
      return who && c.value?.trim() ? [attr.trait(who, c.value.trim()), set('yes')] : undefined
    case 'holds':
    case 'loses': {
      const item = c.item
      if (!who || !item) return undefined
      const gain = c.kind === 'holds'
      return [
        attr.holders(item),
        (now) =>
          poss(
            ...[...now.values()].map((f) => {
              const held = holdersOf(f.value)
              if (gain)
                held.set(who, held.get(who) ?? scene) // each holder keeps the scene they took it in
              else held.delete(who)
              return {
                value: [...held]
                  .map(([w, s]) => `${w}@${s}`)
                  .sort()
                  .join(','),
                at: scene,
              }
            }),
          ),
      ]
    }
    default:
      return undefined // beats, set-ups and pay-offs are read from the changes; unknown kinds are kept
  }
}

/** The state after a scene's changes, applied in the order they are written. */
export function transfer(before: State, scene: string, changes: readonly Change[]): State {
  let out: Map<string, Possible> | undefined
  for (const c of changes) {
    const e = effect(c, scene)
    if (!e) continue
    out ??= new Map(before)
    out.set(e[0], e[1](out.get(e[0]) ?? INITIAL))
  }
  return out ?? before
}

function samePossible(a: Possible, b: Possible): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const k of a.keys()) if (!b.has(k)) return false
  return true
}

/** What two paths' states say together: every fact has the values it has on either. */
export function join(states: readonly State[]): State {
  const [first] = states
  if (!first) return EMPTY
  if (states.length === 1) return first
  const names = new Set(states.flatMap((s) => [...s.keys()]))
  const out = new Map<string, Possible>()
  for (const name of names) {
    const all = states.map((s) => factsOf(s, name))
    if (all.every((p) => p === all[0])) {
      out.set(name, all[0]!)
      continue
    }
    const merged = new Map<string, Fact>()
    for (const p of all) for (const [k, f] of p) merged.set(k, f)
    out.set(name, merged)
  }
  return out
}

function sameState(a: State, b: State): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [name, p] of a) {
    const q = b.get(name)
    if (!q || !samePossible(p, q)) return false
  }
  return true
}

export interface FlowInput {
  /** Scene IDs in reading (outline) order. */
  order: readonly string[]
  /** The scenes that lead into each scene. */
  preds: ReadonlyMap<string, readonly string[]>
  /** Scenes the story can begin at: they start from the empty state. */
  entries: ReadonlySet<string>
  changes: (scene: string) => readonly Change[]
  /** False for a scene whose changes do not carry on to the scenes after it in reading order. */
  carries?: (scene: string) => boolean
}

export interface Flow {
  /** The state a scene starts from, and the state it leaves behind (its own changes included). */
  before: ReadonlyMap<string, State>
  after: ReadonlyMap<string, State>
}

/**
 * The fixed point: sweep the scenes in reading order, joining what reaches each one, until no
 * state changes. A straight story settles in one sweep; loops take a few more.
 */
export function runFlow(input: FlowInput): Flow {
  const { order, preds, entries } = input
  const at = new Map(order.map((id, i) => [id, i]))
  const succs = new Map<string, string[]>()
  for (const [id, ps] of preds) for (const p of ps) succs.set(p, [...(succs.get(p) ?? []), id])
  const before = new Map<string, State>()
  const after = new Map<string, State>()
  // What a scene hands on: its own state, or — for a scene whose changes are told out of turn — what came in.
  const leaving = new Map<string, State>()
  const dirty = order.map(() => true)
  // This stops: a fact's values come from a finite set (a value, and the scene that made it so), the
  // join only adds values and no change takes one away from what it is handed, so a scene's state can grow
  // only so many times. Nothing here gives up part way.
  for (let again = true; again;) {
    again = false
    for (const [i, id] of order.entries()) {
      if (!dirty[i]) continue
      dirty[i] = false
      const incoming = (preds.get(id) ?? []).flatMap((p) => leaving.get(p) ?? [])
      if (entries.has(id)) incoming.push(EMPTY)
      if (!incoming.length) continue // nothing has reached it yet
      const start = join(incoming)
      const old = before.get(id)
      if (old && sameState(old, start)) continue
      before.set(id, start)
      const end = transfer(start, id, input.changes(id))
      after.set(id, end)
      const out = input.carries?.(id) === false ? start : end
      const was = leaving.get(id)
      if (was && sameState(was, out)) continue
      leaving.set(id, out)
      for (const s of succs.get(id) ?? []) {
        dirty[at.get(s)!] = true
        again = true
      }
    }
  }
  return { before, after }
}

// ---- Questions to ask a state ------------------------------------------------------------

/** A person's status as it can be here: "" is alive and well (nothing has changed it). */
export const statusFacts = (state: State, who: string): Fact[] => [
  ...factsOf(state, attr.status(who)).values(),
]

/** Every way a fact can read here, for a state shown to the author. */
export interface Line {
  /** The words, an ID for a place or an item. */
  text: string
  /** The scene whose change made it so; absent when it is how things began. */
  since?: string
  /** True when it holds on every path that reaches this place. */
  every: boolean
}

function single(p: Possible, none = ''): Line[] {
  const values = new Map<string, Fact>()
  for (const f of p.values()) if (!values.has(f.value)) values.set(f.value, f)
  return [...values.values()]
    .filter((f) => f.value !== none || values.size === 1)
    .map((f) => ({ text: f.value, ...(f.at ? { since: f.at } : {}), every: values.size === 1 }))
}

export interface PersonState {
  status: Line[]
  condition: Line[]
  place: Line[]
  goal: Line[]
  holds: Line[]
  knows: Line[]
  traits: Line[]
  relations: { with: string; lines: Line[] }[]
}

/** What is true of one person at a place in the story. */
export function personState(state: State, who: string): PersonState {
  const out: PersonState = {
    status: single(factsOf(state, attr.status(who))),
    condition: single(factsOf(state, attr.condition(who))).filter((l) => l.text),
    place: single(factsOf(state, attr.place(who))).filter((l) => l.text),
    goal: single(factsOf(state, attr.goal(who))).filter((l) => l.text),
    holds: [],
    knows: [],
    traits: [],
    relations: [],
  }
  const own = (prefix: string) => `${prefix}:${who}:`
  for (const [name, p] of state) {
    if (name.startsWith('holders:')) {
      const facts = [...p.values()]
      const mine = facts.filter((f) => holdersOf(f.value).has(who))
      const since = mine[0] && holdersOf(mine[0].value).get(who)
      if (mine.length)
        out.holds.push({
          text: name.slice('holders:'.length),
          every: mine.length === facts.length,
          ...(since ? { since } : {}),
        })
    } else if (name.startsWith(own('knows')) || name.startsWith(own('trait'))) {
      const kind = name.startsWith('knows') ? 'knows' : 'traits'
      const yes = [...p.values()].find((f) => f.value === 'yes')
      if (yes)
        out[kind].push({
          text: name.slice(own('knows').length),
          every: !p.has(keyOf({ value: '', at: '' })),
          since: yes.at,
        })
    } else if (name.startsWith(own('relation'))) {
      const lines = single(p).filter((l) => l.text)
      if (lines.length) out.relations.push({ with: name.slice(own('relation').length), lines })
    }
  }
  return out
}

/** The holders of an item as they can be here: each a sorted list of person IDs. */
export const holderSets = (state: State, item: string): { who: string[]; at: string }[] =>
  [...factsOf(state, attr.holders(item)).values()].map((f) => ({
    who: [...holdersOf(f.value).keys()],
    at: f.at,
  }))
