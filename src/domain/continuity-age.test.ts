// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { cal, id, story, type Sc } from '../../tests/helpers/continuity-fixture'
import { ageAndDates, continuityFindings, splitDismissed } from './continuity-checks'
import { ageAt, ageWords, maxAgeOf } from './continuity-age'
import { stateRows } from './continuity-views'

const names = { characters: ['ana', 'bob'] }
const scene = (key: string, at: string | undefined, over: Partial<Sc> = {}): Sc => ({
  key,
  ch: key,
  pov: 'ana',
  ...(at ? { at } : {}),
  ...over,
})
const run = (
  scenes: Sc[],
  born: Record<string, { at: string; calendar?: string; maxAge?: string }>,
) => {
  const f = story(scenes, { names, born })
  return { ...f, found: ageAndDates(f.m) }
}
const age = (f: ReturnType<typeof run>, key: string) =>
  ageAt(f.m, id.chr('ana'), f.m.byId.get(id.scn(key))!)

describe('age at a scene', () => {
  const f = run(
    [
      scene('day', '421-03-13'),
      scene('bday', '421-03-14'),
      scene('year', '421'),
      scene('none', undefined),
      scene('other', '421-03-14', { calendar: 'cal_otherxxxxx' }),
      scene('before', '410'),
    ],
    { ana: { at: '412-03-14' } },
  )
  it('counts whole years to the day, and a range where the scene is vaguer than the birth', () => {
    expect(age(f, 'day')).toEqual({ min: 8, max: 8 })
    expect(age(f, 'bday')).toEqual({ min: 9, max: 9 })
    expect(age(f, 'year')).toEqual({ min: 8, max: 9 })
    expect(ageWords(age(f, 'year')!)).toBe('8–9')
    expect(ageWords(age(f, 'bday')!)).toBe('9')
  })
  it('says nothing when a date is missing, in another calendar, or before the birth', () => {
    expect(age(f, 'none')).toBeUndefined()
    expect(age(f, 'other')).toBeUndefined()
    expect(age(f, 'before')).toBeUndefined()
    expect(ageAt(f.m, id.chr('bob'), f.m.byId.get(id.scn('day'))!)).toBeUndefined() // no birth date
  })
  it('is a row of the state at a scene, beside the status', () => {
    const rows = stateRows(f.m, id.scn('bday'), id.chr('ana'))
    expect(rows.map((r) => [r.label, r.items.map((i) => i.text)]).slice(0, 2)).toEqual([
      ['Age', ['9']],
      ['Status', ['Alive']],
    ])
    expect(stateRows(f.m, id.scn('none'), id.chr('ana')).map((r) => r.label)).not.toContain('Age')
  })
  it('counts years before the epoch as numbers, with no year 0 between 1 BCE and 1 CE', () => {
    const g = run([scene('a', '-34-03-15'), scene('b', '10-03-15')], { ana: { at: '-44-03-15' } })
    expect(age(g, 'a')).toEqual({ min: 10, max: 10 })
    expect(age(g, 'b')).toEqual({ min: 53, max: 53 })
  })
})

describe('the Age and dates check', () => {
  it('finds a character on the page before they were born, in words', () => {
    const f = run([scene('a', '410-05-01'), scene('b', '420')], { ana: { at: '412-03-14' } })
    expect(f.found).toHaveLength(1)
    expect(f.found[0]).toMatchObject({
      check: 'age-dates',
      severity: 'error',
      group: 'characters',
      scene: id.scn('a'),
      subject: id.chr('ana'),
      title: 'On the page before they were born',
    })
    expect(f.found[0]!.body).toBe(
      'ana is in 1.1 · a, set in 410-05-01 TR, but was born in 14 Heat 412 TR. Check the birth date or the scene’s story time.',
    )
  })

  it('finds one older than they can live, with the default limit, and says how old at least', () => {
    const f = run([scene('a', '520'), scene('b', '540')], { ana: { at: '412-03-14' } })
    expect(f.found).toHaveLength(1)
    expect(f.found[0]).toMatchObject({ severity: 'warning', title: 'Older than they can live' })
    expect(f.found[0]!.body).toBe(
      'ana is at least 127 in 2.1 · b, set in 540 TR, which is older than 120, the longest we assume (born 14 Heat 412 TR). Change “Longest they could live” on their sheet if this is right. Check the birth date or the scene’s story time.',
    )
  })

  it('stops at the first scene, and counts the others', () => {
    const f = run([scene('a', '540'), scene('b', '545'), scene('c', '550')], {
      ana: { at: '412-03-14' },
    })
    expect(f.found).toHaveLength(1)
    expect(f.found[0]!.scene).toBe(id.scn('a'))
    expect(f.found[0]!.related).toEqual([id.scn('b'), id.scn('c')])
    expect(f.found[0]!.body).toContain('The same is true of 2 more scenes.')
  })

  it('takes the limit from the sheet: an elf may live to 700, and a limit that is not a number is ignored', () => {
    const elf = run([scene('a', '900')], { ana: { at: '412', maxAge: '700' } })
    expect(elf.found).toEqual([])
    expect(maxAgeOf(elf.m, id.chr('ana'))).toBe(700)
    const odd = run([scene('a', '900')], { ana: { at: '412', maxAge: 'lots' } })
    expect(maxAgeOf(odd.m, id.chr('ana'))).toBe(120)
    expect(odd.found.map((x) => x.title)).toEqual(['Older than they can live'])
    const short = run([scene('a', '430')], { ana: { at: '412', maxAge: '10' } })
    expect(short.found.map((x) => x.title)).toEqual(['Older than they can live'])
  })

  it('works across the epoch: 44 BCE is long before 412', () => {
    const f = run([scene('a', '-60'), scene('b', '-20')], { ana: { at: '-44' } })
    expect(f.found.map((x) => [x.scene, x.title])).toEqual([
      [id.scn('a'), 'On the page before they were born'],
    ])
  })

  it('raises nothing on a clean story', () => {
    const f = run(
      [
        scene('a', '412-03-14'), // on the day
        scene('b', '421-06-01'),
        scene('c', '480'),
        scene('d', '412', { ch: 'd' }), // a year that holds the birth: not certainly before it
        scene('e', '400', { pov: 'bob' }), // before she was born, but she is not on the page
        scene('f', '400', { pov: 'bob', named: ['ana'], remove: ['ana'] }), // spoken of, not there
        scene('g', undefined), // no time
        scene('h', '300', { calendar: 'cal_otherxxxxx' }), // another calendar is never compared
      ],
      { ana: { at: '412-03-14' } },
    )
    expect(f.found).toEqual([])
    expect(ageAndDates(story([scene('a', '300')], { names }).m)).toEqual([]) // no birth date
  })

  it('treats a flashback like any scene: its own time is what counts', () => {
    const f = run([scene('a', '420'), scene('b', '405', { flashback: true })], {
      ana: { at: '412' },
    })
    expect(f.found.map((x) => x.scene)).toEqual([id.scn('b')])
  })

  it('is part of the findings of the book, and "Mark intended" hides only that one', () => {
    const f = run([scene('a', '410')], { ana: { at: '412-03-14' } })
    expect(continuityFindings(f.m).map((x) => x.check)).toContain('age-dates')
    const [one] = f.found
    expect(splitDismissed(continuityFindings(f.m), [one!.fingerprint]).dismissed).toHaveLength(1)
    // another birth date is another finding: the mark does not hide a new problem of the same kind
    const g = run([scene('a', '410')], { ana: { at: '415' } })
    expect(g.found[0]!.fingerprint).not.toBe(one!.fingerprint)
    expect(splitDismissed(g.found, [one!.fingerprint]).active).toHaveLength(1)
    // nor does another limit
    const h = run([scene('a', '540')], { ana: { at: '412', maxAge: '100' } })
    const k = run([scene('a', '540')], { ana: { at: '412', maxAge: '110' } })
    expect(h.found[0]!.fingerprint).not.toBe(k.found[0]!.fingerprint)
  })

  it('says the sheet’s own limit when it gives one, with a next step', () => {
    const f = run([scene('a', '540')], { ana: { at: '412-03-14', maxAge: '100' } })
    expect(f.found[0]!.body).toBe(
      'ana is at least 127 in 1.1 · a, set in 540 TR, but the sheet says they live to 100 at most (born 14 Heat 412 TR). Check the birth date or the scene’s story time.',
    )
  })

  it('reads a limit written with a thousands separator or spaces: "1,000" is a thousand, not one', () => {
    for (const [raw, n] of [
      ['1,000', 1000],
      ['1 000', 1000],
      [' 700 ', 700],
      ['0', 120],
      ['-5', 120],
    ] as const) {
      const f = run([scene('a', '900')], { ana: { at: '412', maxAge: raw } })
      expect(maxAgeOf(f.m, id.chr('ana'))).toBe(n)
    }
    expect(run([scene('a', '900')], { ana: { at: '412', maxAge: '1,000' } }).found).toEqual([])
  })

  it('marking one ghost scene intended does not hide a later scene, or a new one before it', () => {
    const one = run([scene('a', '410')], { ana: { at: '412' } }).found[0]!
    // a second scene before the birth: not the finding that was marked
    const two = run([scene('a', '410'), scene('b', '411')], { ana: { at: '412' } })
    expect(two.found).toHaveLength(1)
    expect(two.found[0]!.fingerprint).not.toBe(one.fingerprint)
    expect(splitDismissed(two.found, [one.fingerprint]).active).toHaveLength(1)
    // an earlier new scene is another finding too, though the first scene is the same
    const early = run([scene('z', '409'), scene('a', '410')], { ana: { at: '412' } })
    expect(splitDismissed(early.found, [one.fingerprint]).active).toHaveLength(1)
  })

  it('a scene moved in time is another finding: the time is part of what was marked', () => {
    const a = run([scene('a', '410')], { ana: { at: '412' } }).found[0]!
    const b = run([scene('a', '409')], { ana: { at: '412' } }).found[0]!
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('does not take a birth date and a limit for each other when they swap', () => {
    const a = run([scene('a', '600')], { ana: { at: '100', maxAge: '412' } }).found[0]!
    const b = run([scene('a', '600')], { ana: { at: '412', maxAge: '100' } }).found[0]!
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('does not look at a character the book does not know', () => {
    const f = story([scene('a', '300')], {
      names: { characters: ['bob'] },
      born: { ana: { at: '412' } },
    })
    expect(ageAndDates(f.m)).toEqual([])
    void cal
  })
})
