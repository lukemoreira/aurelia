// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { bookSchema, chapterSchema, partSchema } from './book'
import { recordSchema } from './record'
import { sceneSchema } from './scene'
import { universeSchema } from './universe'
import { workspaceSchema } from './workspace'

const scene = {
  title: 'The Lantern Gate',
  schemaVersion: 1,
  id: 'scn_4n8w2c7d0p',
  chapter: 'chp_6d2t9m4k8s',
  order: 'a3',
  status: 'draft',
  pov: 'chr_8f3k2m9q1x',
  location: 'plc_2b7x9r4k1m',
  time: { calendar: 'cal_4k8m2x9t1q', at: '412-03-14T18:00', label: 'dusk' },
  objective: 'Get through the gate.',
  characters: { add: ['chr_1c5v8n2b6z'], remove: [] },
  arcs: ['arc_9t3r6y1u0e'],
  target: 1800,
  flashback: false,
  ending: false,
  changes: [
    {
      who: 'chr_1c5v8n2b6z',
      kind: 'relation',
      with: 'chr_8f3k2m9q1x',
      value: 'stranger → creditor',
    },
    { kind: 'setup', id: 'stp_6w2n9k4d8f', value: 'A favour is owed' },
  ],
  choices: [
    { id: 'chc_5g2h8j3k1l', label: 'Pay the price', target: 'scn_0q9w8e7r6t' },
    { id: 'chc_7z6x5c4v3b', label: 'Climb', target: 'scn_1a2s3d4f5g', note: 'risky' },
  ],
}

describe('scene', () => {
  it('accepts the ADR-0003 example', () => {
    expect(sceneSchema.safeParse(scene).success).toBe(true)
  })

  it('needs only the core fields', () => {
    const { title, schemaVersion, id, chapter, order } = scene
    expect(sceneSchema.safeParse({ title, schemaVersion, id, chapter, order }).success).toBe(true)
  })

  it('keeps unknown keys at every level', () => {
    const out = sceneSchema.parse({
      ...scene,
      mood: 'tense',
      time: { ...scene.time, season: 'autumn' },
      characters: { add: [], remove: [], note: 'x' },
      changes: [{ kind: 'mystery', value: 'v', extra: 1 }],
      choices: [{ ...scene.choices[0], requires: 'key' }],
    })
    expect(out).toMatchObject({ mood: 'tense' })
    expect(out.time).toMatchObject({ season: 'autumn' })
    expect(out.characters).toMatchObject({ note: 'x' })
    expect(out.changes?.[0]).toMatchObject({ kind: 'mystery', extra: 1 })
    expect(out.choices?.[0]).toMatchObject({ requires: 'key' })
  })

  it('rejects bad data', () => {
    for (const bad of [
      { ...scene, id: 'chr_8f3k2m9q1x' },
      { ...scene, schemaVersion: 0 },
      { ...scene, schemaVersion: 1.5 },
      { ...scene, status: 'done' },
      { ...scene, time: { calendar: 'cal_4k8m2x9t1q', at: 'dusk' } },
      { ...scene, choices: [{ id: 'chc_5g2h8j3k1l', label: 'x', target: 'chr_8f3k2m9q1x' }] },
    ])
      expect(sceneSchema.safeParse(bad).success).toBe(false)
  })
})

describe('workspace, universe, book, part, chapter', () => {
  it('accept valid files and keep unknown keys', () => {
    const ws = {
      schemaVersion: 1,
      id: 'wsp_a1b2c3d4e5',
      name: 'W',
      universes: ['unv_k3f9x2a1b2'],
      x: 1,
    }
    expect(workspaceSchema.parse(ws)).toMatchObject({ x: 1 })

    const unv = {
      title: 'U',
      schemaVersion: 1,
      id: 'unv_k3f9x2a1b2',
      kind: 'standalone',
      books: ['bok_7hq2m1a1b2'],
      calendars: [{ id: 'cal_4k8m2x9t1q', name: 'Gregorian', epoch: 0 }],
    }
    expect(universeSchema.parse(unv).calendars?.[0]).toMatchObject({ epoch: 0 })
    expect(universeSchema.safeParse({ ...unv, kind: 'other' }).success).toBe(false)

    const bok = {
      title: 'B',
      schemaVersion: 1,
      id: 'bok_7hq2m1a1b2',
      mode: 'branching',
      start: 'scn_4n8w2c7d0p',
      outline: [{ chapter: 'chp_6d2t9m4k8s', scenes: ['scn_4n8w2c7d0p'] }],
      dismissedFindings: ['f1'],
      targets: { words: 80000, deadline: '2027-01-01' },
    }
    expect(bookSchema.parse(bok).targets).toMatchObject({ deadline: '2027-01-01' })
    expect(bookSchema.safeParse({ ...bok, mode: 'tree' }).success).toBe(false)

    // The website, logo and cover art are kept as written; a logo that is not a media ID is refused like a record's image.
    const art = { website: 'example.com', logo: 'med_a1b2c3d4e5', cover: 'med_f6g7h8j9k2' }
    expect(bookSchema.parse({ ...bok, ...art })).toMatchObject(art)
    expect(bookSchema.parse(bok)).not.toHaveProperty('cover')
    expect(bookSchema.safeParse({ ...bok, cover: 'chr_8f3k2m9q1x' }).success).toBe(false)

    const prt = { title: 'P', schemaVersion: 1, id: 'prt_a1b2c3d4e5', book: bok.id, order: 'a0' }
    expect(partSchema.safeParse(prt).success).toBe(true)
    const chp = {
      title: 'C',
      schemaVersion: 1,
      id: 'chp_6d2t9m4k8s',
      book: bok.id,
      part: prt.id,
      order: 'a0',
    }
    expect(chapterSchema.safeParse(chp).success).toBe(true)
    expect(chapterSchema.safeParse({ ...chp, order: 'a 0' }).success).toBe(false)
  })
})

describe('record', () => {
  const rec = {
    title: 'Elena Vasquez',
    schemaVersion: 1,
    id: 'chr_8f3k2m9q1x',
    type: 'character',
    scope: 'universe',
    tags: ['main'],
    eyes: 'grey',
  }

  it('accepts universe and book scope and keeps unknown keys', () => {
    expect(recordSchema.parse(rec)).toMatchObject({ eyes: 'grey' })
    expect(recordSchema.safeParse({ ...rec, scope: 'book:bok_7hq2m1a1b2' }).success).toBe(true)
  })

  it('rejects a bad scope, type or id', () => {
    expect(recordSchema.safeParse({ ...rec, scope: 'book:chr_8f3k2m9q1x' }).success).toBe(false)
    expect(recordSchema.safeParse({ ...rec, scope: 'world' }).success).toBe(false)
    expect(recordSchema.safeParse({ ...rec, type: 'spaceship' }).success).toBe(false)
    expect(recordSchema.safeParse({ ...rec, id: 'scn_4n8w2c7d0p' }).success).toBe(false)
  })
})

describe('dates before the calendar starts, and the dates on a sheet', () => {
  const time = { calendar: 'cal_4k8m2x9t1q', at: '-44-03-15' }
  it('takes a minus sign on a story time, and no other sign', () => {
    expect(sceneSchema.safeParse({ ...scene, time }).success).toBe(true)
    expect(sceneSchema.safeParse({ ...scene, time: { ...time, until: '-43' } }).success).toBe(true)
    for (const at of ['+44', '--44', '44-', '-', '- 44'])
      expect(sceneSchema.safeParse({ ...scene, time: { ...time, at } }).success).toBe(false)
  })

  it('keeps a character’s birth and an event’s date on the sheet, and reads them as story times', () => {
    const rec = {
      title: 'Elena',
      schemaVersion: 1,
      id: 'chr_8f3k2m9q1x',
      type: 'character',
      scope: 'universe',
      born: time,
      maxAge: '700',
    }
    expect(recordSchema.parse(rec)).toMatchObject({ born: time, maxAge: '700' })
    expect(recordSchema.safeParse({ ...rec, type: 'event', time }).success).toBe(true)
  })

  it('does not refuse a record whose date is written as words or a bare number: the date is left out, the file is read', () => {
    const rec = {
      title: 'Elena',
      schemaVersion: 1,
      id: 'chr_8f3k2m9q1x',
      type: 'character',
      scope: 'universe',
    }
    for (const bad of [
      'spring of 412',
      412,
      { calendar: 'cal_4k8m2x9t1q', at: 'long ago' },
      'the third age',
    ]) {
      const out = recordSchema.safeParse({ ...rec, born: bad, time: bad })
      expect(out.success).toBe(true)
      expect(out.data?.born).toBeUndefined()
      expect(out.data?.time).toBeUndefined()
    }
    // and the rest of the record is read as it was
    expect(recordSchema.parse({ ...rec, born: 412, summary: 'x' }).summary).toBe('x')
  })

  it('reads a year written bare in YAML as the key it means, on a scene and on the sheet, and a number in a text field as text', () => {
    for (const [bare, key] of [
      [412, '412'],
      [-44, '-44'],
    ] as const) {
      expect(
        sceneSchema.parse({ ...scene, time: { calendar: 'cal_4k8m2x9t1q', at: bare, until: bare } })
          .time,
      ).toMatchObject({ at: key, until: key })
    }
    const rec = {
      title: 'Elena',
      schemaVersion: 1,
      id: 'chr_8f3k2m9q1x',
      type: 'character',
      scope: 'universe',
      born: { calendar: 'cal_4k8m2x9t1q', at: -44 },
      age: 34,
      maxAge: 700,
    }
    expect(recordSchema.parse(rec)).toMatchObject({
      born: { at: '-44' },
      age: '34',
      maxAge: '700',
    })
    // a number is a number only for a key or a text field: a list is still refused
    expect(recordSchema.safeParse({ ...rec, aliases: 5 }).success).toBe(false)
  })
})
