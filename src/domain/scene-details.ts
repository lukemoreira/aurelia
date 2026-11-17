// SPDX-License-Identifier: AGPL-3.0-or-later
import { changeLabel, changeText } from './change-kinds'
import { sceneContext, sceneLabels } from './outline'
import type { Scene } from './schema/scene'
import { timeWords } from './story-time'
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

  const setupText = (id?: string) =>
    data.scenes.flatMap((s) => s.meta.changes ?? []).find((c) => c.kind === 'setup' && c.id === id)
      ?.value ?? ''
  const target = meta.target
  return {
    label: ctx.chapter.number === 0 ? String(ctx.index) : `${ctx.chapter.number}.${ctx.index}`,
    ...(meta.status ? { status: meta.status } : {}),
    ...(meta.pov && person(meta.pov) ? { pov: person(meta.pov)! } : {}),
    ...(meta.location ? { location: name(meta.location) } : {}),
    ...(meta.time
      ? {
          storyTime: timeWords(
            meta.time,
            data.universes.find((u) => u.books.includes(ctx.book.id))?.calendars,
          ),
        }
      : {}),
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
      kind: changeLabel(c.kind),
      text: changeText(c, name, setupText),
    })),
    choices: (meta.choices ?? []).map((c) => c.label),
  }
}

export interface ChoiceLine {
  id: string
  label: string
  /** Where it leads, as the story map names it: "1.2 · The Chapel". Absent when the scene is gone. */
  to?: string
}

/** A scene's choices as lines to read ("Follow the lights → 1.2 · The Chapel"), for the end of the page. */
export function choiceLines(data: WorkspaceData, sceneId: string): ChoiceLine[] {
  const scene = data.scenes.find((s) => s.meta.id === sceneId)
  const ctx = sceneContext(data, sceneId)
  if (!scene || !ctx) return []
  const refs = sceneLabels(data, ctx.book.id)
  return (scene.meta.choices ?? []).map((c) => {
    const target = data.scenes.find((s) => s.meta.id === c.target)
    const here = target && refs.has(target.meta.id)
    return {
      id: c.id,
      label: c.label,
      ...(here ? { to: `${refs.get(target.meta.id)} · ${target.meta.title}` } : {}),
    }
  })
}
