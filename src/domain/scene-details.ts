// SPDX-License-Identifier: AGPL-3.0-or-later
import { sceneContext } from './outline'
import type { Scene } from './schema/scene'
import type { WorkspaceData } from './workspace-data'

const COLOURS = ['ember', 'tide', 'moss', 'plum'] as const
type ColourToken = (typeof COLOURS)[number]

interface Person {
  id: string
  name: string
  color?: ColourToken
  pov: boolean
  /** Set for someone who exists only in this book. */
  bookOnly: boolean
}
interface SceneDetails {
  /** "7.2" */
  label: string
  status?: NonNullable<Scene['status']>
  pov?: Person
  location?: string
  storyTime?: string
  words: number
  target?: number
  objective?: string
  conflict?: string
  outcome?: string
  people: Person[]
  arcs: { id: string; name: string; color?: ColourToken }[]
  changes: { kind: string; text: string }[]
  choices: string[]
}

export const colourOf = (record: { meta: object } | undefined): ColourToken | undefined => {
  const c = (record?.meta as { color?: unknown } | undefined)?.color
  return COLOURS.find((x) => x === c)
}

/** Plain words for a change; the raw kind names never reach the screen. */
const CHANGE_LABEL: Record<string, string> = {
  relation: 'Relationship',
  knows: 'Learns',
  setup: 'Set-up',
}

/** What the scene inspector shows, resolved from IDs to names. */
export function sceneDetails(data: WorkspaceData, sceneId: string): SceneDetails | undefined {
  const ctx = sceneContext(data, sceneId)
  if (!ctx) return undefined
  const meta = ctx.scene.meta
  const record = (id?: string) => data.records.find((r) => r.meta.id === id)
  const name = (id?: string) => record(id)?.meta.title ?? ''
  const person = (id: string): Person | undefined => {
    const r = record(id)
    if (!r) return undefined
    const color = colourOf(r)
    return {
      id,
      name: r.meta.title,
      ...(color ? { color } : {}),
      pov: id === meta.pov,
      bookOnly: r.meta.scope !== 'universe',
    }
  }
  const ids = [meta.pov, ...(meta.characters?.add ?? [])].filter((id): id is string => !!id)
  const people = Array.from(new Set(ids))
    .filter((id) => !(meta.characters?.remove ?? []).includes(id))
    .map(person)
    .filter((p): p is Person => !!p)

  const changeText = (c: NonNullable<typeof meta.changes>[number]) => {
    if (c.kind === 'relation') return `${name(c.who)} → ${name(c.with)}: ${c.value ?? ''}`
    if (c.kind === 'knows') return `${name(c.who)}: ${c.value ?? ''}`
    return c.value ?? ''
  }
  const target = meta.target
  return {
    label: `${ctx.chapter.number}.${ctx.index}`,
    ...(meta.status ? { status: meta.status } : {}),
    ...(meta.pov && person(meta.pov) ? { pov: person(meta.pov)! } : {}),
    ...(meta.location ? { location: name(meta.location) } : {}),
    ...(meta.time ? { storyTime: meta.time.label ?? meta.time.at } : {}),
    words: ctx.scene.words,
    ...(target ? { target } : {}),
    ...(meta.objective ? { objective: meta.objective } : {}),
    ...(meta.conflict ? { conflict: meta.conflict } : {}),
    ...(meta.outcome ? { outcome: meta.outcome } : {}),
    people,
    arcs: (meta.arcs ?? []).flatMap((id) => {
      const r = record(id)
      const color = colourOf(r)
      return r ? [{ id, name: r.meta.title, ...(color ? { color } : {}) }] : []
    }),
    changes: (meta.changes ?? []).map((c) => ({
      kind: CHANGE_LABEL[c.kind] ?? 'Change',
      text: changeText(c),
    })),
    choices: (meta.choices ?? []).map((c) => c.label),
  }
}
