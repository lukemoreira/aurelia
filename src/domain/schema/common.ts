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

// Story time: 412, 412-03, 412-03-14 or 412-03-14T18:00; a minus sign puts the year before the epoch: -44 is 44 BCE (ADR-0003).
// A year written bare in YAML (`at: 412`, `at: -44`) reads as a number: it is taken as the key it means.
export const numberAsText = (v: unknown) => (typeof v === 'number' ? String(v) : v)
const timeKey = z.preprocess(
  numberAsText,
  z.string().regex(/^-?\d+(-\d{2}(-\d{2}(T\d{2}:\d{2})?)?)?$/, 'Not a story time'),
)

export const storyTime = z.looseObject({
  calendar: idOf('cal'),
  at: timeKey,
  until: timeKey.optional(),
  label: z.string().optional(),
})
