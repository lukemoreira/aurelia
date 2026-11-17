// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { storyRig } from '../../tests/helpers/story-rig'
import { inComponent } from '../../tests/helpers/in-component'
import { NEW_CALENDAR, useSceneTime } from './useSceneTime'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
beforeEach(() => localStorage.clear())

async function rig() {
  const r = await storyRig()
  const t = inComponent(() => useSceneTime(() => r.start))
  const scene = () => r.session.data.scenes.find((s) => s.meta.id === r.start)!.meta
  return { ...r, t, scene }
}

describe('a scene’s story time, as the inspector edits it', () => {
  it('makes a calendar on the spot, and saves the time in it as a key', async () => {
    const r = await rig()
    r.t.draft.calendar = NEW_CALENDAR
    r.t.draft.name = 'Tidal Reckoning'
    r.t.draft.era = 'TR'
    r.t.draft.at = '412-03-14 18:00'
    r.t.draft.label = ' Dusk '
    await r.t.save()
    const cal = r.session.data.universes[0]!.calendars![0]!
    expect(cal).toMatchObject({ name: 'Tidal Reckoning', era: 'TR' })
    expect(r.scene().time).toEqual({ calendar: cal.id, at: '412-03-14T18:00', label: 'Dusk' })
    expect(r.t.draft.calendar).toBe(cal.id)
    expect(r.t.error.value).toBe('')
    expect(r.t.granularity.value).toBe('Known to the minute')
  })

  it('says what is wrong, in words, and writes nothing: a time that does not read, no calendar, a calendar with no name', async () => {
    const r = await rig()
    r.t.draft.at = 'dusk'
    await r.t.save()
    expect(r.t.error.value).toBe(
      'That date is not complete. Fill the year first, then the month, day and time.',
    )
    // there is no year 0: refused in words, for the time and for its end, and nothing is written
    r.t.draft.at = '0'
    await r.t.save()
    expect(r.t.error.value).toContain('There is no year 0')
    r.t.draft.at = '412'
    r.t.draft.until = '0-03'
    await r.t.save()
    expect(r.t.error.value).toContain('There is no year 0')
    r.t.draft.until = ''
    r.t.draft.at = '412-03'
    await r.t.save()
    expect(r.t.error.value).toBe('Pick the calendar this time is in, or make a new one.')
    r.t.draft.calendar = NEW_CALENDAR
    await r.t.save()
    expect(r.t.error.value).toBe('Give the new calendar a name, then save the time.')
    expect(r.scene().time).toBeUndefined()
    expect(r.session.data.universes[0]!.calendars).toBeUndefined()
    expect(r.t.draft.at).toBe('412-03') // what was typed stays
  })

  it('marks a flashback from the select, and an empty time takes the time away', async () => {
    const r = await rig()
    r.t.draft.calendar = NEW_CALENDAR
    r.t.draft.name = 'Old Count'
    r.t.draft.at = '400'
    await r.t.save()
    r.t.pick('order', 'flashback')
    await vi.waitFor(() => expect(r.scene().flashback).toBe(true))
    r.t.draft.at = ''
    await r.t.save()
    expect(r.scene().time).toBeUndefined()
    expect(r.scene().flashback).toBe(true) // out of order on purpose, with or without a time
  })

  it('follows the file when it changes under it, but not over what is being typed', async () => {
    const r = await rig()
    await r.session.setFields(r.start, { time: { calendar: 'cal_aaaaaaaaaa', at: '412' } })
    await vi.waitFor(() => expect(r.t.draft.at).toBe('412'))
    r.t.draft.label = 'typing…'
    await r.session.setFields(r.start, { time: { calendar: 'cal_aaaaaaaaaa', at: '413' } })
    expect(r.t.draft.label).toBe('typing…')
  })

  it('a time typed with a space is the stored one with a T: it still follows a newer time from outside, and never overwrites it', async () => {
    const r = await rig()
    const calendar = 'cal_aaaaaaaaaa'
    await r.session.setFields(r.start, { time: { calendar, at: '412-03-14T18:00' } })
    await vi.waitFor(() => expect(r.t.draft.at).toBe('412-03-14T18:00'))
    r.t.draft.at = '412-03-14 18:00' // the same moment, as it is typed
    await r.session.setFields(r.start, { time: { calendar, at: '413-01-01T09:00' } })
    await vi.waitFor(() => expect(r.t.draft.at).toBe('413-01-01T09:00'))
    expect(r.scene().time?.at).toBe('413-01-01T09:00')
  })
})
