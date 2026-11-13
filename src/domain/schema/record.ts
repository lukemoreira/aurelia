// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { isId } from '../ids'
import { idOf, schemaVersion } from './common'

export const RECORD_TYPES = [
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

// ADR-0010: another name a record goes by in the text, and whether it is tagged by itself.
export const MATCH_MODES = ['auto', 'ask', 'never'] as const
const alias = z.looseObject({ text: z.string(), match: z.enum(MATCH_MODES).optional() })

// A generic record's frontmatter (characters, places, items, lore, …).
export const recordSchema = z.looseObject({
  title: z.string(),
  schemaVersion,
  id: idOf('chr', 'wld', 'plc', 'itm', 'evt', 'arc', 'fac', 'cul', 'sys', 'lor', 'res', 'nte'),
  type: z.enum(RECORD_TYPES),
  scope,
  tags: z.array(z.string()).optional(),
  aliases: z.array(alias).optional(),
  summary: z.string().optional(),
  // The type's basic fields (see record-types.ts): plain text, all optional.
  role: z.string().optional(),
  kind: z.string().optional(),
  when: z.string().optional(),
  purpose: z.string().optional(),
})

export type RecordFrontmatter = z.infer<typeof recordSchema>
export type RecordType = RecordFrontmatter['type']
export type Alias = z.infer<typeof alias>
