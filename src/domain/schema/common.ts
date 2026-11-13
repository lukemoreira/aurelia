// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from 'zod'
import { type IdPrefix, isId } from '../ids'

export const CURRENT_SCHEMA_VERSION = 1

// Any version is a number; which ones are readable is decided by `migrate` alone.
export const schemaVersion = z.number().int().min(1)

export const idOf = (...prefixes: IdPrefix[]) =>
  z.string().refine((v) => (prefixes.length === 0 ? isId(v) : prefixes.some((p) => isId(v, p))), {
    message: prefixes.length === 0 ? 'Not an ID' : `Not an ID of kind ${prefixes.join(' or ')}`,
  })

// How far along a scene, chapter or part is.
export const progressStatus = z.enum(['idea', 'outline', 'draft', 'revised', 'final'])

// Fractional key that sorts within the parent, for example "a3".
export const orderKey = z.string().regex(/^[0-9A-Za-z]+$/, 'Not an order key')

// Story time: 412, 412-03, 412-03-14 or 412-03-14T18:00 (ADR-0003).
const timeKey = z.string().regex(/^\d+(-\d{2}(-\d{2}(T\d{2}:\d{2})?)?)?$/, 'Not a story time')

export const storyTime = z.looseObject({
  calendar: idOf('cal'),
  at: timeKey,
  until: timeKey.optional(),
  label: z.string().optional(),
})
