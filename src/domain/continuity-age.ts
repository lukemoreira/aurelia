// SPDX-License-Identifier: AGPL-3.0-or-later
// Age and dates (ADR-0006 §4): how old a character is at a scene, from the birth date on their sheet and
// the scene's story time, when both are known in one calendar. The checks and the progression read this
// one place. Plain TS.
import type { ContinuityModel, SceneInfo } from './continuity'
import { spanOf, yearsBetween, type Span } from './story-time'

/** What a character can live to when their sheet does not say: nobody is a hundred and fifty. */
export const DEFAULT_MAX_AGE = 120

/** When a character was born, as the span their sheet gives (undefined when it says nothing that reads). */
export function bornSpan(m: ContinuityModel, who: string): Span | undefined {
  const r = m.data.records.find((x) => x.meta.id === who)
  return r?.meta.born ? spanOf(r.meta.born) : undefined
}

/** The longest they can live as the sheet says it, in years ("1,000" is a thousand); undefined when it says nothing that reads. */
export function statedMaxAge(m: ContinuityModel, who: string): number | undefined {
  const raw = m.data.records.find((x) => x.meta.id === who)?.meta.maxAge ?? ''
  const n = Number.parseInt(raw.replace(/[,\s_]/g, ''), 10)
  return n > 0 ? n : undefined
}

/** The longest they can live: the sheet's figure, else the default. */
export const maxAgeOf = (m: ContinuityModel, who: string): number =>
  statedMaxAge(m, who) ?? DEFAULT_MAX_AGE

export interface Age {
  /** The youngest and the oldest they can be at the start and the end of the scene's time. */
  min: number
  max: number
}

/** Their age at a scene; undefined when either date is missing, in another calendar, or the scene is before the birth. */
export function ageAt(m: ContinuityModel, who: string, scene: SceneInfo): Age | undefined {
  const born = bornSpan(m, who)
  const at = scene.span
  if (!born || !at || born.calendar !== at.calendar) return undefined
  // youngest: born as late as the date allows, the scene at its start; oldest: the other way round
  const min = yearsBetween(born.hi, at.lo)
  const max = yearsBetween(born.lo, at.hi)
  return max < 0 ? undefined : { min: Math.max(0, min), max }
}

export const ageWords = (a: Age) => (a.min === a.max ? String(a.min) : `${a.min}–${a.max}`)
