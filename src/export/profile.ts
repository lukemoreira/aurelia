// SPDX-License-Identifier: AGPL-3.0-or-later
// Export profiles: named, saved settings for an export (ADR-0014). They live in one workspace file,
// `.aurelia/export-profiles.json`, so every book of the workspace can use them and a backup carries them.
import { z } from 'zod'
import { newId } from '@/domain/ids'
import { StorageError } from '@/storage/errors'

export const PROFILES_PATH = '.aurelia/export-profiles.json'
const PROFILES_VERSION = 1

export const FORMATS = ['markdown', 'docx', 'epub', 'pdf'] as const
export type ExportFormat = (typeof FORMATS)[number]

/** A language tag of the BCP 47 shape (`en`, `fr-CA`, `zh-Hant`): what `dc:language` and `xml:lang` need. */
export const isLanguage = (tag: string) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag.trim())
/** The tag, or English when it is not one: a file never carries a language a reading app cannot read. */
export const validLanguage = (tag: string) => (isLanguage(tag) ? tag.trim() : 'en')

const separator = z.enum(['stars', 'rule', 'space'])
const chapterTitles = z.enum(['none', 'title', 'numbered'])

// A setting that is missing or unreadable falls back to its default; a key this version does not know is kept.
const profileSchema = z.looseObject({
  id: z.string(),
  name: z.string().catch('Profile'),
  format: z.enum(FORMATS).catch('docx'),
  titlePage: z.boolean().catch(true),
  subtitle: z.string().catch(''),
  author: z.string().catch(''),
  chapterTitles: chapterTitles.catch('title'),
  sceneTitles: z.boolean().catch(false),
  separator: separator.catch('stars'),
  language: z.string().trim().refine(isLanguage).catch('en'),
  pageSize: z.enum(['letter', 'a4']).catch('letter'),
  font: z.enum(['serif', 'sans', 'mono']).catch('serif'),
  fontSize: z.number().min(8).max(20).catch(12),
  spacing: z.number().min(1).max(3).catch(1.5),
})
export type ExportProfile = z.infer<typeof profileSchema>

/** The profile every workspace has before anyone saves one: never written to the file until it is changed. */
export const DEFAULT_PROFILE_ID = 'standard'
export const DEFAULT_PROFILE: ExportProfile = {
  id: DEFAULT_PROFILE_ID,
  name: 'Standard',
  format: 'docx',
  titlePage: true,
  subtitle: '',
  author: '',
  chapterTitles: 'title',
  sceneTitles: false,
  separator: 'stars',
  language: 'en',
  pageSize: 'letter',
  font: 'serif',
  fontSize: 12,
  spacing: 1.5,
}

export const newProfileId = () => newId('exp')

/** A profile with every setting valid (what is missing is the default), whatever was handed in. */
export const readProfile = (raw: unknown): ExportProfile =>
  profileSchema.parse(typeof raw === 'object' && raw !== null ? raw : { id: newProfileId() })

interface ProfileFile {
  profiles: ExportProfile[]
  /** The file says it is from a newer Aurelia: it is read, never written. */
  newer: boolean
}

function parseFile(text: string | undefined): { root: Record<string, unknown>; newer: boolean } {
  if (text === undefined || !text.trim()) return { root: {}, newer: false }
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    throw new StorageError(
      'other',
      'Your saved export settings could not be read, so they were left as they are.',
    )
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root))
    throw new StorageError(
      'other',
      'Your saved export settings could not be read, so they were left as they are.',
    )
  // `profiles` is a list or it is not there: anything else is not ours to replace.
  const profiles = (root as { profiles?: unknown }).profiles
  if (profiles !== undefined && !Array.isArray(profiles))
    throw new StorageError(
      'other',
      'Your saved export settings could not be read, so they were left as they are.',
    )
  const version = (root as { schemaVersion?: unknown }).schemaVersion
  return {
    root: root as Record<string, unknown>,
    newer: typeof version === 'number' && version > PROFILES_VERSION,
  }
}

/** The entries of `profiles` as written, whatever they hold: a write puts one in and leaves the rest alone. */
const rawList = (root: Record<string, unknown>): unknown[] =>
  Array.isArray(root.profiles) ? root.profiles : []
const idOf = (entry: unknown) =>
  typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined
/** The entries a profile can be read from (they have an ID). */
const listOf = (root: Record<string, unknown>) =>
  rawList(root).filter((p): p is Record<string, unknown> => typeof idOf(p) === 'string')

/** The saved profiles, then the standard one when none is saved under its id. */
export function readProfiles(text: string | undefined): ProfileFile {
  const { root, newer } = parseFile(text)
  const saved = listOf(root).map((p) => readProfile(p))
  return {
    profiles: saved.some((p) => p.id === DEFAULT_PROFILE_ID) ? saved : [DEFAULT_PROFILE, ...saved],
    newer,
  }
}

const render = (root: Record<string, unknown>, profiles: unknown[]) =>
  `${JSON.stringify({ ...root, schemaVersion: PROFILES_VERSION, profiles }, null, 2)}\n`

/**
 * The file with this profile saved: added, or put over the one with its id. What the file holds
 * beyond that (other profiles as written, keys of its own, keys of a profile this version does not
 * know) is kept. A file that cannot be read, or is from a newer Aurelia, is refused, never replaced.
 */
export function withProfile(text: string | undefined, profile: ExportProfile): string {
  const { root, newer } = parseFile(text)
  if (newer)
    throw new StorageError(
      'other',
      'Your export settings were saved by a newer Aurelia. Update Aurelia to change them.',
    )
  const list = rawList(root)
  const at = list.findIndex((p) => idOf(p) === profile.id)
  const next =
    at < 0
      ? [...list, profile]
      : list.map((p, i) => (i === at ? { ...(p as object), ...profile } : p))
  return render(root, next)
}

/** The file without this profile (the standard profile is not in the file until saved, and cannot be lost). */
export function withoutProfile(text: string | undefined, id: string): string {
  const { root, newer } = parseFile(text)
  if (newer)
    throw new StorageError(
      'other',
      'Your export settings were saved by a newer Aurelia. Update Aurelia to change them.',
    )
  return render(
    root,
    rawList(root).filter((p) => idOf(p) !== id),
  )
}
