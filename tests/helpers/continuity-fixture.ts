// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Change } from '@/domain/change-kinds'
import { continuityModel, type ContinuityInput, type ContinuityModel } from '@/domain/continuity'
import { continuityFindings } from '@/domain/continuity-checks'
import { freshKeys } from '@/domain/order'
import type { Scene } from '@/domain/schema/scene'
import { validateWorkspaceData, type RecordDoc } from '@/domain/workspace-data'
import { sampleId } from '@/sample/ids'

/** What a test says of one scene; names are short keys, turned into IDs by `story`. */
export interface Sc {
  key: string
  /** The chapter, in order of first mention. Default "c1". */
  ch?: string
  pov?: string
  at?: string
  until?: string
  place?: string
  flashback?: boolean
  flashForward?: boolean
  /** People added to the scene, and people unticked from it. */
  add?: string[]
  remove?: string[]
  /** People the text names (what the index would find). */
  named?: string[]
  /** Changes, with keys in place of IDs: { who: 'ana', kind: 'status', value: 'dead' }. */
  changes?: Record<string, string>[]
  arcs?: string[]
  choices?: [label: string, target: string][]
  ending?: boolean
  words?: number
  target?: number
  broken?: { text: string; status: 'missing' | 'ambiguous' }[]
}

export interface Names {
  characters?: string[]
  places?: string[]
  items?: string[]
  arcs?: string[]
}

export const cal = sampleId('cal', 'test')
export const id = {
  scn: (k: string) => sampleId('scn', k),
  chr: (k: string) => sampleId('chr', k),
  plc: (k: string) => sampleId('plc', k),
  itm: (k: string) => sampleId('itm', k),
  arc: (k: string) => sampleId('arc', k),
  stp: (k: string) => sampleId('stp', k),
}

/** A change written with keys, as it is stored: `with` is a person or a place, by what the key is known as. */
function change(c: Record<string, string>): Change {
  const out: Record<string, string> = { ...c }
  const kind = c.kind
  if (c.who) out.who = kind === 'beat' ? id.arc(c.who) : id.chr(c.who)
  if (c.with) out.with = kind === 'location' ? id.plc(c.with) : id.chr(c.with)
  if (c.item) out.item = id.itm(c.item)
  if (kind === 'setup' && c.id) out.id = id.stp(c.id)
  if (kind === 'payoff' && c.of) out.of = id.stp(c.of)
  return out as Change
}

export function story(
  scenes: Sc[],
  opts: { mode?: 'linear' | 'branching'; start?: string; names?: Names } = {},
) {
  const names = { characters: [], places: [], items: [], arcs: [], ...opts.names }
  const bok = sampleId('bok', 'story')
  const unv = sampleId('unv', 'story')
  const chapters = Array.from(new Set(scenes.map((s) => s.ch ?? 'c1')))
  const keys = freshKeys(scenes.length)
  const chapterKeys = freshKeys(chapters.length)
  const record = (
    type: RecordDoc['meta']['type'],
    prefix: 'chr' | 'plc' | 'itm' | 'arc',
    key: string,
  ): RecordDoc => ({
    universe: unv,
    meta: { title: key, schemaVersion: 1, id: sampleId(prefix, key), type, scope: 'universe' },
  })
  const data = validateWorkspaceData({
    workspace: { schemaVersion: 1, id: sampleId('wsp', 'story'), name: 'Story', universes: [unv] },
    universes: [
      {
        title: 'U',
        schemaVersion: 1,
        id: unv,
        kind: 'standalone',
        books: [bok],
        calendars: [{ id: cal, name: 'Tide', months: ['Thaw', 'Bloom', 'Heat'], era: 'TR' }],
      },
    ],
    books: [
      {
        title: 'Story',
        schemaVersion: 1,
        id: bok,
        mode: opts.mode ?? 'linear',
        ...(opts.start ? { start: id.scn(opts.start) } : {}),
      },
    ],
    parts: [],
    chapters: chapters.map((c, i) => ({
      title: c,
      schemaVersion: 1,
      id: sampleId('chp', c),
      book: bok,
      order: chapterKeys[i]!,
    })),
    scenes: scenes.map((s, i) => {
      const meta: Scene = {
        title: s.key,
        schemaVersion: 1,
        id: id.scn(s.key),
        chapter: sampleId('chp', s.ch ?? 'c1'),
        order: keys[i]!,
        ...(s.pov ? { pov: id.chr(s.pov) } : {}),
        ...(s.place ? { location: id.plc(s.place) } : {}),
        ...(s.at
          ? { time: { calendar: cal, at: s.at, ...(s.until ? { until: s.until } : {}) } }
          : {}),
        ...(s.flashback ? { flashback: true } : {}),
        ...(s.flashForward ? { flashForward: true } : {}),
        ...(s.add || s.remove
          ? {
              characters: {
                ...(s.add ? { add: s.add.map(id.chr) } : {}),
                ...(s.remove ? { remove: s.remove.map(id.chr) } : {}),
              },
            }
          : {}),
        ...(s.arcs ? { arcs: s.arcs.map(id.arc) } : {}),
        ...(s.target ? { target: s.target } : {}),
        ...(s.ending ? { ending: true } : {}),
        ...(s.changes ? { changes: s.changes.map(change) } : {}),
        ...(s.choices
          ? {
              choices: s.choices.map(([label, target], n) => ({
                id: sampleId('chc', `${s.key}:${n}`),
                label,
                target: id.scn(target),
              })),
            }
          : {}),
      }
      return { meta, body: '', words: s.words ?? 100, book: bok }
    }),
    records: [
      ...names.characters.map((k) => record('character', 'chr', k)),
      ...names.places.map((k) => record('place', 'plc', k)),
      ...names.items.map((k) => record('item', 'itm', k)),
      ...names.arcs.map((k) => record('arc', 'arc', k)),
    ],
  })
  const bySceneKey = new Map<string, Sc>(scenes.map((s) => [id.scn(s.key), s]))
  const input: ContinuityInput = {
    data,
    bookId: bok,
    named: (sceneId) => (bySceneKey.get(sceneId)?.named ?? []).map(id.chr),
    brokenLinks: (sceneId) => bySceneKey.get(sceneId)?.broken ?? [],
  }
  const m: ContinuityModel = continuityModel(input)
  return { m, input, data, findings: () => continuityFindings(m) }
}
