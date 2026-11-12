// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { idOf, schemaVersion } from './common'

const calendarSchema = z.looseObject({ id: idOf('cal'), name: z.string() })

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
