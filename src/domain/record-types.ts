// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IdPrefix } from './ids'
import type { RecordType, TextField } from './schema/record'
import type { IconName } from './ui-names'

/** The tabs of a record's sheet: each type shows the ones it has fields or lists for. */
export type SheetTab =
  'overview' | 'progression' | 'relationships' | 'appearances' | 'voice' | 'senses' | 'sources'

/** A basic field of a record: a key of the record's frontmatter, as plain text. */
export interface BasicField {
  key: TextField
  label: string
  hint: string
  /** The tab it is on (default: overview), and the heading above it when it starts a group. */
  tab?: SheetTab
  group?: string
  /** A longer answer: a taller box. */
  long?: boolean
}

interface RecordTypeInfo {
  label: string
  icon: IconName
  /** The ID prefix a record of this type gets (ADR-0003 rule 2). */
  prefix: IdPrefix
  /** The folder it is kept in under `records/` (ADR-0003 layout). */
  folder: string
  fields: BasicField[]
  /** Tabs beyond the overview and the notes, in the order shown. */
  tabs?: SheetTab[]
}

/** The five senses, asked of a place or a world on the Senses tab. */
const SENSES: BasicField[] = [
  {
    key: 'sight',
    label: 'What you see',
    hint: 'Light, colours, shapes',
    tab: 'senses',
    long: true,
  },
  {
    key: 'sound',
    label: 'What you hear',
    hint: 'Voices, machines, weather',
    tab: 'senses',
    long: true,
  },
  {
    key: 'smell',
    label: 'What you smell',
    hint: 'Air, food, smoke, sea',
    tab: 'senses',
    long: true,
  },
  { key: 'touch', label: 'What you feel', hint: 'Heat, damp, surfaces', tab: 'senses', long: true },
  {
    key: 'taste',
    label: 'What you taste',
    hint: 'In the air, in the food',
    tab: 'senses',
    long: true,
  },
]

const kind = (label: string, hint: string): BasicField => ({ key: 'kind', label, hint })

/** The registry ADR-0002 §5 asks for: one place says what a type is called, drawn as, filed under and asked for. */
export const RECORD_INFO: Record<RecordType, RecordTypeInfo> = {
  character: {
    label: 'Character',
    icon: 'user',
    prefix: 'chr',
    folder: 'characters',
    tabs: ['progression', 'relationships', 'appearances', 'voice'],
    fields: [
      {
        key: 'role',
        label: 'Role in the story',
        hint: 'Protagonist, mentor, rival…',
        group: 'Who they are',
      },
      { key: 'age', label: 'Age', hint: '34, or “in her forties”' },
      {
        key: 'maxAge',
        label: 'Longest they could live',
        hint: 'In years. Blank means 120; an elf might say 700',
      },
      {
        key: 'appearance',
        label: 'What they look like',
        hint: 'What someone sees first',
        long: true,
      },
      {
        key: 'background',
        label: 'Where they come from',
        hint: 'Family, home, what shaped them',
        long: true,
      },
      {
        key: 'goal',
        label: 'What they want',
        hint: 'The thing they would act for',
        group: 'Inner life',
        long: true,
      },
      { key: 'fear', label: 'What they are afraid of', hint: 'What they avoid', long: true },
      { key: 'flaw', label: 'Their flaw', hint: 'What gets in their way', long: true },
      { key: 'belief', label: 'What they believe', hint: 'The rule they live by', long: true },
      { key: 'secret', label: 'A secret', hint: 'What they hide from others', long: true },
      {
        key: 'voice',
        label: 'How they speak',
        hint: 'Rhythm, words, habits',
        tab: 'voice',
        long: true,
      },
      {
        key: 'sample',
        label: 'A line they would say',
        hint: 'One sentence in their voice',
        tab: 'voice',
        long: true,
      },
    ],
  },
  place: {
    label: 'Place',
    icon: 'place',
    prefix: 'plc',
    folder: 'places',
    tabs: ['senses'],
    fields: [
      kind('Kind of place', 'Planet, country, city, harbour, room… (you choose the levels)'),
      ...SENSES,
    ],
  },
  world: {
    label: 'World',
    icon: 'globe',
    prefix: 'wld',
    folder: 'worlds',
    tabs: ['senses'],
    fields: [kind('Kind of world', 'Planet, realm, ship…'), ...SENSES],
  },
  item: {
    label: 'Item',
    icon: 'item',
    prefix: 'itm',
    folder: 'items',
    fields: [
      kind('Kind of item', 'Key, letter, weapon…'),
      {
        key: 'significance',
        label: 'Why it matters',
        hint: 'What the story does with it',
        long: true,
      },
    ],
  },
  event: {
    label: 'Event',
    icon: 'event',
    prefix: 'evt',
    folder: 'events',
    fields: [
      { key: 'when', label: 'When', hint: 'The spring tide of 412' },
      { key: 'where', label: 'Where', hint: 'The Lantern Gate' },
      { key: 'outcome', label: 'What changed', hint: 'What was different afterwards', long: true },
    ],
  },
  arc: {
    label: 'Arc',
    icon: 'arc',
    prefix: 'arc',
    folder: 'arcs',
    fields: [{ key: 'purpose', label: 'What it is for', hint: 'The question the story asks' }],
  },
  lore: {
    label: 'Lore',
    icon: 'lore',
    prefix: 'lor',
    folder: 'lore',
    fields: [kind('Kind of lore', 'Myth, law, legend, custom…')],
  },
  faction: {
    label: 'Faction',
    icon: 'lore',
    prefix: 'fac',
    folder: 'factions',
    fields: [
      kind('Kind of group', 'Guild, house, army, order…'),
      { key: 'leader', label: 'Who leads it', hint: 'A name, or how it is led' },
      { key: 'goal', label: 'What it wants', hint: 'Its aim, spoken or not', long: true },
    ],
  },
  culture: {
    label: 'Culture',
    icon: 'lore',
    prefix: 'cul',
    folder: 'cultures',
    fields: [
      { key: 'region', label: 'Where they live', hint: 'A place, or a way of life' },
      { key: 'language', label: 'Language', hint: 'What they speak, how it sounds' },
      { key: 'customs', label: 'Customs', hint: 'Food, manners, festivals, taboos', long: true },
    ],
  },
  system: {
    label: 'System',
    icon: 'lore',
    prefix: 'sys',
    folder: 'systems',
    fields: [
      kind('Kind of system', 'Magic, technology, law…'),
      { key: 'rules', label: 'How it works', hint: 'The rules, in plain words', long: true },
      { key: 'limits', label: 'Its limits and cost', hint: 'What it cannot do', long: true },
    ],
  },
  research: {
    label: 'Research',
    icon: 'research',
    prefix: 'res',
    folder: 'research',
    tabs: ['sources'],
    fields: [{ key: 'topic', label: 'Topic', hint: 'What you are finding out' }],
  },
  note: { label: 'Note', icon: 'lore', prefix: 'nte', folder: 'notes', fields: [] },
}

/** The types an author is offered when making a record (the rest still open and edit). */
export const NEW_RECORD_TYPES: RecordType[] = [
  'character',
  'place',
  'world',
  'item',
  'event',
  'arc',
  'faction',
  'culture',
  'system',
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
