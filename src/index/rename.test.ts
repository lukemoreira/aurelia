// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { fixture, id } from '../../tests/helpers/index-fixture'
import {
  applyPlaces,
  certainPlaces,
  planRename,
  proposeForms,
  renamedAliases,
  rewrites,
} from './rename'
import { WorkspaceIndex } from './workspace-index'

const OLD = { title: 'Elena Vasquez', aliases: [{ text: 'Elena' }, { text: 'Lena' }] }
const FORMS = proposeForms(OLD.title, 'Helena Vasquez', OLD.aliases)

/** The workspace after the title was renamed (the aliases are still the old ones). */
function after(bodies: string[], more: Parameters<typeof fixture>[1] = []) {
  const data = fixture(
    bodies.map((body, i) => ({ n: i + 1, body })),
    [{ n: 1, title: 'Helena Vasquez', aliases: OLD.aliases }, ...more],
  )
  const index = new WorkspaceIndex()
  index.sync(data)
  return index
}
const plan = (bodies: string[], more: Parameters<typeof fixture>[1] = []) =>
  planRename(after(bodies, more), id('chr', 1), OLD, FORMS)
const changed = (bodies: string[], more: Parameters<typeof fixture>[1] = []) => {
  const p = plan(bodies, more)
  return rewrites(p, certainPlaces(p)).map((r) => r.after)
}

describe('which forms become what', () => {
  it('carries a changed word through every form that holds it, and keeps the rest', () => {
    expect(FORMS).toEqual([
      { from: 'Elena Vasquez', to: 'Helena Vasquez' },
      { from: 'Elena', to: 'Helena' },
      { from: 'Lena', to: 'Lena' },
    ])
  })

  it('changes only the title when its words are not changed one for one', () => {
    expect(proposeForms('Elena', 'Elena Vasquez', [{ text: 'Lena' }])).toEqual([
      { from: 'Elena', to: 'Elena Vasquez' },
      { from: 'Lena', to: 'Lena' },
    ])
  })

  it('follows in the record’s own list of other names, leaving what is kept', () => {
    expect(renamedAliases([{ text: 'Elena', match: 'ask' }, { text: 'Lena' }], FORMS)).toEqual([
      { text: 'Helena', match: 'ask' },
      { text: 'Lena' },
    ])
  })
})

describe('renaming Elena', () => {
  it('changes the name and its possessive, longest form first, and never a longer word or an address', () => {
    const body =
      "Elena Vasquez met Elena’s brother. Elenath, elena@example.com and Elena@example.com stay. Elena's too."
    expect(changed([body])).toEqual([
      "Helena Vasquez met Helena’s brother. Elenath, elena@example.com and Elena@example.com stay. Helena's too.",
    ])
  })

  it('counts every form, the kept ones too, and lists only the places that change', () => {
    const p = plan(['Elena Vasquez, Elena and Lena. Lena again.'])
    expect(p.forms.map((f) => [f.from, f.count])).toEqual([
      ['Elena Vasquez', 1],
      ['Elena', 1],
      ['Lena', 2],
    ])
    expect(p.places.map((x) => [x.old, x.next])).toEqual([
      ['Elena Vasquez', 'Helena Vasquez'],
      ['Elena', 'Helena'],
    ])
  })

  it('changes the name inside links and keeps their IDs', () => {
    const body =
      'See [[Elena Vasquez]], [[Elena Vasquez|Elena]], [[id:chr_0000000001|Elena]] and [[id:chr_0000000001]].'
    expect(changed([body])).toEqual([
      'See [[Helena Vasquez]], [[Helena Vasquez|Helena]], [[id:chr_0000000001|Helena]] and [[id:chr_0000000001]].',
    ])
  })

  it('leaves a link to another record alone, and a name that is another record’s', () => {
    const body = '[[Elena Marsh]] and [[id:chr_0000000009|Elena]] and Elena Marsh.'
    expect(changed([body], [{ n: 9, title: 'Elena Marsh' }])).toEqual([])
  })

  it('does not tick what is uncertain: a title in quotes, a shared name, a name set to ask, an ordinary word', () => {
    const body = [
      'They sang “Elena of the Tides” until dawn.',
      '“Where is Elena?” he asked, and Elena answered.',
      'Corin swam.',
    ].join('\n\n')
    const p = plan([body], [{ n: 5, title: 'Corin', aliases: [{ text: 'Elena' }] }])
    // "Elena" is now also Corin's alias: every plain "Elena" is a question, and the title one is too.
    expect(p.places.map((x) => [x.old, x.uncertain ? 'unticked' : 'ticked'])).toEqual([
      ['Elena', 'unticked'],
      ['Elena', 'unticked'],
      ['Elena', 'unticked'],
    ])
    expect(p.places.map((x) => x.uncertain)).toEqual([
      'Uncertain — another record has this name',
      'Uncertain — another record has this name',
      'Uncertain — another record has this name',
    ])
  })

  it('marks a title in quotes as uncertain, and speech as certain', () => {
    const p = plan([
      'They sang “Elena of the Tides” until dawn.\n\n“Where is Elena?” he asked. “Elena, come.”',
    ])
    expect(p.places.map((x) => !!x.uncertain)).toEqual([true, false, false])
    expect(p.places[0]!.uncertain).toBe('Uncertain — inside a title in quotes')
  })

  it('finds the name in a record’s notes too, with where it is', () => {
    const p = plan([], [{ n: 8, type: 'note', title: 'Plan', body: 'Elena leaves.' }])
    expect(p.places.map((x) => [x.where, x.old])).toEqual([['Note · Plan', 'Elena']])
  })

  it('shows the words around a place on one line', () => {
    const p = plan([
      'One two three four five six seven eight nine ten Elena eleven twelve thirteen fourteen fifteen sixteen seventeen.',
    ])
    expect(p.places[0]).toMatchObject({
      before: expect.stringMatching(/^….*ten $/),
      after: expect.stringMatching(/^ eleven.*…$/),
    })
  })

  it('leaves out a question the author answered, and never ticks a real name that now carries that answer', () => {
    const idx = (body: string, ignoreNames: string[]) => {
      const i = new WorkspaceIndex()
      i.sync(
        fixture(
          [{ n: 1, body, ignoreNames }],
          [
            {
              n: 1,
              title: 'Helena Vasquez',
              aliases: [...OLD.aliases, { text: 'Will', match: 'ask' }],
            },
          ],
        ),
      )
      return i
    }
    // "Will" is asked about (a mode of ask): the answered one is not a place.
    const withWill = {
      title: OLD.title,
      aliases: [...OLD.aliases, { text: 'Will', match: 'ask' as const }],
    }
    const asked = planRename(idx('Will ran. Will hid.', ['Will:1']), id('chr', 1), withWill, [
      ...FORMS,
      { from: 'Will', to: 'Wills' },
    ])
    expect(asked.places.map((x) => x.start)).toEqual([10])
    // "Elena" is a real name: an answer that landed on it by number does not hide it, nor tick it.
    const real = planRename(idx('Elena ran. Elena hid.', ['Elena:2']), id('chr', 1), OLD, FORMS)
    expect(real.places.map((x) => [x.start, x.uncertain ?? ''])).toEqual([
      [0, ''],
      [11, 'Uncertain — you said an earlier “Elena” is not a name'],
    ])
  })

  it('reads a book’s own record in that book only, and a shared one everywhere', () => {
    const data = fixture(
      [
        { n: 1, body: 'Elena in book one.', book: 1 },
        { n: 2, body: 'Elena in book two.', book: 2 },
      ],
      [
        { n: 1, title: 'Helena Vasquez', aliases: OLD.aliases, scope: 1 },
        { n: 2, type: 'note', title: 'Shared notes', body: 'Elena in a shared note.' },
        { n: 3, type: 'note', title: 'Book two notes', body: 'Elena in book two.', scope: 2 },
        { n: 4, type: 'note', title: 'Book one notes', body: 'Elena in book one.', scope: 1 },
      ],
    )
    const idx = new WorkspaceIndex()
    idx.sync(data)
    const own = planRename(idx, id('chr', 1), OLD, FORMS)
    expect(own.places.map((x) => x.where)).toEqual(['Book 1 · Scene 1', 'Note · Book one notes'])
    expect(own.places[0]).toMatchObject({ bookId: id('bok', 1) })
    // The same name belongs to a shared record: every book, and shared notes.
    const shared = new WorkspaceIndex()
    shared.sync({
      ...data,
      records: data.records.map((r) =>
        r.meta.id === id('chr', 1) ? { ...r, meta: { ...r.meta, scope: 'universe' } } : r,
      ),
    })
    expect(planRename(shared, id('chr', 1), OLD, FORMS).places).toHaveLength(5)
  })

  it('leaves raw HTML and fences as written, and renames in the cells of a table and in a footnote', () => {
    const body = [
      'Elena ran.',
      '<div>Elena in html</div>',
      '| Elena | table |\n|---|---|\n| Elena | x |',
      '```\nElena in code\n```',
      'Elena again.[^1]',
      '[^1]: Elena’s note.',
    ].join('\n\n')
    const cells = [...body.matchAll(/\| (Elena) \|/g)].map((m) => m.index! + 2)
    expect(plan([body]).places.map((x) => x.start)).toEqual([
      0,
      ...cells,
      body.indexOf('Elena again'),
      body.indexOf('Elena’s'),
    ])
  })

  it('never rewrites a footnote’s label, though the words of the note are renamed', () => {
    const body = 'Elena ran[^Elena] and[^Elena].\n\n[^Elena]: Elena’s note.\n'
    expect(plan([body]).places.map((x) => x.start)).toEqual([0, body.indexOf('Elena’s')])
  })

  it('writes a name Markdown would read escaped, in text; and not into a link that cannot hold it', () => {
    const named = (to: string, body: string) =>
      planRename(
        (() => {
          const i = new WorkspaceIndex()
          i.sync(fixture([{ n: 1, body }], [{ n: 1, title: 'X', aliases: OLD.aliases }]))
          return i
        })(),
        id('chr', 1),
        OLD,
        [{ from: 'Elena', to }],
      )
    const p = named('Hel*en_a', 'Elena ran. [[Elena]] hid.')
    expect(p.places.map((x) => x.next)).toEqual(['Hel\\*en\\_a', 'Hel*en_a'])
    expect(named('He|len', '[[Elena]]').places).toEqual([])
  })

  it('never rewrites a Markdown link’s target and title, nor a reference link’s label', () => {
    expect(
      changed(['Elena read [the notes](notes/elena.md "Elena") and [the list][elena].\n']),
    ).toEqual(['Helena read [the notes](notes/elena.md "Elena") and [the list][elena].\n'])
  })

  it('never makes a line a heading or a list: a new name that would is written escaped', () => {
    const forms = proposeForms('Elena', '- Elena', [])
    const p = planRename(
      after(['Line\nElena here.\n']),
      id('chr', 1),
      { title: 'Elena', aliases: [] },
      forms,
    )
    expect(rewrites(p, certainPlaces(p)).map((r) => r.after)).toEqual(['Line\n\\- Elena here.\n'])
  })

  it('nor a heading or a list inside a list item or a quote', () => {
    const forms = proposeForms('Elena', '# Elena', [])
    const p = planRename(
      after(['- Elena here.\n', '> Elena there.\n']),
      id('chr', 1),
      { title: 'Elena', aliases: [] },
      forms,
    )
    expect(rewrites(p, certainPlaces(p)).map((r) => r.after)).toEqual([
      '- \\# Elena here.\n',
      '> \\# Elena there.\n',
    ])
  })

  it('changes a name after an escaped bracket: `\\](` in plain text is not a link', () => {
    expect(changed(['\\[sic\\](see Elena) Elena.\n'])).toEqual(['\\[sic\\](see Helena) Helena.\n'])
  })

  it('writes only the ticked places and refuses a text that has changed since', () => {
    const p = plan(['Elena ran. Elena hid.'])
    const [first, second] = p.places
    expect(rewrites(p, new Set([second!.key]))[0]!.after).toBe('Elena ran. Helena hid.')
    expect(() => applyPlaces('Someone typed here.', [first!])).toThrow('changed')
  })
})

describe('renaming a character found by its short forms', () => {
  it('changes only the title and the typed names, never a short form of the title', () => {
    const index = new WorkspaceIndex()
    const body = '“Archie” Archibald Collins came. Archie ran, Collins hid.'
    index.sync(fixture([{ n: 1, body }], [{ n: 1, title: 'Archibald Collinson' }]))
    const p = planRename(
      index,
      id('chr', 1),
      { title: '“Archie” Archibald Collins', aliases: [] },
      [{ from: '“Archie” Archibald Collins', to: 'Archibald Collinson' }],
    )
    expect(p.places).toEqual([])
    const typed = new WorkspaceIndex()
    typed.sync(
      fixture(
        [{ n: 1, body: 'Archibald Collins came. Collins hid.' }],
        [{ n: 1, title: 'Archibald Collinson' }],
      ),
    )
    const q = planRename(typed, id('chr', 1), { title: 'Archibald Collins', aliases: [] }, [
      { from: 'Archibald Collins', to: 'Archibald Collinson' },
    ])
    expect(q.places.map((x) => [x.old, x.next])).toEqual([
      ['Archibald Collins', 'Archibald Collinson'],
    ])
  })
})
