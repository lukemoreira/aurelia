// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { isId } from '../ids'
import { idOf, schemaVersion } from './common'

const RECORD_TYPES = [
  'character',
  'world',
  'place',
  'item',
  'event',
  'arc',
  'faction',
  'culture',
  'system',
  'lore',
  'research',
  'note',
] as const

// universe, or book:<id> (ADR-0002 §2).
const scope = z
  .string()
  .refine((v) => v === 'universe' || (v.startsWith('book:') && isId(v.slice(5), 'bok')), {
    message: 'Scope must be "universe" or "book:<book id>"',
  })

// A generic record's frontmatter (characters, places, items, lore, …).
export const recordSchema = z.looseObject({
  title: z.string(),
  schemaVersion,
  id: idOf('chr', 'wld', 'plc', 'itm', 'evt', 'arc', 'fac', 'cul', 'sys', 'lor', 'res', 'nte'),
  type: z.enum(RECORD_TYPES),
  scope,
  tags: z.array(z.string()).optional(),
})

export type RecordFrontmatter = z.infer<typeof recordSchema>
