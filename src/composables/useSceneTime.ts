// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, reactive, ref, watch } from 'vue'
import { GRANULARITY_WORDS, parseTimeKey } from '@/domain/story-time'
import { wordsFor } from '@/storage/errors'
import { addCalendar, setSceneTime, type TimeOrder } from '@/storage/continuity-actions'
import { useWorkspaceStore } from '@/stores/workspace'
import { useOutlineEdits } from './useOutlineEdits'

/** The calendar select's value for "a calendar that does not exist yet". */
export const NEW_CALENDAR = '__new'

export const ORDER_OPTIONS: { value: TimeOrder; label: string }[] = [
  { value: 'normal', label: 'In order' },
  { value: 'flashback', label: 'Flashback' },
  { value: 'flash-forward', label: 'Flash-forward' },
]

const WRONG_KEY =
  'Write the time as a year, then the month, the day and the time, as far as you know it: 412, 412-03, 412-03-14 or 412-03-14 18:00.'

/** A key as typed (a space or a T before the clock) in the form it is stored in. */
const keyOf = (typed: string) => typed.trim().replace(/\s+/, 'T')

/**
 * A scene's story time (ADR-0003): a time in a calendar of the universe, as exact as the author
 * knows it, an optional end, a label ("dusk") and whether the scene is a flashback. Saved as each
 * field is left; an empty time takes the whole thing away. A calendar can be made on the spot.
 */
export function useSceneTime(sceneId: () => string | undefined) {
  const ws = useWorkspaceStore()
  const edit = useOutlineEdits()
  const error = ref('')
  const readOnly = computed(() => !edit.canEdit.value)
  const meta = computed(() => ws.data?.scenes.find((s) => s.meta.id === sceneId())?.meta)
  const calendars = computed(() => ws.universe?.calendars ?? [])
  const calendarOptions = computed(() => [
    ...calendars.value.map((c) => ({ value: c.id, label: c.name })),
    { value: NEW_CALENDAR, label: 'A new calendar…' },
  ])

  const storedOrder = (): TimeOrder =>
    meta.value?.flashback ? 'flashback' : meta.value?.flashForward ? 'flash-forward' : 'normal'
  const stored = () => ({
    calendar: meta.value?.time?.calendar ?? '',
    at: meta.value?.time?.at ?? '',
    until: meta.value?.time?.until ?? '',
    label: (meta.value?.time?.label ?? '').trim(),
    order: storedOrder(),
  })
  const draft = reactive({ ...stored(), name: '', era: '' })
  const mine = () =>
    JSON.stringify({
      calendar: draft.calendar,
      // as stored: a typed "412-03-14 18:00" is the stored "412-03-14T18:00", not something else typed
      at: keyOf(draft.at),
      until: keyOf(draft.until),
      label: draft.label.trim(),
      order: draft.order,
    })
  let lastStored = JSON.stringify(stored())
  // Another scene starts from its file. The files changing under what is shown (a save, another
  // device) is followed too, unless the author has typed something else since.
  watch(
    () => [sceneId(), JSON.stringify(stored())] as const,
    ([id, now], old) => {
      if (!old || id !== old[0]) {
        Object.assign(draft, stored(), { name: '', era: '' })
        error.value = ''
      } else if (mine() === lastStored) Object.assign(draft, stored())
      lastStored = now
    },
    { immediate: true },
  )

  /** A time needs a calendar to be read in: one chosen, or a new one with a name. */
  const ready = computed(
    () => !!draft.calendar && (draft.calendar !== NEW_CALENDAR || !!draft.name.trim()),
  )
  /** The month names of the chosen calendar, for the date picker. */
  const months = computed(() => calendars.value.find((c) => c.id === draft.calendar)?.months ?? [])
  const granularity = computed(() => {
    const k = draft.at.trim() ? parseTimeKey(keyOf(draft.at)) : undefined
    return k ? `Known to ${GRANULARITY_WORDS[k.granularity]}` : ''
  })

  async function save() {
    error.value = ''
    const id = sceneId()
    if (!ws.session || !id) return
    try {
      const at = keyOf(draft.at)
      const until = keyOf(draft.until)
      if (!at) {
        await setSceneTime(ws.session, id, null, draft.order)
        return
      }
      if (!parseTimeKey(at) || (until && !parseTimeKey(until))) {
        error.value = WRONG_KEY
        return
      }
      let calendar = draft.calendar
      if (calendar === NEW_CALENDAR) {
        if (!draft.name.trim() || !ws.universe) {
          error.value = 'Give the new calendar a name, then save the time.'
          return
        }
        calendar = await addCalendar(ws.session, ws.universe.id, {
          name: draft.name,
          era: draft.era,
        })
        draft.calendar = calendar
        draft.name = draft.era = ''
      } else if (!calendar) {
        error.value = 'Pick the calendar this time is in, or make a new one.'
        return
      }
      await setSceneTime(ws.session, id, { calendar, at, until, label: draft.label }, draft.order)
    } catch (e) {
      error.value = wordsFor(e) // what was typed stays, to be tried again
    }
  }
  /** A select was changed: save now. */
  const pick = (key: 'calendar' | 'order', value: string) => {
    ;(draft as Record<string, string>)[key] = value
    if (key === 'order' || (value !== NEW_CALENDAR && draft.at.trim())) void save()
  }

  return { draft, error, readOnly, calendarOptions, ready, months, granularity, save, pick }
}
