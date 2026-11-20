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
import { isString, usePersisted } from './usePersisted'

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
  const lastToast = usePersisted('goal-toast', '', isString)

  const totals = computed<Totals>(() => {
    const data = ws.data
    return data ? Object.fromEntries(data.books.map((b) => [b.id, bookWords(data, b.id)])) : {}
  })
  const goal = computed(() => goalFor(log.value, today.value))
  const words = computed(() => wordsOn(log.value, today.value, totals.value))
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
        await ws.session!.writeDerived(LOG_PATH, make)
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
  /** A book seen for the first time today is recorded at the words it holds now. */
  async function record() {
    if (!ready.value || recording || !ws.data) return
    const day = today.value
    const have = log.value.days[day]?.start ?? {}
    const fresh = Object.keys(totals.value).filter((id) => !(id in have))
    if (!fresh.length) return
    recording = true
    const at = new Date().toISOString()
    const starts: Record<string, DayStart> = Object.fromEntries(
      fresh.map((id) => [id, { words: totals.value[id] ?? 0, at }]),
    )
    const done = await change((text) =>
      withStarts(text, day, goalFor(log.value, day), starts),
    ).finally(() => (recording = false))
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

  // A new workspace starts from its own log.
  watch(
    () => [ws.session, ws.data?.workspace.id],
    () => {
      ready.value = false
      offFile.value = false
      memory = lastText = undefined
      error.value = ''
      if (ws.data) void load()
    },
    { immediate: true },
  )
  watch([totals, today, ready, log], record)

  // One calm toast, the first time each day's goal is reached while writing, never on opening.
  let before = false
  watch(ready, (r) => r && (before = met.value))
  watch(met, (now) => {
    if (ready.value && now && !before && lastToast.value !== today.value) {
      lastToast.value = today.value
      const toast = { text: 'You reached today’s goal.' }
      edits.toast = toast
      setTimeout(() => edits.toast === toast && (edits.toast = null), TOAST_MS)
    }
    before = now
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
