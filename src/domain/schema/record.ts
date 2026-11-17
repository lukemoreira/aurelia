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
export type MatchMode = (typeof MATCH_MODES)[number]
const alias = z.looseObject({ text: z.string(), match: z.enum(MATCH_MODES).optional() })

// A relationship to another record, stored on the record that lists it (shown on both).
const relationship = z.looseObject({
  with: idOf('chr', 'wld', 'plc', 'itm', 'evt', 'arc', 'fac', 'cul', 'sys', 'lor', 'res', 'nte'),
  type: z.string(),
})
// A source a research note stands on.
const source = z.looseObject({
  title: z.string(),
  author: z.string().optional(),
  url: z.string().optional(),
  note: z.string().optional(),
})

/**
 * The plain-text fields of the sheets (record-types.ts says which type asks for which). All
 * optional; a record of any type may carry any of them, and keys this list does not know are kept.
 */
export const TEXT_FIELDS = [
  'role',
  'kind',
  'when',
  'purpose',
  'age',
  'appearance',
  'background',
  'goal',
  'fear',
  'flaw',
  'belief',
  'secret',
  'voice',
  'sample',
  'sight',
  'sound',
  'smell',
  'touch',
  'taste',
  'significance',
  'where',
  'outcome',
  'topic',
  'leader',
  'region',
  'customs',
  'language',
  'rules',
  'limits',
] as const
export type TextField = (typeof TEXT_FIELDS)[number]
const textFields = Object.fromEntries(TEXT_FIELDS.map((k) => [k, z.string().optional()])) as Record<
  TextField,
  z.ZodOptional<z.ZodString>
>

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
  ...textFields,
  // A picture of it: an imported image (`media/`), a portrait for a character.
  image: idOf('med').optional(),
  // A place or world sits inside another one (planet → country → city → room).
  parent: idOf('wld', 'plc').optional(),
  relationships: z.array(relationship).optional(),
  sources: z.array(source).optional(),
})

export type RecordFrontmatter = z.infer<typeof recordSchema>
export type RecordType = RecordFrontmatter['type']
export type Alias = z.infer<typeof alias>
export type Relationship = z.infer<typeof relationship>
export type Source = z.infer<typeof source>
