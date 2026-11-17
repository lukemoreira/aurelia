// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { id, story, type Names, type Sc } from '../../tests/helpers/continuity-fixture'
import { continuityModel, stateAt } from './continuity'
import {
  appearsAfterExit,
  brokenLinks,
  itemInTwoHands,
  longAbsence,
  mainCharacters,
  setupWithoutPayoff,
  silentArc,
  timeOrder,
  twoPlaces,
} from './continuity-checks'
import { personState } from './continuity-state'
import { stateRows } from './continuity-views'

const names: Names = {
  characters: ['ana', 'bob', 'cy'],
  items: ['key'],
  places: ['gate', 'quay'],
  arcs: ['debt'],
}
const die = (who: string) => ({ who, kind: 'status', value: 'dead' })
const fp = (fs: { fingerprint: string }[]) => fs.map((f) => f.fingerprint)

describe('a mark of "intended" does not hide a new or worse problem', () => {
  it('a second death (other evidence) is a different finding from the one marked', () => {
    const one = appearsAfterExit(
      story(
        [
          { key: 'a', ch: 'c1', pov: 'ana', changes: [die('ana')] },
          { key: 'b', ch: 'c2', pov: 'bob', add: ['ana'] },
        ],
        { names },
      ).m,
    )
    const other = appearsAfterExit(
      story(
        [
          { key: 'a', ch: 'c1', pov: 'ana' },
          { key: 'x', ch: 'c1', pov: 'bob', changes: [die('ana')] },
          { key: 'b', ch: 'c2', pov: 'bob', add: ['ana'] },
        ],
        { names },
      ).m,
    )
    expect(fp(one)).not.toEqual(fp(other))
  })

  it('an item in three hands is not the item in two that was marked', () => {
    const hold = (who: string) => ({ who, kind: 'holds', item: 'key' })
    const two = itemInTwoHands(
      story([{ key: 'a', changes: [hold('ana'), hold('bob')] }], { names }).m,
    )
    const three = itemInTwoHands(
      story([{ key: 'a', changes: [hold('ana'), hold('bob'), hold('cy')] }], { names }).m,
    )
    expect(fp(two)).not.toEqual(fp(three))
  })

  it('a link that could be two things is not the broken link that was marked', () => {
    const f = brokenLinks(
      story([
        {
          key: 'a',
          broken: [
            { text: 'Bell', status: 'missing' },
            { text: 'Bell', status: 'ambiguous' },
          ],
        },
      ]).m,
    )
    expect(new Set(fp(f)).size).toBe(2)
  })

  it('set-ups written by hand without an ID are told apart by what they say, not by their place in the list', () => {
    const set = (...values: string[]) =>
      setupWithoutPayoff(
        story([{ key: 'a', changes: values.map((value) => ({ kind: 'setup', value })) }]).m,
      )
    const first = set('The key', 'The letter')
    expect(new Set(fp(first)).size).toBe(2)
    expect(fp(first).sort()).toEqual(fp(set('The letter', 'The key')).sort())
    // the same words twice in a scene are one finding in the list
    expect(
      story([
        {
          key: 'a',
          changes: [
            { kind: 'setup', value: 'The key' },
            { kind: 'setup', value: 'The key' },
          ],
        },
      ]).findings(),
    ).toHaveLength(1)
  })
})

describe('a flash-forward does not change the scenes that follow it in reading order', () => {
  it('a prologue that shows a death raises nothing on the later scenes, and its state stops at the prologue', () => {
    const { m, findings } = story(
      [
        {
          key: 'p',
          ch: 'c0',
          pov: 'bob',
          add: ['ana'],
          at: '499-01-01',
          flashForward: true,
          changes: [die('ana')],
        },
        { key: 'a', ch: 'c1', pov: 'ana', at: '412-01-01' },
        { key: 'b', ch: 'c2', pov: 'ana', at: '412-01-02' },
      ],
      { names },
    )
    expect(findings()).toEqual([])
    const status = (k: string) => personState(stateAt(m, id.scn(k))!, id.chr('ana')).status[0]!.text
    expect(status('p')).toBe('dead') // told, in the prologue
    expect(status('b')).toBe('') // alive in the story as it is read
  })

  it('a flashback in the same place still carries on: a death it reveals holds for what is read after it', () => {
    const f = appearsAfterExit(
      story(
        [
          {
            key: 'p',
            ch: 'c0',
            pov: 'bob',
            at: '400-01-01',
            flashback: true,
            changes: [die('ana')],
          },
          { key: 'a', ch: 'c1', pov: 'ana', at: '412-01-01' },
        ],
        { names },
      ).m,
    )
    expect(f.map((x) => x.scene)).toEqual([id.scn('a')])
  })

  it('does not take a flash-forward death for the end of a long absence', () => {
    const scenes: Sc[] = Array.from({ length: 14 }, (_, i) => ({
      key: `s${i}`,
      ch: `c${String(i).padStart(2, '0')}`,
      pov: i < 3 || i > 11 ? 'ana' : 'bob',
    }))
    scenes[2] = { ...scenes[2]!, flashForward: true, changes: [die('ana')] }
    expect(longAbsence(story(scenes, { names }).m)).toHaveLength(1)
  })
})

describe('scenes of no chapter', () => {
  const loose = (n: number) => {
    const { m, data } = story(
      Array.from({ length: n }, (_, i) => ({
        key: `s${i}`,
        ch: `c${String(i).padStart(2, '0')}`,
        pov: 'ana',
        ...(i === 0 ? { arcs: ['debt'], changes: [die('ana')] } : {}),
      })),
      { names },
    )
    // one scene whose chapter is gone: shown as Unfiled, after the last chapter
    const scene = {
      ...data.scenes[0]!,
      meta: {
        ...data.scenes[0]!.meta,
        id: id.scn('loose'),
        title: 'loose',
        chapter: 'chp_0000000000',
        arcs: [id.arc('debt')], // moves the arc on, in a place that is not a chapter
        changes: undefined,
      },
    }
    return continuityModel({ ...m.input, data: { ...data, scenes: [...data.scenes, scene] } })
  }

  it('are not read after the last chapter: each starts from nothing', () => {
    const m = loose(3)
    expect(m.chapters.at(-1)!.title).toBe('Unfiled')
    // ana dies in the first scene; the loose scene names her (point of view), and nothing carries her death into it
    expect(appearsAfterExit(m).map((f) => f.scene)).not.toContain(id.scn('loose'))
  })

  it('are not counted as a chapter, and no stretch is ever written "(4–0)"', () => {
    const m = loose(10)
    expect(m.chapterCount).toBe(10)
    const text = [...silentArc(m), ...longAbsence(m)].map((f) => f.body).join('|')
    expect(text).not.toMatch(/–0\b/)
    // the scene of no chapter moves the arc on, but not in any chapter: it does not close a stretch of silence
    expect(silentArc(m)).toEqual([])
  })
})

describe('false alarms in short books', () => {
  it('a one-chapter point of view is not a main character; two chapters of it is', () => {
    const book = (povChapters: number): Sc[] =>
      Array.from({ length: 14 }, (_, i) => ({
        key: `s${i}`,
        ch: `c${String(i).padStart(2, '0')}`,
        pov: i < povChapters ? 'ana' : 'bob',
      }))
    expect(mainCharacters(story(book(1), { names }).m).has(id.chr('ana'))).toBe(false)
    expect(mainCharacters(story(book(2), { names }).m).has(id.chr('ana'))).toBe(true)
  })
})

describe('time order across calendars', () => {
  it('keeps a running time for each calendar: a scene in another calendar neither moves nor hides the base of this one', () => {
    const { m, data } = story([
      { key: 'a', ch: 'c1', at: '412-01-10' },
      { key: 'x', ch: 'c2', at: '412-01-01' },
      { key: 'b', ch: 'c3', at: '412-01-05' },
    ])
    const cal = data.universes[0]!.calendars![0]!.id
    const elsewhere = data.scenes.map((s) =>
      s.meta.id === id.scn('x')
        ? { ...s, meta: { ...s.meta, time: { calendar: 'cal_bbbbbbbbbb', at: '9' } } }
        : s,
    )
    // `b` is before `a` in the first calendar, with a scene of another calendar between them
    const found = timeOrder(continuityModel({ ...m.input, data: { ...data, scenes: elsewhere } }))
    expect(found.map((f) => f.scene)).toEqual([id.scn('b')])
    expect(found[0]!.related).toEqual([id.scn('a')])
    expect(cal).toBeTruthy()
  })
})

describe('branching: scenes nobody can reach', () => {
  const branching = (scenes: Sc[]) =>
    story(scenes, { mode: 'branching', start: scenes[0]!.key, names })

  it('what an orphan scene does is not something that has happened on the way to a scene a reader can reach', () => {
    const { m } = branching([
      { key: 'start', pov: 'bob', choices: [['go', 'end']] },
      { key: 'orphan', pov: 'bob', changes: [die('ana')], choices: [['go', 'end']] },
      { key: 'end', pov: 'bob', add: ['ana'], ending: true },
    ])
    expect(appearsAfterExit(m)).toEqual([])
  })

  it('a chain that starts at an orphan has its own every-path answers: the only way into its second scene is the first', () => {
    const { m } = branching([
      { key: 'start', pov: 'bob', ending: true },
      { key: 'a', pov: 'bob', changes: [die('ana')], choices: [['go', 'b']] },
      { key: 'b', pov: 'bob', add: ['ana'], ending: true },
    ])
    expect(appearsAfterExit(m).map((f) => [f.scene, f.paths])).toEqual([[id.scn('b'), 'every']])
  })

  it('a loop nothing leads into still starts somewhere, and is checked', () => {
    const { m } = branching([
      { key: 'start', pov: 'bob', ending: true },
      { key: 'l1', pov: 'bob', changes: [die('ana')], choices: [['go', 'l2']] },
      { key: 'l2', pov: 'bob', add: ['ana'], choices: [['back', 'l1']] },
    ])
    expect(appearsAfterExit(m).map((f) => f.scene)).toEqual([id.scn('l2')])
  })
})

describe('"possibly two places" noise', () => {
  it('a day-long scene beside many timed ones is one note for the person and the two places, with how many more', () => {
    const scenes: Sc[] = [{ key: 'day', ch: 'c0', pov: 'ana', place: 'gate', at: '412-01-14' }]
    for (let i = 0; i < 6; i++)
      scenes.push({
        key: `t${i}`,
        ch: `c${i + 1}`,
        pov: 'ana',
        place: 'quay',
        at: `412-01-14T1${i}:00`,
      })
    const f = twoPlaces(story(scenes, { names }).m)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({
      possible: true,
      severity: 'note',
      title: 'Possibly two places at once',
    })
    expect(f[0]!.body).toContain('comes up 5 more times')
  })
})

describe('the state a person is shown', () => {
  it('"Where" is the scene’s place when they are on the page there, not a place they went to scenes ago', () => {
    const { m } = story(
      [
        {
          key: 'a',
          ch: 'c1',
          pov: 'ana',
          place: 'gate',
          changes: [{ who: 'ana', kind: 'location', with: 'quay' }],
        },
        { key: 'b', ch: 'c2', pov: 'ana', place: 'gate' },
        { key: 'c', ch: 'c3', pov: 'bob' }, // ana is not on the page: the last place she went to is all there is
      ],
      { names },
    )
    const where = (k: string, who = 'ana') =>
      stateRows(m, id.scn(k), id.chr(who))
        .find((r) => r.label === 'Where')
        ?.items.map((i) => i.text)
    expect(where('a')).toEqual(['quay']) // this scene sends her there
    expect(where('b')).toEqual(['gate'])
    expect(where('c')).toEqual(['quay'])
  })
})

describe('who holds what, and since when', () => {
  it('each holder keeps the scene they took the item in: a second holder does not restamp the first', () => {
    const { m } = story(
      [
        { key: 'a', ch: 'c1', pov: 'ana', changes: [{ who: 'ana', kind: 'holds', item: 'key' }] },
        { key: 'b', ch: 'c2', pov: 'bob', changes: [{ who: 'bob', kind: 'holds', item: 'key' }] },
      ],
      { names },
    )
    const since = (who: string) =>
      personState(stateAt(m, id.scn('b'))!, id.chr(who)).holds[0]!.since
    expect(since('ana')).toBe(id.scn('a'))
    expect(since('bob')).toBe(id.scn('b'))
  })
})

describe('the flow always finishes', () => {
  it('settles on a ring of 60 scenes that hand an item about, with a way back to the start from each', () => {
    const n = 60
    const scenes: Sc[] = Array.from({ length: n }, (_, i) => ({
      key: `r${i}`,
      pov: 'ana',
      choices: [
        ['on', `r${(i + 1) % n}`],
        ['back', 'r0'],
      ],
      changes: [{ who: i % 2 ? 'ana' : 'bob', kind: i % 3 ? 'holds' : 'loses', item: 'key' }],
    }))
    const { m } = story(scenes, { mode: 'branching', names })
    expect(m.flow.after.size).toBe(n)
    expect(m.flow.before.size).toBe(n)
  })
})
