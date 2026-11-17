// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch } from 'vue'
import { GRANULARITY_WORDS, parseTimeKey, timeKeyProblem } from '@/domain/story-time'
import { wordsFor } from '@/storage/errors'
import { addCalendar, setRecordTime } from '@/storage/continuity-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { useOutlineEdits } from './useOutlineEdits'
import { NEW_CALENDAR, keyOf } from './useSceneTime'

/**
 * A date on a sheet: when an event happens, or when a character was born. A time in a calendar of the
 * universe, as exact as the author knows it; saved as each part is left, and an empty one takes the whole
 * date away. A calendar can be made on the spot (as for a scene).
 */
export function useRecordTime(idOf: () => string, key: 'time' | 'born') {
  const ws = useWorkspaceStore()
  const edit = useOutlineEdits()
  const error = ref('')
  const readOnly = computed(() => !edit.canEdit.value)
  const record = computed(() => ws.data?.records.find((r) => r.meta.id === idOf())?.meta)
  const calendars = computed(() => ws.universe?.calendars ?? [])
  const calendarOptions = computed(() => [
    ...calendars.value.map((c) => ({ value: c.id, label: c.name })),
    { value: NEW_CALENDAR, label: 'A new calendar…' },
  ])
  const stored = () => ({
    calendar: record.value?.[key]?.calendar ?? '',
    at: record.value?.[key]?.at ?? '',
    label: (record.value?.[key]?.label ?? '').trim(),
  })
  const draft = reactive({ ...stored(), name: '', era: '' })
  const mine = () =>
    JSON.stringify({ calendar: draft.calendar, at: keyOf(draft.at), label: draft.label.trim() })
  let lastStored = JSON.stringify(stored())
  // Another record starts from its file; the file changing under what is shown is followed too, unless the author has typed since.
  watch(
    () => [idOf(), JSON.stringify(stored())] as const,
    ([id, now], old) => {
      if (!old || id !== old[0]) {
        Object.assign(draft, stored(), { name: '', era: '' })
        error.value = ''
      } else if (mine() === lastStored) Object.assign(draft, stored())
      lastStored = now
    },
    { immediate: true },
  )

  const ready = computed(
    () => !!draft.calendar && (draft.calendar !== NEW_CALENDAR || !!draft.name.trim()),
  )
  const months = computed(() => calendars.value.find((c) => c.id === draft.calendar)?.months ?? [])
  const era = computed(() =>
    draft.calendar === NEW_CALENDAR
      ? draft.era
      : calendars.value.find((c) => c.id === draft.calendar)?.era,
  )
  const granularity = computed(() => {
    const k = draft.at.trim() ? parseTimeKey(keyOf(draft.at)) : undefined
    return k ? `Known to ${GRANULARITY_WORDS[k.granularity]}` : ''
  })

  async function save() {
    error.value = ''
    const id = idOf()
    if (!ws.session || !id) return
    try {
      const at = keyOf(draft.at)
      if (!at) return void (await setRecordTime(ws.session, id, key, null))
      const problem = timeKeyProblem(at)
      if (problem) {
        error.value = problem
        return
      }
      let calendar = draft.calendar
      if (calendar === NEW_CALENDAR) {
        if (!draft.name.trim() || !ws.universe) {
          error.value = 'Give the new calendar a name, then save the date.'
          return
        }
        calendar = await addCalendar(ws.session, ws.universe.id, {
          name: draft.name,
          era: draft.era,
        })
        draft.calendar = calendar
        draft.name = draft.era = ''
      } else if (!calendar) {
        error.value = 'Pick the calendar this date is in, or make a new one.'
        return
      }
      await setRecordTime(ws.session, id, key, { calendar, at, label: draft.label })
    } catch (e) {
      error.value = wordsFor(e) // what was typed stays, to be tried again
    }
  }
  /** The calendar was chosen: save now if there is a date to save. */
  const pick = (calendar: string) => {
    draft.calendar = calendar
    if (calendar !== NEW_CALENDAR && draft.at.trim()) void save()
  }

  return { draft, error, readOnly, calendarOptions, ready, months, era, granularity, save, pick }
}
