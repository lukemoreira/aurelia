// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { idOf, orderKey, progressStatus, schemaVersion } from './common'

const outlineEntry = z.looseObject({
  chapter: idOf('chp'),
  part: idOf('prt').optional(),
  scenes: z.array(idOf('scn')),
})

// book.json — the outline is a cache; scene frontmatter wins (ADR-0003 rule 3).
export const bookSchema = z.looseObject({
  title: z.string(),
  schemaVersion,
  id: idOf('bok'),
  mode: z.enum(['linear', 'branching']),
  status: z.string().optional(),
  summary: z.string().optional(),
  // The book's web address, as typed (a bare `example.com` is allowed: see website.ts), and images of the
  // media gallery, chosen like a record's `image`: its logo and cover art. Unchecked here, so a value of the
  // wrong kind never refuses the book: `bookWebsite`/`bookImage` read it as none, and it stays in the file.
  website: z.unknown().optional(),
  logo: z.unknown().optional(),
  cover: z.unknown().optional(),
  start: idOf('scn').optional(),
  outline: z.array(outlineEntry).optional(),
  dismissedFindings: z.array(z.string()).optional(),
  // Capitalised words the author said are not names, so the Names panel stops offering them (ADR-0010).
  notNames: z.array(z.string()).optional(),
  targets: z.looseObject({ words: z.number().int().nonnegative().optional() }).optional(),
  // The story base (ADR-0016): what grounds the book's lore. Its main characters are Character records.
  // Kept as written: a section that is not text reads as empty (story-base.ts) and is never dropped; only
  // a base that is not an object at all is left out, never a reason to refuse the book.
  storyBase: z.record(z.string(), z.unknown()).optional().catch(undefined),
})

export type Book = z.infer<typeof bookSchema>

/** The book's web address as typed, or none when `book.json` holds something that is not text. */
export const bookWebsite = (b: Pick<Book, 'website'>) =>
  typeof b.website === 'string' ? b.website : undefined

/** The gallery image a book names as its logo or cover, or none when the value is not an image ID. */
export const bookImage = (b: Pick<Book, 'logo' | 'cover'>, key: 'logo' | 'cover') => {
  const v = b[key]
  return idOf('med').safeParse(v).success ? (v as string) : undefined
}

// parts/prt_….md frontmatter
export const partSchema = z.looseObject({
  title: z.string(),
  schemaVersion,
  id: idOf('prt'),
  book: idOf('bok'),
  order: orderKey,
  status: progressStatus.optional(),
  summary: z.string().optional(),
})

// chapters/chp_….md frontmatter — points to its part, or straight to the book.
export const chapterSchema = z.looseObject({
  title: z.string(),
  schemaVersion,
  id: idOf('chp'),
  book: idOf('bok'),
  part: idOf('prt').optional(),
  order: orderKey,
  status: progressStatus.optional(),
  summary: z.string().optional(),
  objective: z.string().optional(),
  target: z.number().int().nonnegative().optional(),
  arcs: z.array(idOf('arc')).optional(),
})

export type Part = z.infer<typeof partSchema>
export type Chapter = z.infer<typeof chapterSchema>
