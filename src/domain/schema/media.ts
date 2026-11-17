// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { idOf, schemaVersion } from './common'

/**
 * `media/med_….json`: what an author says about one imported image. The image itself sits beside
 * it as `med_….<original extension>`, exactly as it was imported (ADR-0003).
 */
export const mediaSchema = z.looseObject({
  schemaVersion,
  id: idOf('med'),
  /** The image file next to this one: `med_x.png`. */
  file: z.string().regex(/^med_\w+\.[a-z0-9]+$/),
  /** The file's own name when it was imported: what the author knows it by. */
  name: z.string().optional(),
  /** The kind of image the browser reported (`image/png`). */
  type: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  caption: z.string().optional(),
  credit: z.string().optional(),
})

export type Media = z.infer<typeof mediaSchema>
