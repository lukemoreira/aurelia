// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { isId } from '@/domain/ids'
import {
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_ID,
  newProfileId,
  readProfile,
  readProfiles,
  withProfile,
  withoutProfile,
} from './profile'

describe('readProfile', () => {
  it('gives every setting a valid value: what is missing or wrong is the default', () => {
    const p = readProfile({
      id: 'exp_a',
      name: 'Mine',
      format: 'rtf',
      fontSize: 400,
      spacing: 'wide',
    })
    expect(p).toMatchObject({
      id: 'exp_a',
      name: 'Mine',
      format: 'docx',
      fontSize: 12,
      spacing: 1.5,
      chapterTitles: 'title',
      separator: 'stars',
    })
  })

  it('keeps a setting this version does not know', () => {
    expect(readProfile({ id: 'exp_a', future: { a: 1 } })).toMatchObject({ future: { a: 1 } })
  })

  it('makes profile IDs of the one kind of ID', () => {
    expect(isId(newProfileId(), 'exp')).toBe(true)
  })
})

describe('the profile file', () => {
  it('offers the standard profile first when none is saved, and before any file exists', () => {
    expect(readProfiles(undefined).profiles).toEqual([DEFAULT_PROFILE])
    expect(readProfiles('{"schemaVersion":1,"profiles":[]}').profiles).toEqual([DEFAULT_PROFILE])
  })

  it('saves a profile, with a schema version, and reads it back', () => {
    const text = withProfile(undefined, {
      ...DEFAULT_PROFILE,
      id: 'exp_a',
      name: 'Agent',
      format: 'epub',
    })
    expect(JSON.parse(text)).toMatchObject({ schemaVersion: 1, profiles: [{ id: 'exp_a' }] })
    expect(readProfiles(text).profiles.map((p) => p.name)).toEqual(['Standard', 'Agent'])
  })

  it('puts a saved profile over the one with its ID and keeps the keys it does not know', () => {
    const first = withProfile(undefined, { ...DEFAULT_PROFILE, id: 'exp_a', name: 'Agent' })
    const edited = first.replace('"name": "Agent"', '"name": "Agent", "future": 7')
    const next = withProfile(edited, { ...DEFAULT_PROFILE, id: 'exp_a', name: 'Agent v2' })
    const [saved] = JSON.parse(next).profiles
    expect(saved).toMatchObject({ id: 'exp_a', name: 'Agent v2', future: 7 })
    expect(JSON.parse(next).profiles).toHaveLength(1)
  })

  it('keeps a profile it did not touch exactly as written, and the file’s own keys', () => {
    const file = JSON.stringify({
      schemaVersion: 1,
      note: 'mine',
      profiles: [{ id: 'exp_x', name: 'Old', odd: true }],
    })
    const next = JSON.parse(withProfile(file, { ...DEFAULT_PROFILE, id: 'exp_new', name: 'New' }))
    expect(next.note).toBe('mine')
    expect(next.profiles[0]).toEqual({ id: 'exp_x', name: 'Old', odd: true })
    expect(next.profiles).toHaveLength(2)
  })

  it('removes a profile and leaves the rest', () => {
    let text = withProfile(undefined, { ...DEFAULT_PROFILE, id: 'exp_a', name: 'A' })
    text = withProfile(text, { ...DEFAULT_PROFILE, id: 'exp_b', name: 'B' })
    const next = withoutProfile(text, 'exp_a')
    expect(JSON.parse(next).profiles.map((p: { id: string }) => p.id)).toEqual(['exp_b'])
    expect(DEFAULT_PROFILE_ID).toBe('standard')
  })

  it('never writes over a file it cannot read', () => {
    expect(() => withProfile('{ not json', DEFAULT_PROFILE)).toThrow(/left as they are/)
    expect(() => withProfile('[1, 2]', DEFAULT_PROFILE)).toThrow(/left as they are/)
    expect(() => readProfiles('{ not json')).toThrow(/left as they are/)
  })

  it('never writes a file from a newer Aurelia, but still reads it', () => {
    const newer = JSON.stringify({ schemaVersion: 9, profiles: [{ id: 'exp_a', name: 'A' }] })
    expect(readProfiles(newer)).toMatchObject({ newer: true })
    expect(() => withProfile(newer, DEFAULT_PROFILE)).toThrow(/newer Aurelia/)
    expect(() => withoutProfile(newer, 'exp_a')).toThrow(/newer Aurelia/)
  })

  it('keeps an entry that has no ID, as written, and replaces only the one with the ID', () => {
    const file = JSON.stringify({
      schemaVersion: 1,
      profiles: [{ name: 'No id', keep: 1 }, { id: 'exp_a', name: 'A' }, 'odd'],
    })
    const next = JSON.parse(withProfile(file, { ...DEFAULT_PROFILE, id: 'exp_a', name: 'A2' }))
    expect(next.profiles).toEqual([
      { name: 'No id', keep: 1 },
      expect.objectContaining({ id: 'exp_a', name: 'A2' }),
      'odd',
    ])
    expect(JSON.parse(withoutProfile(file, 'exp_a')).profiles).toEqual([
      { name: 'No id', keep: 1 },
      'odd',
    ])
  })

  it('refuses a file whose profiles are not a list, rather than replace them', () => {
    const file = JSON.stringify({ schemaVersion: 1, profiles: { odd: true } })
    expect(() => withProfile(file, DEFAULT_PROFILE)).toThrow(/left as they are/)
    expect(() => readProfiles(file)).toThrow(/left as they are/)
  })
})
