// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Book, Chapter, Part } from '@/domain/schema/book'
import type { Scene } from '@/domain/schema/scene'
import type { Universe } from '@/domain/schema/universe'
import type { SceneDoc, WorkspaceData } from '@/domain/workspace-data'
import { sampleId } from './ids'
import { CURFEW_BELLS, placeholder } from './prose'
import { arc, bok, calendar, chr, plc, SAMPLE_START, unv, wsp } from './saltmarch-ids'
import { records } from './saltmarch-records'

export { SAMPLE_START }

const ord = (i: number) => String.fromCharCode(97 + i) // sorts as a, b, c…
const V = 1 as const

type SceneSpec = [
  title: string,
  status: Scene['status'],
  words: number,
  summary: string,
  pov?: string,
]
interface ChapterSpec {
  title: string
  number?: number
  scenes: SceneSpec[]
}

const parts: Part[] = []
const chapters: Chapter[] = []
const scenes: SceneDoc[] = []

function addBook(book: string, chapterSpecs: ChapterSpec[], partTitles: string[] = []) {
  const partIds = partTitles.map((title, i) => {
    const id = sampleId('prt', `${book}:part:${i}`)
    parts.push({ title, schemaVersion: V, id, book, order: ord(i) })
    return id
  })
  chapterSpecs.forEach((spec, i) => {
    const id = sampleId('chp', `${book}:${spec.title}`)
    const part = partIds[0]
    chapters.push({
      title: spec.title,
      schemaVersion: V,
      id,
      book,
      ...(part ? { part } : {}),
      order: ord(i),
      ...(spec.number ? { number: spec.number } : {}),
    })
    spec.scenes.forEach(([title, status, words, summary, pov], j) => {
      const sid = sampleId('scn', title.toLowerCase().replace(/[^a-z]+/g, '-'))
      scenes.push({
        meta: {
          title,
          schemaVersion: V,
          id: sid,
          chapter: id,
          order: ord(j),
          status,
          ...(pov ? { pov } : {}),
        },
        body: placeholder(summary),
        words,
      })
    })
  })
}

addBook(
  bok.lantern,
  [
    {
      title: 'The Drowned Ledger',
      number: 5,
      scenes: [
        [
          'Salt in the Ledger',
          'revised',
          1420,
          'Elena finds her father’s name in the drowned ledger.',
          chr.elena,
        ],
        [
          'The Chandler’s Daughter',
          'revised',
          1580,
          'Mirela offers work, and a warning about the Guild.',
          chr.elena,
        ],
        [
          'Low Water',
          'draft',
          1100,
          'Corin shows her the old aqueduct under the quarter.',
          chr.corin,
        ],
      ],
    },
    {
      title: 'Ropewalk',
      number: 6,
      scenes: [
        [
          'Ropewalk',
          'revised',
          1640,
          'Tomas hears that a drowned woman walks the quarter.',
          chr.tomas,
        ],
        ['Tar and Twine', 'draft', 1210, 'Elena trades a copy of the key for passage.', chr.elena],
        ['The Customs House', 'draft', 950, 'Tomas inspects the night cargo at dusk.', chr.tomas],
      ],
    },
    {
      title: 'The Lantern Gate',
      number: 7,
      scenes: [
        ['Tide Bell', 'revised', 1900, 'The bell rings early; the tide is wrong.', chr.elena],
        [
          'Curfew Bells',
          'draft',
          1240,
          'Elena gets through the gate, but owes the warden.',
          chr.elena,
        ],
        ['The Warden’s Price', 'idea', 0, 'He names the favour.', chr.elena],
      ],
    },
    {
      title: 'Salt in the Wound',
      number: 8,
      scenes: [
        ['Stitches', 'draft', 1300, 'Corin sews her hand and asks no questions.', chr.corin],
        ['Mirela’s Window', 'outline', 0, 'A light in the window that should be dark.', chr.elena],
      ],
    },
  ],
  ['Part One · Low Tide', 'Part Two · Slack Water'],
)
addBook(bok.tidebound, [
  {
    title: 'The Crossing',
    scenes: [['First Light', 'draft', 12400, 'The ferry leaves before dawn.']],
  },
])
addBook(bok.saltash, [
  {
    title: 'The Wreck',
    scenes: [
      ['Washed Ashore', 'final', 1400, 'You wake on the shingle with the wreck behind you.'],
      ['Follow the Lights', 'revised', 1100, 'Lamps move along the cliff path.'],
      ['Hide in the Wreck', 'draft', 980, 'The hull groans, and someone is climbing in.'],
    ],
  },
  {
    title: 'The Shore',
    scenes: [['Low Tide Road', 'draft', 900, 'The causeway shows for an hour.']],
  },
  { title: 'The Salt Chapel', scenes: [['The Chapel Door', 'outline', 0, 'It is not locked.']] },
  { title: 'Smugglers’ Stair', scenes: [['Two Hundred Steps', 'idea', 0, 'The stair goes down.']] },
])
addBook(bok.winter, [
  {
    title: 'The Frozen Harbour',
    scenes: [['First Frost', 'draft', 900, 'The harbour closes in a single night.']],
  },
])

// Curfew Bells carries the full set of fields the inspector shows.
const curfew = scenes.find((s) => s.meta.id === SAMPLE_START.scene)!
curfew.body = CURFEW_BELLS
curfew.meta = {
  ...curfew.meta,
  location: plc.gate,
  time: { calendar, at: '412-03-14T18:00', label: '14 Thaw 412 TR · Dusk' },
  objective: 'Get through the gate before curfew without being recognised.',
  conflict: 'The warden knows her face — and her father’s debt.',
  outcome: 'She gets in, but now owes him a favour.',
  characters: { add: [chr.tomas, chr.lampBoy] },
  arcs: [arc.debt, arc.tide],
  target: 1800,
  changes: [
    { kind: 'relation', who: chr.tomas, with: chr.elena, value: 'stranger → creditor' },
    { kind: 'setup', value: 'Elena owes the warden a favour' },
    { kind: 'knows', who: chr.tomas, value: 'Elena is alive' },
  ],
}
const ashore = scenes.find((s) => s.meta.title === 'Washed Ashore')!
const lights = scenes.find((s) => s.meta.title === 'Follow the Lights')!
const wreck = scenes.find((s) => s.meta.title === 'Hide in the Wreck')!
ashore.meta = {
  ...ashore.meta,
  choices: [
    { id: sampleId('chc', 'lights'), label: 'Follow the lights', target: lights.meta.id },
    { id: sampleId('chc', 'wreck'), label: 'Hide in the wreck', target: wreck.meta.id },
  ],
}

const universes: Universe[] = [
  {
    title: 'Saltmarch',
    schemaVersion: V,
    id: unv.saltmarch,
    kind: 'shared',
    books: [bok.lantern, bok.tidebound, bok.saltash],
    calendars: [{ id: calendar, name: 'Tidal Reckoning' }],
  },
  {
    title: 'The Long Winter of 1709',
    schemaVersion: V,
    id: unv.winter,
    kind: 'standalone',
    books: [bok.winter],
  },
]

const books: Book[] = [
  { title: 'The Lantern Gate', schemaVersion: V, id: bok.lantern, mode: 'linear', status: 'draft' },
  { title: 'Tidebound', schemaVersion: V, id: bok.tidebound, mode: 'linear', status: 'draft' },
  {
    title: 'Salt & Ash',
    schemaVersion: V,
    id: bok.saltash,
    mode: 'branching',
    start: ashore.meta.id,
  },
  {
    title: 'The Long Winter of 1709',
    schemaVersion: V,
    id: bok.winter,
    mode: 'linear',
    genre: 'history',
  },
]

/** The Saltmarch sample universe, built in memory. Real storage arrives in M2. */
export function saltmarchSample(): WorkspaceData {
  return {
    workspace: {
      schemaVersion: V,
      id: wsp,
      name: 'Sample workspace',
      universes: [unv.saltmarch, unv.winter],
    },
    universes,
    books,
    parts,
    chapters,
    scenes,
    records,
    startAt: SAMPLE_START,
  }
}
