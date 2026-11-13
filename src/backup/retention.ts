// SPDX-License-Identifier: AGPL-3.0-or-later

export interface VersionStamp {
  name: string
  at: Date
  /** Saved before a big change: kept as it is for 30 days, whatever the hour. */
  protectedFor30Days?: boolean
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Which tier a version of this age is in, and which slot of that tier it takes. */
function slot(at: Date, age: number): string {
  const day = Math.floor(at.getTime() / DAY)
  if (age < 2 * DAY) return `hour:${Math.floor(at.getTime() / HOUR)}`
  if (age < 30 * DAY) return `day:${day}`
  // Weeks start on Monday; 1 January 1970 was a Thursday.
  if (age < 183 * DAY) return `week:${Math.floor((day + 3) / 7)}`
  return `month:${at.getUTCFullYear() * 12 + at.getUTCMonth()}`
}

/**
 * The versions to remove (ADR-0009): hourly for 2 days, daily for 30 days, weekly for 6 months,
 * monthly for ever. In each slot the newest version stays; the newest version overall always does.
 */
export function versionsToDelete(versions: VersionStamp[], now: Date): string[] {
  const keep = new Set<string>()
  const newest = new Map<string, VersionStamp>()
  for (const v of versions) {
    const age = now.getTime() - v.at.getTime()
    if (v.protectedFor30Days && age < 30 * DAY) keep.add(v.name)
    const key = slot(v.at, age)
    const best = newest.get(key)
    if (!best || v.at > best.at) newest.set(key, v)
  }
  for (const v of newest.values()) keep.add(v.name)
  return versions.filter((v) => !keep.has(v.name)).map((v) => v.name)
}
