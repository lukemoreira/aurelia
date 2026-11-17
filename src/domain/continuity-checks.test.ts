// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { id, story, type Names, type Sc } from '../../tests/helpers/continuity-fixture'
import {
  LONG_ABSENCE_CHAPTERS,
  SILENT_ARC_CHAPTERS,
  appearsAfterExit,
  brokenLinks,
  continuityFindings,
  itemInTwoHands,
  longAbsence,
  setupWithoutPayoff,
  silentArc,
  splitDismissed,
  timeOrder,
  twoPlaces,
} from './continuity-checks'

const names: Names = {
  characters: ['ana', 'bob', 'cy'],
  items: ['key'],
  places: ['gate', 'quay'],
  arcs: ['debt'],
}
const die = (who: string) => ({ who, kind: 'status', value: 'dead' })
const checks = (fs: { check: string }[]) => fs.map((f) => f.check)

/** A clean story: three chapters, people appear where they should, times rise, a set-up is paid. */
const clean: Sc[] = [
  {
    key: 'a',
    ch: 'c1',
    pov: 'ana',
    place: 'gate',
    at: '412-03-10T09:00',
    changes: [
      { kind: 'setup', id: 's1', value: 'The key' },
      { who: 'ana', kind: 'holds', item: 'key' },
    ],
  },
  {
    key: 'b',
    ch: 'c2',
    pov: 'ana',
    add: ['bob'],
    place: 'quay',
    at: '412-03-11T09:00',
    changes: [
      { who: 'ana', kind: 'loses', item: 'key' },
      { who: 'bob', kind: 'holds', item: 'key' },
    ],
  },
  {
    key: 'c',
    ch: 'c3',
    pov: 'bob',
    place: 'gate',
    at: '412-03-12T09:00',
    changes: [die('bob'), { kind: 'payoff', of: 's1' }],
  },
]

describe('a clean story raises nothing', () => {
  it('has no findings from any check', () => {
    expect(story(clean, { names }).findings()).toEqual([])
  })
})

describe('appears after death or exit', () => {
  it('finds a character on the page after they died, naming both scenes', () => {
    const f = appearsAfterExit(
      story(
        [
          { key: 'a', ch: 'c1', pov: 'ana', changes: [die('ana')] },
          { key: 'b', ch: 'c2', pov: 'bob', add: ['ana'] },
        ],
        { names },
      ).m,
    )
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({
      check: 'appears-after-exit',
      severity: 'error',
      scene: id.scn('b'),
      subject: id.chr('ana'),
    })
    expect(f[0]!.body).toBe('ana is dead since 1.1 · a, but appears in 2.1 · b.')
  })

  it('says someone who left the story left it, not that they died', () => {
    const f = appearsAfterExit(
      story(
        [
          {
            key: 'a',
            ch: 'c1',
            pov: 'ana',
            changes: [{ who: 'ana', kind: 'status', value: 'gone' }],
          },
          { key: 'b', ch: 'c2', pov: 'bob', add: ['ana'] },
        ],
        { names },
      ).m,
    )
    expect(f[0]!.body).toContain('left the story at 1.1 · a')
  })

  it('does not raise the scene where they die, a scene that brings them back, or one that only speaks of them', () => {
    const { m } = story(
      [
        { key: 'a', ch: 'c1', pov: 'ana', changes: [die('ana')] },
        { key: 'b', ch: 'c2', pov: 'bob', named: ['ana'], remove: ['ana'] }, // named, then unticked: spoken of
        {
          key: 'c',
          ch: 'c3',
          pov: 'bob',
          add: ['ana'],
          changes: [{ who: 'ana', kind: 'status', value: 'alive' }],
        },
        { key: 'd', ch: 'c4', pov: 'ana' },
      ],
      { names },
    )
    expect(appearsAfterExit(m)).toEqual([])
  })

  it('does not raise a flashback, and a flashback that reveals an earlier death raises nothing on the scenes before it', () => {
    const { m } = story(
      [
        { key: 'a', ch: 'c1', pov: 'ana', at: '412-03-01' },
        { key: 'b', ch: 'c2', pov: 'ana', at: '412-03-02' },
        // chapter 20: a flashback to the winter, showing how ana died (it was before chapter 1's events)
        {
          key: 'f',
          ch: 'c3',
          pov: 'bob',
          add: ['ana'],
          at: '411-12-01',
          flashback: true,
          changes: [die('ana')],
        },
        // a scene after it in an old time, with ana alive in a flashback: not raised either
        { key: 'g', ch: 'c4', pov: 'bob', add: ['ana'], at: '411-12-02', flashback: true },
      ],
      { names },
    )
    expect(appearsAfterExit(m)).toEqual([])
    expect(timeOrder(m)).toEqual([])
  })

  it('raises ana in a scene after the flashback that revealed her death, in reading order', () => {
    const { m } = story(
      [
        { key: 'a', ch: 'c1', pov: 'ana' },
        { key: 'f', ch: 'c2', pov: 'bob', at: '411-12-01', flashback: true, changes: [die('ana')] },
        { key: 'z', ch: 'c3', pov: 'ana' },
      ],
      { names },
    )
    expect(appearsAfterExit(m).map((f) => f.scene)).toEqual([id.scn('z')])
  })

  it('says on every path or on some paths in a branching book, from a loop and a hub', () => {
    // start → hub; hub → lap | exit; lap → hub. ana dies on the lap.
    const { m } = story(
      [
        { key: 'start', pov: 'bob', choices: [['go', 'hub']] },
        {
          key: 'hub',
          pov: 'bob',
          add: ['ana'],
          choices: [
            ['again', 'lap'],
            ['leave', 'exit'],
          ],
        },
        { key: 'lap', pov: 'bob', add: ['ana'], changes: [die('ana')], choices: [['back', 'hub']] },
        { key: 'exit', pov: 'bob', add: ['ana'], ending: true },
      ],
      { mode: 'branching', names },
    )
    const found = appearsAfterExit(m)
    // the hub is seen first with ana alive, then after a lap with ana dead: some paths. The exit likewise.
    expect(found.map((f) => [f.scene, f.paths, f.severity])).toEqual([
      [id.scn('hub'), 'some', 'warning'],
      [id.scn('exit'), 'some', 'warning'],
    ])
    expect(found[0]!.body.endsWith('(on some paths)')).toBe(true)
    // when the death comes before the hub, every way in has it
    const every = story(
      [
        { key: 'start', pov: 'ana', changes: [die('ana')], choices: [['go', 'hub']] },
        {
          key: 'hub',
          pov: 'bob',
          add: ['ana'],
          choices: [
            ['again', 'lap'],
            ['leave', 'exit'],
          ],
        },
        { key: 'lap', pov: 'bob', choices: [['back', 'hub']] },
        { key: 'exit', pov: 'bob', ending: true },
      ],
      { mode: 'branching', names },
    ).m
    expect(appearsAfterExit(every).map((f) => [f.scene, f.paths, f.severity])).toEqual([
      [id.scn('hub'), 'every', 'error'],
    ])
    expect(appearsAfterExit(every)[0]!.body.endsWith('(on every path)')).toBe(true)
  })

  it('does not blame a scene on another branch for a death it cannot follow', () => {
    const { m } = story(
      [
        {
          key: 'start',
          pov: 'bob',
          choices: [
            ['left', 'left'],
            ['right', 'right'],
          ],
        },
        { key: 'left', pov: 'bob', changes: [die('ana')], ending: true },
        { key: 'right', pov: 'bob', add: ['ana'], ending: true },
      ],
      { mode: 'branching', names },
    )
    expect(appearsAfterExit(m)).toEqual([])
  })
})

describe('two places at once', () => {
  const at = (when: string, where: string): Sc => ({
    key: where,
    ch: where,
    pov: 'ana',
    place: where,
    at: when,
  })

  it('finds one person in two places at the same minute, once, and says when', () => {
    const f = twoPlaces(
      story([at('412-01-14T18:00', 'gate'), at('412-01-14T18:00', 'quay')], { names }).m,
    )
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({
      severity: 'warning',
      title: 'Two places at once',
      subject: id.chr('ana'),
    })
    expect(f[0]!.body).toBe(
      'ana is at gate (1.1 · gate) and at quay (2.1 · quay) at 14 Thaw 412 TR, 18:00.',
    )
  })

  it('does not raise different times, the same place, or someone who is only in one of the scenes', () => {
    expect(
      twoPlaces(story([at('412-01-14T18:00', 'gate'), at('412-01-14T19:00', 'quay')], { names }).m),
    ).toEqual([])
    expect(
      twoPlaces(
        story(
          [
            { ...at('412-01-14T18:00', 'gate'), key: 'x' },
            { ...at('412-01-14T18:00', 'gate'), key: 'y', ch: 'c2' },
          ],
          { names },
        ).m,
      ),
    ).toEqual([])
    const other: Sc = { key: 'quay', ch: 'q', pov: 'bob', place: 'quay', at: '412-01-14T18:00' }
    expect(twoPlaces(story([at('412-01-14T18:00', 'gate'), other], { names }).m)).toEqual([])
  })

  it('reads a person’s own location change as where they are', () => {
    const away: Sc = {
      key: 'x',
      ch: 'c1',
      pov: 'ana',
      place: 'gate',
      at: '412-01-14T18:00',
      changes: [{ who: 'ana', kind: 'location', with: 'quay' }],
    }
    const there: Sc = { key: 'y', ch: 'c2', pov: 'ana', place: 'quay', at: '412-01-14T18:00' }
    expect(twoPlaces(story([away, there], { names }).m)).toEqual([])
  })

  it('shows a coarser overlap as only possible: a Note, collapsed', () => {
    const f = twoPlaces(
      story([at('412-01-14T18:00', 'gate'), at('412-01-14', 'quay')], { names }).m,
    )
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({
      severity: 'note',
      possible: true,
      title: 'Possibly two places at once',
    })
    const span = twoPlaces(
      story([{ ...at('412-01-10', 'gate'), until: '412-01-20' }, at('412-01-14T18:00', 'quay')], {
        names,
      }).m,
    )
    expect(span[0]).toMatchObject({ severity: 'note', possible: true })
  })

  it('does not compare scenes on branches that cannot be read in one playthrough', () => {
    const { m } = story(
      [
        {
          key: 'start',
          ch: 'c1',
          pov: 'bob',
          choices: [
            ['l', 'left'],
            ['r', 'right'],
          ],
        },
        { ...at('412-01-14T18:00', 'gate'), key: 'left', ch: 'c2', ending: true },
        { ...at('412-01-14T18:00', 'quay'), key: 'right', ch: 'c3', ending: true },
      ],
      { mode: 'branching', names },
    )
    expect(twoPlaces(m)).toEqual([])
  })
})

describe('time order', () => {
  const t = (key: string, ch: string, when: string, extra: Partial<Sc> = {}): Sc => ({
    key,
    ch,
    at: when,
    ...extra,
  })

  it('finds a scene that happens before the one it follows, if it is not a flashback', () => {
    const f = timeOrder(story([t('a', 'c1', '412-01-10'), t('b', 'c2', '412-01-08')]).m)
    expect(f).toHaveLength(1)
    expect(f[0]!.body).toBe(
      '2.1 · b happens before 1.1 · a in story time and is not marked as a flashback.',
    )
    expect(f[0]).toMatchObject({ scene: id.scn('b'), related: [id.scn('a')], group: 'time' })
  })

  it('does not raise a flashback or a flash-forward, and the scene after one is compared with the scene before it', () => {
    const { m } = story([
      t('a', 'c1', '412-01-10'),
      t('b', 'c2', '400-01-01', { flashback: true }),
      t('c', 'c3', '412-01-11'),
      t('d', 'c4', '499-01-01', { flashForward: true }),
      t('e', 'c5', '412-01-12'),
    ])
    expect(timeOrder(m)).toEqual([])
  })

  it('does not raise coarse times that could be in order, nor scenes without a time', () => {
    expect(
      timeOrder(
        story([
          t('a', 'c1', '412-01-10T18:00'),
          t('b', 'c2', '412-01-10'),
          { key: 'x', ch: 'c3' },
          t('c', 'c4', '412-01'),
        ]).m,
      ),
    ).toEqual([])
  })

  it('follows the choices in a branching book: only a scene’s own way in counts', () => {
    const f = timeOrder(
      story(
        [
          {
            ...t('start', 'c1', '412-01-10'),
            choices: [
              ['l', 'left'],
              ['r', 'right'],
            ],
          },
          { ...t('left', 'c2', '412-01-08'), ending: true },
          { ...t('right', 'c3', '412-01-12'), ending: true },
        ],
        { mode: 'branching' },
      ).m,
    )
    expect(f.map((x) => x.scene)).toEqual([id.scn('left')])
  })
})

describe('item in two hands', () => {
  it('finds an item given to a second person while the first still holds it', () => {
    const f = itemInTwoHands(
      story(
        [
          { key: 'a', ch: 'c1', changes: [{ who: 'ana', kind: 'holds', item: 'key' }] },
          { key: 'b', ch: 'c2', changes: [{ who: 'bob', kind: 'holds', item: 'key' }] },
        ],
        { names },
      ).m,
    )
    expect(f).toHaveLength(1)
    expect(f[0]!.body).toBe('key is held by ana and by bob in 2.1 · b.')
  })

  it('does not raise a hand-over written in one scene, in either order of the two changes it holds', () => {
    const swap = (first: Record<string, string>, second: Record<string, string>) =>
      itemInTwoHands(
        story(
          [
            { key: 'a', ch: 'c1', changes: [{ who: 'ana', kind: 'holds', item: 'key' }] },
            { key: 'b', ch: 'c2', changes: [first, second] },
          ],
          { names },
        ).m,
      )
    const lose = { who: 'ana', kind: 'loses', item: 'key' }
    const gain = { who: 'bob', kind: 'holds', item: 'key' }
    expect(swap(lose, gain)).toEqual([])
    expect(swap(gain, lose)).toEqual([])
  })

  it('says on some paths when only one way into the scene has the first holder', () => {
    const f = itemInTwoHands(
      story(
        [
          {
            key: 'start',
            choices: [
              ['l', 'left'],
              ['r', 'right'],
            ],
          },
          {
            key: 'left',
            changes: [{ who: 'ana', kind: 'holds', item: 'key' }],
            choices: [['on', 'end']],
          },
          { key: 'right', choices: [['on', 'end']] },
          { key: 'end', changes: [{ who: 'bob', kind: 'holds', item: 'key' }], ending: true },
        ],
        { mode: 'branching', names },
      ).m,
    )
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ paths: 'some', scene: id.scn('end') })
  })
})

describe('set-up without pay-off', () => {
  it('finds a set-up nothing pays off, as a Note', () => {
    const f = setupWithoutPayoff(
      story([
        {
          key: 'a',
          ref: undefined,
          changes: [{ kind: 'setup', id: 's1', value: 'The key under the lantern' }],
        } as Sc,
      ]).m,
    )
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({
      severity: 'note',
      group: 'threads',
      title: 'Set-up without pay-off',
    })
    expect(f[0]!.body).toBe('“The key under the lantern” (1.1) is never paid off.')
  })

  it('does not raise a set-up that a later pay-off names, in any chapter', () => {
    const f = setupWithoutPayoff(
      story([
        { key: 'a', ch: 'c1', changes: [{ kind: 'setup', id: 's1', value: 'x' }] },
        { key: 'b', ch: 'c9', changes: [{ kind: 'payoff', of: 's1' }] },
      ]).m,
    )
    expect(f).toEqual([])
  })

  it('finds a pay-off whose set-up is not there', () => {
    const f = setupWithoutPayoff(story([{ key: 'a', changes: [{ kind: 'payoff', of: 'lost' }] }]).m)
    expect(checks(f)).toEqual(['payoff-orphan'])
  })
})

describe('silent arc', () => {
  const chapters = (n: number, arcIn: number[], via: 'arcs' | 'beat' = 'arcs'): Sc[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `s${i}`,
      ch: `c${String(i).padStart(2, '0')}`,
      pov: 'ana',
      ...(arcIn.includes(i)
        ? via === 'arcs'
          ? { arcs: ['debt'] }
          : { changes: [{ who: 'debt', kind: 'beat', value: 'x' }] }
        : {}),
    }))

  it('finds a thread with no beat for a run of chapters, naming them', () => {
    const f = silentArc(story(chapters(12, [0, 10]), { names }).m)
    expect(f).toHaveLength(1)
    expect(f[0]!.body).toBe('debt has no beat for 9 chapters (2–10).')
    expect(f[0]).toMatchObject({ severity: 'warning', group: 'threads', scene: id.scn('s1') })
  })

  it('counts a beat change as moving the arc on, but not what comes after the last beat: an arc that has ended is not one gone quiet', () => {
    expect(silentArc(story(chapters(12, [0, 10], 'beat'), { names }).m)).toHaveLength(1)
    expect(silentArc(story(chapters(10, [0]), { names }).m)).toEqual([])
  })

  it('does not raise a gap shorter than the limit, an arc that is steady, or an arc the book never touches', () => {
    expect(silentArc(story(chapters(12, [0, SILENT_ARC_CHAPTERS, 11]), { names }).m)).toEqual([])
    expect(silentArc(story(chapters(12, [0, 3, 6, 9, 11]), { names }).m)).toEqual([])
    expect(silentArc(story(chapters(12, []), { names }).m)).toEqual([])
  })
})

describe('long absence', () => {
  const book = (n: number, on: number[]): Sc[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `s${i}`,
      ch: `c${String(i).padStart(2, '0')}`,
      pov: on.includes(i) ? 'ana' : 'bob',
    }))

  it('finds a main character off the page for a long run of chapters', () => {
    const f = longAbsence(story(book(14, [0, 1, 2, 12, 13]), { names }).m)
    expect(f).toHaveLength(1)
    expect(f[0]!.body).toBe('ana (main character) has not appeared for 9 chapters (4–12).')
  })

  it('does not raise a gap under the limit, someone who is on the page throughout, or a minor character', () => {
    // ana is away for one chapter fewer than the limit
    expect(
      longAbsence(story(book(14, [0, 1, 2, 3, 3 + LONG_ABSENCE_CHAPTERS, 12, 13]), { names }).m),
    ).toEqual([])
    expect(longAbsence(story(book(14, [...Array(14).keys()]), { names }).m)).toEqual([])
    // cy is named in one scene only: not a main character
    const minor = book(14, [])
    minor[0] = { ...minor[0]!, add: ['cy'] }
    expect(
      longAbsence(story(minor, { names }).m).filter((f) => f.subject === id.chr('cy')),
    ).toEqual([])
  })

  it('does not call it an absence once the character has died', () => {
    const died = book(14, [0, 1, 2])
    died[2] = { ...died[2]!, changes: [die('ana')] }
    expect(longAbsence(story(died, { names }).m)).toEqual([])
  })
})

describe('broken links', () => {
  it('finds a link that points to nothing, and a link that could be two things', () => {
    const f = brokenLinks(
      story([
        {
          key: 'a',
          broken: [
            { text: 'Old Harbor', status: 'missing' },
            { text: 'Bell', status: 'ambiguous' },
            { text: 'Old Harbor', status: 'missing' },
          ],
        },
      ]).m,
    )
    expect(f.map((x) => [x.severity, x.title])).toEqual([
      ['warning', 'Broken link'],
      ['note', 'Link to more than one thing'],
    ])
    expect(f[0]!.body).toBe('“[[Old Harbor]]” in 1.1 · a points to nothing.')
  })

  it('does not raise a text whose links all point somewhere', () => {
    expect(brokenLinks(story([{ key: 'a' }]).m)).toEqual([])
  })
})

describe('branching problems share the list', () => {
  it('adds the story map’s findings to a branching book’s, and none to a straight one', () => {
    const branching = story([{ key: 'a', choices: [['x', 'b']] }, { key: 'b' }], {
      mode: 'branching',
    }).findings()
    expect(checks(branching)).toContain('dead-end')
    expect(branching.find((f) => f.check === 'dead-end')).toMatchObject({
      group: 'story',
      intendable: true,
    })
    expect(story([{ key: 'a' }, { key: 'b' }]).findings()).toEqual([])
  })

  it('never lets a broken choice be marked intended', () => {
    const found = story([{ key: 'a', choices: [['x', 'nowhere']] }], {
      mode: 'branching',
    }).findings()
    const broken = found.find((f) => f.check === 'broken-choice')!
    expect(broken.intendable).toBe(false)
    expect(splitDismissed(found, [broken.fingerprint]).active).toContain(broken)
  })
})

describe('findings: order, fingerprints and marking as intended', () => {
  const messy = (): Sc[] => [
    {
      key: 'a',
      ch: 'c1',
      pov: 'ana',
      at: '412-01-10',
      changes: [die('ana'), { kind: 'setup', id: 's1', value: 'x' }],
    },
    { key: 'b', ch: 'c2', pov: 'bob', add: ['ana'], at: '412-01-08' },
  ]

  it('lists the worst first, then in reading order', () => {
    const f = continuityFindings(story(messy(), { names }).m)
    expect(f.map((x) => [x.severity, x.check])).toEqual([
      ['error', 'appears-after-exit'],
      ['warning', 'time-order'],
      ['note', 'setup-unpaid'],
    ])
  })

  it('gives a finding the same fingerprint every time, whatever the order its subjects are named in, and a different one for another place', () => {
    const [x, y] = [story(messy(), { names }).findings(), story(messy(), { names }).findings()]
    expect(x.map((f) => f.fingerprint)).toEqual(y.map((f) => f.fingerprint))
    expect(new Set(x.map((f) => f.fingerprint)).size).toBe(x.length)
    expect(x[0]!.fingerprint).toBe(
      `appears-after-exit:${[id.chr('ana'), id.scn('b'), id.scn('a')].sort().join(',')}`,
    )
  })

  it('sets aside what the author marked intended, and shows it again when it is not', () => {
    const found = story(messy(), { names }).findings()
    const [first, second] = found
    const split = splitDismissed(found, [first!.fingerprint])
    expect(split.dismissed).toEqual([first])
    expect(split.active).toEqual([second, found[2]])
    expect(splitDismissed(found, []).active).toEqual(found)
  })
})
