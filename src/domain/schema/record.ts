// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { isId } from '../ids'
import { idOf, numberAsText, schemaVersion, storyTime } from './common'

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

// A pin on a place's map (ADR-0017): which place, and where on the picture, as fractions 0..1 of its width
// and height. Keys a later version adds to a pin are kept.
const fraction = z.number().transform((n) => Math.min(1, Math.max(0, n)))
export const pinSchema = z.looseObject({ place: idOf('wld', 'plc'), x: fraction, y: fraction })
// Written by hand, an entry may be wrong (an ID that is no place, a number that is not one): it is left out when
// read, never a reason to refuse the file. One pin per place: the first one stays.
const pins = z.array(z.unknown()).transform((list) => {
  const seen = new Set<string>()
  return list.flatMap((entry) => {
    const got = pinSchema.safeParse(entry)
    if (!got.success || seen.has(got.data.place)) return []
    seen.add(got.data.place)
    return [got.data]
  })
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
  'maxAge',
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
// A number written bare in YAML (`age: 34`, `maxAge: 700`) is read as the text it stands for.
const text = () => z.preprocess(numberAsText, z.string()).optional()
const textFields = Object.fromEntries(TEXT_FIELDS.map((k) => [k, text()])) as Record<
  TextField,
  ReturnType<typeof text>
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
  // When an event happens, and when a character was born: a story time in one of the universe's calendars.
  // Written by hand as words ("spring of 412"), they are left out when read, never a reason to refuse the file.
  time: storyTime.optional().catch(undefined),
  born: storyTime.optional().catch(undefined),
  // A picture of it: an imported image (`media/`), a portrait for a character.
  image: idOf('med').optional(),
  // The picture used as the map of a place or world (another image than `image`, the picture of it), and the
  // places pinned on it. A map that is not an image ID reads as none.
  map: idOf('med').optional().catch(undefined),
  pins: pins.optional().catch(undefined),
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
export type MapPin = z.infer<typeof pinSchema>
