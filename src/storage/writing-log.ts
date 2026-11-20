// SPDX-License-Identifier: AGPL-3.0-or-later
// The writing log file: `.aurelia/writing-log.json`, one for the workspace (every book, every device). It
// holds the daily goal and, for each day, what each book held when it was first seen. Written only when a
// start is recorded or a goal changes. A key this version does not know is kept; a file that cannot be
// read, or is from a newer Aurelia, is never written over.
import { z } from 'zod'
import { DAY, EMPTY_LOG, type DayStart, type WritingLog } from '@/domain/writing-log'
import { StorageError } from './errors'

export const LOG_PATH = '.aurelia/writing-log.json'
const LOG_VERSION = 1

const count = z.number().int().nonnegative()
const startSchema = z.looseObject({ words: count, at: z.string() })
/** Why a file that is not ours to write cannot be: goals still work until Aurelia is closed. */
export const blockedError = (why: 'newer' | 'unreadable') =>
  new StorageError(
    'other',
    why === 'newer'
      ? 'Your writing log was saved by a newer Aurelia. Update Aurelia to keep goals.'
      : 'Your writing log could not be read, so it was left as it is. Goals work until you close Aurelia.',
  )

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The file's root, or why it is not ours to write: `blocked` says so. */
function parseRoot(text: string | undefined): { root: Obj; blocked?: 'newer' | 'unreadable' } {
  if (text === undefined || !text.trim()) return { root: {} }
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return { root: {}, blocked: 'unreadable' }
  }
  if (!isObj(root) || (root.days !== undefined && !isObj(root.days)))
    return { root: {}, blocked: 'unreadable' }
  const version = root.schemaVersion
  if (typeof version === 'number' && version > LOG_VERSION) return { root, blocked: 'newer' }
  return { root }
}

/** The log in the file (what cannot be read is left out), and whether the file may be written. */
export function readLog(text: string | undefined): {
  log: WritingLog
  blocked?: 'newer' | 'unreadable'
} {
  const { root, blocked } = parseRoot(text)
  const goal = count.safeParse(root.dailyGoal)
  const log: WritingLog = { dailyGoal: goal.success ? goal.data : 0, days: {} }
  for (const [day, raw] of Object.entries(isObj(root.days) ? root.days : {})) {
    if (!DAY.test(day) || !isObj(raw)) continue
    const start: Record<string, DayStart> = {}
    for (const [book, s] of Object.entries(isObj(raw.start) ? raw.start : {})) {
      const parsed = startSchema.safeParse(s)
      if (parsed.success) start[book] = { words: parsed.data.words, at: parsed.data.at }
    }
    const dayGoal = count.safeParse(raw.goal)
    log.days[day] = { goal: dayGoal.success ? dayGoal.data : log.dailyGoal, start }
  }
  return { log: blocked === 'unreadable' ? EMPTY_LOG : log, blocked }
}

function editable(text: string | undefined) {
  const { root, blocked } = parseRoot(text)
  if (blocked) throw blockedError(blocked)
  return root
}
const render = (root: Obj, days: Obj) =>
  `${JSON.stringify({ ...root, schemaVersion: LOG_VERSION, days }, null, 2)}\n`
const dayOf = (days: Obj, day: string): Obj => (isObj(days[day]) ? { ...days[day] } : {})

/**
 * The file with these books' starts recorded for a day. A start already there stays unless this one was
 * recorded earlier (another device saw the book first), so two devices merge to the first sighting of each.
 */
export function withStarts(
  text: string | undefined,
  day: string,
  goal: number,
  starts: Record<string, DayStart>,
): string {
  const root = editable(text)
  const days = isObj(root.days) ? { ...root.days } : {}
  const entry = dayOf(days, day)
  const start: Obj = isObj(entry.start) ? { ...entry.start } : {}
  for (const [book, s] of Object.entries(starts)) {
    const had = startSchema.safeParse(start[book])
    if (!had.success || s.at < had.data.at)
      start[book] = { ...(isObj(start[book]) ? start[book] : {}), ...s }
  }
  days[day] = { ...entry, goal: count.safeParse(entry.goal).success ? entry.goal : goal, start }
  return render(root, days)
}

/** The file with a new daily goal, for today and from now on (earlier days keep theirs). */
export function withDailyGoal(text: string | undefined, day: string, goal: number): string {
  const root = editable(text)
  const days = isObj(root.days) ? { ...root.days } : {}
  days[day] = { ...dayOf(days, day), goal }
  return render({ ...root, dailyGoal: goal }, days)
}
