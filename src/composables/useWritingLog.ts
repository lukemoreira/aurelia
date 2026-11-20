// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { bookWords } from '@/domain/outline'
import {
  EMPTY_LOG,
  daysInARow,
  goalFor,
  localDay,
  parseCount,
  wordsOn,
  type DayStart,
  type Totals,
  type WritingLog,
} from '@/domain/writing-log'
import { wordsFor } from '@/storage/errors'
import { LOG_PATH, blockedError, readLog, withDailyGoal, withStarts } from '@/storage/writing-log'
import { useEditsStore } from '@/stores/edits'
import { useWorkspaceStore } from '@/stores/workspace'
import { isRecordOfStrings, usePersisted } from './usePersisted'

const TICK = 30_000
const TOAST_MS = 6_000

/**
 * Words written today and days in a row, from the workspace's writing log (src/storage/writing-log.ts).
 * The first time a book is seen on a date its total is recorded as that day's start; after that the log is
 * written only when a goal changes. With no files to write to (the sample, a read-only copy, a log that
 * cannot be read or is from a newer Aurelia, a failed write) the log is kept for this visit only.
 * Use it in one place: it watches the clock and the workspace.
 */
export function useWritingLog() {
  const ws = useWorkspaceStore()
  const edits = useEditsStore()
  const log = shallowRef<WritingLog>(EMPTY_LOG)
  const ready = ref(false)
  const today = ref(localDay(new Date()))
  /** Why goals are not being saved, in plain words; empty when they are. */
  const error = ref('')
  /** The log for this visit when it is not written to the file, and the file's last text. */
  let memory: string | undefined
  let lastText: string | undefined
  const offFile = ref(false)
  /** The day each workspace last showed the toast, on this device. */
  const lastToast = usePersisted<Record<string, string>>('goal-toasts', {}, isRecordOfStrings)

  const totals = computed<Totals>(() => {
    const data = ws.data
    return data ? Object.fromEntries(data.books.map((b) => [b.id, bookWords(data, b.id)])) : {}
  })
  const goal = computed(() => goalFor(log.value, today.value))
  const words = computed(() => wordsOn(log.value, today.value, totals.value, today.value))
  const streak = computed(() => daysInARow(log.value, today.value, totals.value))
  const met = computed(() => goal.value > 0 && words.value >= goal.value)
  const bookTotal = computed(() => (ws.bookId ? (totals.value[ws.bookId] ?? 0) : 0))

  const inFile = () => !!ws.session && !ws.view?.readOnly && !offFile.value

  /** Read the log again: from the file, or for a visit with none, from memory. */
  async function load() {
    const session = ws.session
    const file = session ? await session.adapter.read(LOG_PATH).catch(() => undefined) : undefined
    if (ws.session !== session) return
    const read = readLog(file?.text)
    lastText = read.blocked ? undefined : file?.text
    if (read.blocked) {
      offFile.value = true
      error.value = blockedError(read.blocked).message
    }
    if (inFile()) log.value = read.log
    else {
      memory ??= lastText
      log.value = readLog(memory).log
    }
    ready.value = true
  }

  /** Change the log: in the file as it is on disk now, else in memory. Returns false when it could not. */
  async function change(make: (text: string | undefined) => string): Promise<boolean> {
    error.value = ''
    try {
      if (inFile()) {
        // In the session's own turn: after an import or a restore that is still writing its files.
        await ws.session!.exclusive(() => ws.session!.writeDerived(LOG_PATH, make))
        await load()
      } else {
        memory = make(memory)
        log.value = readLog(memory).log
      }
      return true
    } catch (e) {
      error.value = wordsFor(e, 'Aurelia could not save your goals. They work until you close it.')
      if (inFile()) {
        offFile.value = true
        memory = lastText
        log.value = readLog(memory).log
      }
      return false
    }
  }

  let recording = false
  /** A book seen for the first time today is recorded at the words it holds when the write's turn comes. */
  async function record() {
    if (!ready.value || recording || !ws.data) return
    const day = today.value
    const have = log.value.days[day]?.start ?? {}
    if (Object.keys(totals.value).every((id) => id in have)) return
    recording = true
    const done = await change((text) => {
      const now = readLog(text).log
      const seen = now.days[day]?.start ?? {}
      const at = new Date().toISOString()
      const starts: Record<string, DayStart> = {}
      for (const [id, words] of Object.entries(totals.value))
        if (!(id in seen)) starts[id] = { words, at }
      return withStarts(text, day, goalFor(now, day), starts)
    }).finally(() => (recording = false))
    if (done) void record() // a book may have come while this was writing
  }

  /** Set the daily goal from what was typed; empty takes it away. */
  async function setDailyGoal(raw: string) {
    const n = parseCount(raw)
    if (n === undefined) {
      error.value = 'The daily goal is a whole number, like 500.'
      return
    }
    if (n !== goal.value) await change((text) => withDailyGoal(text, today.value, n))
  }

  // A new workspace starts from its own log, and so does a reconnected folder (a write that failed while
  // it was away left the goals in memory only).
  watch(
    [() => ws.session, () => ws.data?.workspace.id, () => !ws.view?.permissionLost],
    (now, old) => {
      if (old && now[2] === false && now[0] === old[0] && now[1] === old[1]) return // losing it changes nothing yet
      ready.value = false
      offFile.value = false
      memory = lastText = undefined
      error.value = ''
      if (ws.data) void load()
    },
    { immediate: true },
  )
  watch([totals, today, ready, log], record)

  // One calm toast a day for each workspace: when typing takes today's words up to the goal, never on
  // opening, on lowering the goal, when another device's log arrives, or on words nobody typed here.
  const sum = (t: Totals) => Object.values(t).reduce((n, w) => n + w, 0)
  watch([totals, () => ws.words.session], ([now, typed], [old, typedBefore]) => {
    const id = ws.data?.workspace.id
    if (!ready.value || !id || goal.value <= 0 || lastToast.value[id] === today.value) return
    if (typed <= typedBefore) return // a restored version, a sync or an outside change: not typed here
    const prior = wordsOn(log.value, today.value, old, today.value)
    if (prior >= goal.value || words.value < goal.value || sum(now) <= sum(old)) return
    lastToast.value = { ...lastToast.value, [id]: today.value }
    const toast = { text: 'You reached today’s goal.' }
    edits.toast = toast
    setTimeout(() => edits.toast === toast && (edits.toast = null), TOAST_MS)
  })

  // The date changes at midnight; another device may have written the log while this one was away.
  const refresh = () => {
    today.value = localDay(new Date())
    if (document.visibilityState === 'visible' && ready.value) void load()
  }
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    timer = setInterval(() => (today.value = localDay(new Date())), TICK)
    document.addEventListener('visibilitychange', refresh)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', refresh)
  })

  return { ready, goal, words, streak, met, bookTotal, error, setDailyGoal, load }
}

/** What the status bar and its popover read from `useWritingLog`. */
export type WritingLogState = ReturnType<typeof useWritingLog>
