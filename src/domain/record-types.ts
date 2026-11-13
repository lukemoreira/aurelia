// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IdPrefix } from './ids'
import type { RecordType } from './schema/record'
import type { IconName } from './ui-names'

/** A basic field of a record: a key of the record's frontmatter, as plain text. */
interface BasicField {
  key: 'role' | 'kind' | 'when' | 'purpose'
  label: string
  hint: string
}

interface RecordTypeInfo {
  label: string
  icon: IconName
  /** The ID prefix a record of this type gets (ADR-0003 rule 2). */
  prefix: IdPrefix
  /** The folder it is kept in under `records/` (ADR-0003 layout). */
  folder: string
  fields: BasicField[]
}

/** The registry ADR-0002 §5 asks for: one place says what a type is called, drawn as, filed under and asked for. */
export const RECORD_INFO: Record<RecordType, RecordTypeInfo> = {
  character: {
    label: 'Character',
    icon: 'user',
    prefix: 'chr',
    folder: 'characters',
    fields: [{ key: 'role', label: 'Role in the story', hint: 'Protagonist, mentor, rival…' }],
  },
  place: {
    label: 'Place',
    icon: 'place',
    prefix: 'plc',
    folder: 'places',
    fields: [{ key: 'kind', label: 'Kind of place', hint: 'City, harbour, room…' }],
  },
  world: {
    label: 'World',
    icon: 'globe',
    prefix: 'wld',
    folder: 'worlds',
    fields: [{ key: 'kind', label: 'Kind of world', hint: 'Planet, realm, ship…' }],
  },
  item: {
    label: 'Item',
    icon: 'item',
    prefix: 'itm',
    folder: 'items',
    fields: [{ key: 'kind', label: 'Kind of item', hint: 'Key, letter, weapon…' }],
  },
  event: {
    label: 'Event',
    icon: 'event',
    prefix: 'evt',
    folder: 'events',
    fields: [{ key: 'when', label: 'When', hint: 'The spring tide of 412' }],
  },
  arc: {
    label: 'Arc',
    icon: 'arc',
    prefix: 'arc',
    folder: 'arcs',
    fields: [{ key: 'purpose', label: 'What it is for', hint: 'The question the story asks' }],
  },
  lore: { label: 'Lore', icon: 'lore', prefix: 'lor', folder: 'lore', fields: [] },
  faction: { label: 'Faction', icon: 'lore', prefix: 'fac', folder: 'factions', fields: [] },
  culture: { label: 'Culture', icon: 'lore', prefix: 'cul', folder: 'cultures', fields: [] },
  system: { label: 'System', icon: 'lore', prefix: 'sys', folder: 'systems', fields: [] },
  research: { label: 'Research', icon: 'research', prefix: 'res', folder: 'research', fields: [] },
  note: { label: 'Note', icon: 'lore', prefix: 'nte', folder: 'notes', fields: [] },
}

/** The types an author is offered when making a record (the rest still open and edit). */
export const NEW_RECORD_TYPES: RecordType[] = [
  'character',
  'place',
  'item',
  'event',
  'arc',
  'lore',
  'research',
]

/** The Library's groups, in the order the navigator and the World view list them. */
export const LIBRARY_GROUPS: { id: string; label: string; icon: IconName; types: RecordType[] }[] =
  [
    { id: 'characters', label: 'Characters', icon: 'user', types: ['character'] },
    { id: 'places', label: 'Worlds & places', icon: 'place', types: ['world', 'place'] },
    { id: 'items', label: 'Items', icon: 'item', types: ['item'] },
    { id: 'events', label: 'Events & timeline', icon: 'event', types: ['event'] },
    { id: 'arcs', label: 'Arcs', icon: 'arc', types: ['arc'] },
    { id: 'lore', label: 'Lore', icon: 'lore', types: ['lore', 'faction', 'culture', 'system'] },
    { id: 'research', label: 'Research', icon: 'research', types: ['research', 'note'] },
  ]
