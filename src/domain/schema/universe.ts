// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { idOf, schemaVersion } from './common'

// A named calendar. `months` and `era` only decide how a story time is written out ("14 Thaw 412 TR");
// the key itself (412-03-14) sorts the same in every calendar.
const calendarSchema = z.looseObject({
  id: idOf('cal'),
  name: z.string(),
  era: z.string().optional(),
  months: z.array(z.string()).optional(),
})

// universe.md frontmatter
export const universeSchema = z.looseObject({
  title: z.string(),
  schemaVersion,
  id: idOf('unv'),
  kind: z.enum(['shared', 'standalone']),
  books: z.array(idOf('bok')),
  calendars: z.array(calendarSchema).optional(),
})

export type Universe = z.infer<typeof universeSchema>
export type Calendar = z.infer<typeof calendarSchema>
