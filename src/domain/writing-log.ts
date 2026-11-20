// SPDX-License-Identifier: AGPL-3.0-or-later
// The writing log: what each book held when a day began, so a day's words are worked out, never counted
// keystroke by keystroke. The file it is read from and written to is src/storage/writing-log.ts.

/** What one book held when it was first seen on a day (`at`: an ISO time). */
export interface DayStart {
  words: number
  at: string
}
export interface LogDay {
  /** The daily goal when the day was recorded; 0 is none. */
  goal: number
  start: Record<string, DayStart>
}
export interface WritingLog {
  /** The goal for each day; 0 is none. */
  dailyGoal: number
  days: Record<string, LogDay>
}
export const EMPTY_LOG: WritingLog = { dailyGoal: 0, days: {} }
/** The words of each book as they are now, by book ID. */
export type Totals = Record<string, number>

export const DAY = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')
/** A date on the device's own calendar: `YYYY-MM-DD`. */
export const localDay = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const dayBefore = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/** A whole number from what was typed ("90,000" is 90000); `undefined` when it is not one. Empty is 0. */
export function parseCount(raw: string): number | undefined {
  const text = raw.trim()
  if (!text) return 0
  const n = Number(text.replace(/[,\s]/g, ''))
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

/** The recorded days that hold a start, oldest first. */
const recordedDays = (log: WritingLog) =>
  Object.keys(log.days)
    .filter((d) => Object.keys(log.days[d]!.start).length > 0)
    .sort()

function wordsIn(log: WritingLog, recorded: string[], day: string, now: Totals): number {
  const start = log.days[day]?.start
  if (!start) return 0
  // Everything written until the next day was recorded is that day's; the last day runs to now.
  const next = recorded.find((d) => d > day)
  const end = next ? log.days[next]!.start : undefined
  let total = 0
  for (const [book, from] of Object.entries(start)) {
    const to = end ? end[book]?.words : now[book]
    if (to !== undefined) total += to - from.words
  }
  return Math.max(0, total)
}

/** Words written on a day, across books. A book that is gone, or was first seen later, adds nothing. Never below 0. */
export const wordsOn = (log: WritingLog, day: string, now: Totals) =>
  wordsIn(log, recordedDays(log), day, now)

/** Days in a row the goal was met (or, with no goal, something was written), back from today. Today counts once met. */
export function daysInARow(log: WritingLog, today: string, now: Totals): number {
  const recorded = recordedDays(log)
  const met = (day: string) => {
    const goal = log.days[day]?.goal ?? 0
    const words = wordsIn(log, recorded, day, now)
    return goal > 0 ? words >= goal : words > 0
  }
  let count = 0
  let day = today
  if (met(day)) count++
  day = dayBefore(day)
  while (met(day)) {
    count++
    day = dayBefore(day)
  }
  return count
}

/** The log as the app reads it: today's goal is what is set now. */
export const goalFor = (log: WritingLog, day: string) => log.days[day]?.goal ?? log.dailyGoal
