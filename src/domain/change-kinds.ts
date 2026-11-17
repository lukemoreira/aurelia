// SPDX-License-Identifier: AGPL-3.0-or-later
// What a scene can record as a change (ADR-0006 §1), in the author's words. The raw kind names
// (`relation`, `knows`) are stored in the file and never reach the screen.
import type { Scene } from './schema/scene'

export type Change = NonNullable<Scene['changes']>[number]

/** The kinds of ADR-0006 §1. A kind this version does not know is kept in the file and shown as "Change". */
export type ChangeKind =
  | 'status'
  | 'condition'
  | 'location'
  | 'knows'
  | 'relation'
  | 'holds'
  | 'loses'
  | 'trait'
  | 'goal'
  | 'beat'
  | 'setup'
  | 'payoff'

/** The label of a kind in a list of changes. A kind this version does not know is just "Change". */
export const CHANGE_LABEL: Record<ChangeKind, string> = {
  status: 'Status',
  condition: 'Condition',
  location: 'Goes to',
  knows: 'Learns',
  relation: 'Relationship',
  holds: 'Gains item',
  loses: 'Loses item',
  trait: 'Belief or trait',
  goal: 'Goal',
  beat: 'Arc moves on',
  setup: 'Set-up',
  payoff: 'Pay-off',
}

export const changeLabel = (kind: string): string =>
  (CHANGE_LABEL as Record<string, string>)[kind] ?? 'Change'

/** What a person's status can be. "gone" is someone who has left the story without dying. */
export const STATUSES = ['alive', 'dead', 'missing', 'gone'] as const
export type Status = (typeof STATUSES)[number]
export const STATUS_WORDS: Record<Status, string> = {
  alive: 'Alive',
  dead: 'Dead',
  missing: 'Missing',
  gone: 'Has left',
}
/** A status that ends a character's part in the story: they are not on the page after it. */
export const EXITS: ReadonlySet<string> = new Set<Status>(['dead', 'gone'])

/** What the "Add change" board offers (AddChange design), the way an author would say it. */
export type ChangePick =
  | 'relation'
  | 'knows'
  | 'condition'
  | 'item'
  | 'status'
  | 'location'
  | 'goal'
  | 'trait'
  | 'beat'
  | 'setup'
  | 'payoff'

export const CHANGE_PICKS: { value: ChangePick; label: string; hint: string }[] = [
  { value: 'relation', label: 'A relationship changes', hint: 'rival, ally, creditor…' },
  { value: 'knows', label: 'Learns something', hint: 'a secret, a truth' },
  { value: 'condition', label: 'Gets hurt or heals', hint: 'injury, illness' },
  { value: 'item', label: 'Gains or loses an item', hint: 'the key, a letter' },
  { value: 'status', label: 'Dies, leaves or returns', hint: 'off the page or back' },
  { value: 'location', label: 'Goes somewhere else', hint: 'a place other than the scene’s' },
  { value: 'goal', label: 'A goal changes', hint: 'wants, fears' },
  { value: 'trait', label: 'A belief or trait changes', hint: 'trusts, stops trusting' },
  { value: 'beat', label: 'An arc moves on', hint: 'a beat of a thread' },
  { value: 'setup', label: 'Sets something up', hint: 'a promise to the reader' },
  { value: 'payoff', label: 'Pays something off', hint: 'a promise kept' },
]

/** Which stored kind a pick writes (an item is `holds` or `loses`, chosen apart). */
export const kindOfPick = (pick: ChangePick, gains = true): ChangeKind =>
  pick === 'item' ? (gains ? 'holds' : 'loses') : pick

export const pickOfKind = (kind: string): ChangePick | undefined =>
  kind === 'holds' || kind === 'loses' ? 'item' : CHANGE_PICKS.find((p) => p.value === kind)?.value

/** The last part of "was → now": what a relationship is now. */
export const relationNow = (value: string | undefined): string =>
  (value ?? '').split('→').pop()?.trim() ?? ''

/** What is missing from a change, in the author's words; undefined when it can be saved. */
export function changeProblem(c: Change): string | undefined {
  const text = (c.value ?? '').trim()
  switch (c.kind) {
    case 'setup':
      return text ? undefined : 'Say what is being set up.'
    case 'payoff':
      return c.of ? undefined : 'Pick the set-up this pays off.'
    case 'beat':
      return !c.who
        ? 'Pick the arc that moves on.'
        : text
          ? undefined
          : 'Say what happens in this beat.'
    default:
      break
  }
  if (!c.who) return 'Pick who this is about.'
  switch (c.kind) {
    case 'status':
      return STATUSES.includes(text as Status) ? undefined : 'Pick what happens to them.'
    case 'location':
      return c.with ? undefined : 'Pick the place.'
    case 'holds':
    case 'loses':
      return c.item ? undefined : 'Pick the item.'
    case 'relation':
      return !c.with
        ? 'Pick who they feel this way about.'
        : text
          ? undefined
          : 'Say what it is now.'
    default:
      return text ? undefined : 'Say what changes.'
  }
}

/** A change as a sentence, with names in place of IDs: "Tomas sees Elena as creditor (was: stranger)". */
export function changeText(
  c: Change,
  name: (id?: string) => string,
  setupText: (id?: string) => string = () => '',
): string {
  const who = name(c.who)
  const value = (c.value ?? '').trim()
  switch (c.kind) {
    case 'relation': {
      const was = value.includes('→') ? value.split('→').slice(0, -1).join('→').trim() : ''
      return `${who} sees ${name(c.with)} as ${relationNow(value)}${was ? ` (was: ${was})` : ''}`
    }
    case 'status':
      return value === 'dead'
        ? `${who} dies`
        : value === 'gone'
          ? `${who} leaves the story`
          : value === 'missing'
            ? `${who} goes missing`
            : value === 'alive'
              ? `${who} returns`
              : `${who}: ${value}`
    case 'location':
      return `${who} goes to ${name(c.with)}`
    case 'holds':
      return `${who} gains ${name(c.item)}`
    case 'loses':
      return `${who} loses ${name(c.item)}`
    case 'beat':
      return `${who}: ${value}`
    case 'setup':
      return value
    case 'payoff':
      return `Pays off “${setupText(c.of)}”`
    case 'knows':
      return `${who} learns: ${value}`
    case 'goal':
      return `${who} now wants: ${value}`
    case 'condition':
    case 'trait':
      return `${who}: ${value}`
    default:
      return value
  }
}
