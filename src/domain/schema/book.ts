// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { idOf, orderKey, schemaVersion } from './common'

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
  start: idOf('scn').optional(),
  outline: z.array(outlineEntry).optional(),
  dismissedFindings: z.array(z.string()).optional(),
  targets: z.looseObject({ words: z.number().int().nonnegative().optional() }).optional(),
})

export type Book = z.infer<typeof bookSchema>

// parts/prt_….md frontmatter
export const partSchema = z.looseObject({
  title: z.string(),
  schemaVersion,
  id: idOf('prt'),
  book: idOf('bok'),
  order: orderKey,
})

// chapters/chp_….md frontmatter — points to its part, or straight to the book.
export const chapterSchema = z.looseObject({
  title: z.string(),
  schemaVersion,
  id: idOf('chp'),
  book: idOf('bok'),
  part: idOf('prt').optional(),
  order: orderKey,
})

export type Part = z.infer<typeof partSchema>
export type Chapter = z.infer<typeof chapterSchema>
