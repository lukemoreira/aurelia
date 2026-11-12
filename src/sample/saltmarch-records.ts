// SPDX-License-Identifier: AGPL-3.0-or-later
import type { RecordDoc } from '@/domain/workspace-data'
import { sampleId } from './ids'
import { arc, bok, chr, plc, unv } from './saltmarch-ids'

const rec = (
  id: string,
  type: RecordDoc['meta']['type'],
  title: string,
  extra: Record<string, unknown> = {},
  summary?: string,
  scope = 'universe',
): RecordDoc => ({
  meta: { title, schemaVersion: 1, id, type, scope, ...extra },
  universe: unv.saltmarch,
  ...(summary ? { summary } : {}),
})

export const records: RecordDoc[] = [
  rec(
    chr.elena,
    'character',
    'Elena Vasquez',
    { color: 'ember' },
    'Dockside courier, presumed drowned.',
  ),
  rec(
    chr.tomas,
    'character',
    'Tomas Brandt',
    { color: 'tide' },
    'Warden of the Lantern Gate. Keeps the curfew ledger and every debt in it.',
  ),
  rec(
    chr.mirela,
    'character',
    'Mirela Constantin',
    { color: 'moss' },
    'Chandler. Offers work, and a warning about the Guild.',
  ),
  rec(
    chr.corin,
    'character',
    'Corin Ashby',
    { color: 'plum' },
    'Surgeon’s apprentice who knows the old aqueduct.',
  ),
  rec(
    chr.lampBoy,
    'character',
    'Lamp boy',
    {},
    'Lights the arch lamps at dusk.',
    `book:${bok.lantern}`,
  ),
  rec(plc.gate, 'place', 'The Lantern Gate', {}, 'The only dry way into the Lantern Quarter.'),
  rec(plc.customs, 'place', 'The Customs House', {}, 'Where night cargo is counted.'),
  rec(
    sampleId('itm', 'ledger'),
    'item',
    'Tomas’s ledger',
    {},
    'The curfew ledger.',
    `book:${bok.lantern}`,
  ),
  rec(arc.debt, 'arc', 'The Debt', { color: 'ember' }),
  rec(arc.tide, 'arc', 'Rising Tide', { color: 'tide' }),
  rec(arc.letters, 'arc', 'The Letters', { color: 'moss' }),
]
