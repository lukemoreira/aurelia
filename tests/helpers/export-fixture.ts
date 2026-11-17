// SPDX-License-Identifier: AGPL-3.0-or-later
import { sampleId } from '@/sample/ids'
import { validateWorkspaceData, type WorkspaceData } from '@/domain/workspace-data'

export const ELENA = sampleId('chr', 'elena')
export const unv = sampleId('unv', 'x')
export const bok = sampleId('bok', 'x')
export const scn = (key: string) => sampleId('scn', key)

/** A scene's text with every part of the dialect an export has to carry. */
export const GATE_TEXT = [
  `The bells had *already* started when [[id:${ELENA}|Elena Vasquez]] reached the **Lantern Gate**,[^1] and ~~nobody~~ <u>everybody</u> knew [[Tomas]] was late. See [the map](https://example.com/map) or [bad](javascript:alert(1)).`,
  '',
  '> "Curfew," the warden said. ^blk-a1b2c3',
  '',
  "> [!note] Warden's rule",
  '> No lamps after dark.',
  '',
  '* * *',
  '',
  '- rope',
  '- lamp',
  '  - oil',
  '- [x] key',
  '',
  '3. third',
  '4. fourth',
  '',
  '| Item | Count |',
  '|:-----|------:|',
  '| Rope | 2 |',
  '| Lamp | 1 |',
  '',
  '```',
  'a <b>fenced</b> line [[Elena]]',
  '```',
  '',
  '<div>raw html stays words</div>',
  '',
  '[^1]: The gate was built in year 412.',
  '',
].join('\n')

export const BRIDGE_TEXT =
  'The bridge was *shorter* than she remembered.\n\nShe crossed it anyway.\n'

/** A small book: a part, two chapters, three scenes — one with all of the dialect — plus a branching pair. */
export function exportFixture(): WorkspaceData {
  const chp1 = sampleId('chp', 'one')
  const chp2 = sampleId('chp', 'two')
  const prt = sampleId('prt', 'one')
  const scene = (
    key: string,
    chapter: string,
    order: string,
    title: string,
    body: string,
    extra: Record<string, unknown> = {},
  ) => ({
    meta: { title, schemaVersion: 1, id: scn(key), chapter, order, ...extra },
    body,
    words: body.split(/\s+/).length,
    book: bok,
  })
  return validateWorkspaceData({
    workspace: { schemaVersion: 1, id: sampleId('wsp', 'x'), name: 'Saltmarch', universes: [unv] },
    universes: [
      { title: 'Saltmarch', schemaVersion: 1, id: unv, kind: 'standalone', books: [bok] },
    ],
    books: [{ title: 'The Lantern Gate', schemaVersion: 1, id: bok, mode: 'branching' }],
    parts: [{ title: 'Part One', schemaVersion: 1, id: prt, book: bok, order: 'a' }],
    chapters: [
      { title: 'Arrival', schemaVersion: 1, id: chp1, book: bok, part: prt, order: 'a' },
      { title: 'The Bridge', schemaVersion: 1, id: chp2, book: bok, part: prt, order: 'b' },
    ],
    scenes: [
      scene('gate', chp1, 'a', 'The Lantern Gate', GATE_TEXT, {
        choices: [
          { id: sampleId('chc', 'a'), label: 'Pay the warden’s price', target: scn('bridge') },
          { id: sampleId('chc', 'b'), label: 'Climb the aqueduct', target: scn('aqueduct') },
          { id: sampleId('chc', 'c'), label: 'Go back', target: sampleId('scn', 'nowhere') },
        ],
      }),
      scene('bridge', chp2, 'a', 'The Old Bridge', BRIDGE_TEXT, { ending: true }),
      scene('aqueduct', chp2, 'b', 'The Aqueduct', 'Wind, and a long way down.\n', {
        ending: true,
      }),
    ],
    records: [
      {
        meta: {
          title: 'Elena Vasquez',
          schemaVersion: 1,
          id: ELENA,
          type: 'character',
          scope: 'universe',
        },
        universe: unv,
      },
    ],
  })
}

export const PROFILE_BASE = {
  id: 'standard',
  name: 'Standard',
  format: 'docx' as const,
  titlePage: true,
  subtitle: 'A story',
  author: 'Ada Writer',
  chapterTitles: 'numbered' as const,
  sceneTitles: false,
  separator: 'stars' as const,
  language: 'en',
  pageSize: 'letter' as const,
  font: 'serif' as const,
  fontSize: 12,
  spacing: 1.5,
}
