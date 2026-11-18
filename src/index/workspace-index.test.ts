// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { fixture, id } from '../../tests/helpers/index-fixture'
import { findFolded } from './search'
import { WorkspaceIndex } from './workspace-index'

const universe = id('unv', 1)
const indexOf = (data: ReturnType<typeof fixture>) => {
  const index = new WorkspaceIndex()
  index.sync(data)
  return index
}
const scope1 = { universe, book: id('bok', 1) }
const scope2 = { universe, book: id('bok', 2) }

const ELENA = { n: 1, title: 'Elena Vasquez', aliases: [{ text: 'Elena' }, { text: 'Lena' }] }

describe('what a link points at', () => {
  const data = fixture(
    [
      {
        n: 1,
        title: 'The Gate',
        body: 'See [[Elena Vasquez]] and [[id:chr_0000000001|Elena]] and [[the gate]].',
      },
      { n: 2, title: 'Harbour', body: 'x', book: 2 },
    ],
    [
      ELENA,
      { n: 2, type: 'place', title: 'Harbour Road', scope: 1 },
      { n: 3, type: 'place', title: 'Only In Two', scope: 2 },
    ],
  )
  const index = indexOf(data)

  it('finds a record by its name in any case, by an alias, or by its ID', () => {
    expect(index.resolveName('elena vasquez', scope1)).toMatchObject({
      status: 'ok',
      target: { id: id('chr', 1) },
    })
    expect(index.resolveName('Lena', scope1)).toMatchObject({
      status: 'ok',
      target: { id: id('chr', 1) },
    })
    const a = index.analysis(id('scn', 1))!
    expect(a.links.map((l) => [l.target, l.resolution.status])).toEqual([
      ['Elena Vasquez', 'ok'],
      ['id:chr_0000000001', 'ok'],
      ['the gate', 'ok'], // a scene
    ])
  })

  it('says a link points nowhere, and that is known', () => {
    expect(index.resolveName('Nobody', scope1)).toEqual({ status: 'missing' })
    expect(
      index.resolveLink({ target: 'id:chr_9999999999', id: 'chr_9999999999' } as never, scope1),
    ).toEqual({
      status: 'missing',
    })
  })

  it('keeps a book’s private record to its own book, and looks in the book before the universe', () => {
    expect(index.resolveName('Harbour Road', scope1).status).toBe('ok')
    expect(index.resolveName('Harbour Road', scope2).status).toBe('missing')
    expect(index.resolveName('Only In Two', scope1).status).toBe('missing')
    const both = indexOf(
      fixture(
        [],
        [
          { n: 1, title: 'Corin', type: 'place' },
          { n: 2, title: 'Corin', type: 'place', scope: 1 },
        ],
      ),
    )
    expect(both.resolveName('Corin', scope1)).toMatchObject({
      status: 'ok',
      target: { id: id('plc', 2) },
    })
    expect(both.resolveName('Corin', scope2)).toMatchObject({
      status: 'ok',
      target: { id: id('plc', 1) },
    })
  })

  it('says two with one name are ambiguous; an ID is never', () => {
    const idx = indexOf(
      fixture(
        [],
        [
          { n: 1, title: 'Corin' },
          { n: 2, title: 'Corin', type: 'place' },
        ],
      ),
    )
    const r = idx.resolveName('Corin', scope1)
    expect(r.status).toBe('ambiguous')
    expect(
      idx.resolveLink({ target: 'id:plc_0000000002', id: 'plc_0000000002' } as never, scope1)
        .status,
    ).toBe('ok')
  })

  it('reads a scene by its title, the book’s own first', () => {
    const idx = indexOf(
      fixture([
        { n: 1, title: 'Dusk', body: '', book: 1 },
        { n: 2, title: 'Dusk', body: '', book: 2 },
      ]),
    )
    expect(idx.resolveName('Dusk', scope2)).toMatchObject({
      status: 'ok',
      target: { id: id('scn', 2) },
    })
    expect(idx.resolveName('Dusk', scope1)).toMatchObject({
      status: 'ok',
      target: { id: id('scn', 1) },
    })
  })
})

describe('backlinks and links to', () => {
  const data = fixture(
    [
      { n: 1, body: 'Elena came. [[Elena Vasquez]] left.' },
      { n: 2, body: 'Nothing about her.' },
      { n: 3, body: 'Lena waved. See [[Nobody At All]] and [[Corin]].' },
    ],
    [
      ELENA,
      { n: 2, title: 'Corin' },
      { n: 3, title: 'Corin', type: 'place' },
      { n: 4, title: 'Notes', type: 'item', body: 'Held by [[Elena Vasquez]].' },
    ],
  )
  const index = indexOf(data)

  it('lists every place that links to or names a record, in reading order, with counts', () => {
    expect(index.backlinks(id('chr', 1)).map((b) => [b.from.title, b.links, b.names])).toEqual([
      ['Scene 1', 1, 1],
      ['Scene 3', 0, 1],
      ['Notes', 1, 0],
    ])
    expect(index.backlinks(id('chr', 1)).at(-1)!.from.kind).toBe('record')
  })

  it('lists what a scene links to, including links that go nowhere or to two things', () => {
    const out = index.linksTo(id('scn', 3))
    expect(out.map((o) => [o.text, o.status, o.target?.id, o.links, o.names])).toEqual([
      ['Nobody At All', 'missing', undefined, 1, 0],
      ['Corin', 'ambiguous', undefined, 1, 0],
      ['Elena Vasquez', 'ok', id('chr', 1), 0, 1],
    ])
  })

  it('a link inside a name does not count the name twice', () => {
    const f = index.foundNames(id('scn', 1))
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ count: 2 })
    expect(f[0]!.forms.map((x) => x.text).sort()).toEqual(['Elena', 'Elena Vasquez'])
  })
})

describe('names found in a scene (ADR-0010)', () => {
  const records = [
    ELENA,
    {
      n: 2,
      title: 'Will Ashby',
      aliases: [{ text: 'Will' }, { text: 'Ashby', match: 'ask' as const }],
    },
    { n: 3, title: 'Corin' },
    { n: 4, title: 'Corin', type: 'place' as const },
    { n: 5, title: 'Greywater', type: 'place' as const, scope: 2 as const },
  ]

  it('tags what one record owns, asks about what two share, asks per alias, ignores the rest', () => {
    const idx = indexOf(
      fixture(
        [
          {
            n: 1,
            body: 'Elena met Corin. Will ran. She said Will knew Ashby. Greywater, Elenath.',
          },
        ],
        records,
      ),
    )
    const a = idx.analysis(id('scn', 1))!
    expect(a.mentions.map((m) => [m.text, m.status, m.reason ?? ''])).toEqual([
      ['Elena', 'tagged', ''],
      ['Corin', 'suggest', 'shared'],
      ['Will', 'suggest', 'sentence-start'],
      ['Will', 'tagged', ''],
      ['Ashby', 'suggest', 'ask'],
    ])
    // Greywater is private to book 2, so book 1 does not see it.
    expect(a.mentions.some((m) => m.text === 'Greywater')).toBe(false)
  })

  it('answers "not a name" from the scene’s own ignoreNames, and only that place', () => {
    const body = 'Will ran. Will you stop? She said Will knew.'
    const open = indexOf(fixture([{ n: 1, body }], records)).analysis(id('scn', 1))!
    expect(open.mentions.filter((m) => m.status === 'suggest')).toHaveLength(2)
    const answered = indexOf(fixture([{ n: 1, body, ignoreNames: ['Will:2'] }], records)).analysis(
      id('scn', 1),
    )!
    expect(answered.mentions.map((m) => [m.start, m.status])).toEqual([
      [0, 'suggest'],
      [body.lastIndexOf('Will'), 'tagged'],
    ])
  })

  it('groups the open questions by word and lists who it might be', () => {
    const idx = indexOf(fixture([{ n: 1, body: 'Corin ran. Corin hid. Will you?' }], records))
    const q = idx.openQuestions(id('scn', 1))
    expect(q.map((x) => [x.text, x.count, x.reason, x.candidates.map((c) => c.label)])).toEqual([
      ['Corin', 2, 'shared', ['Character', 'Place']],
      ['Will', 1, 'sentence-start', ['Character']],
    ])
  })

  it('gives the ignore keys of every place a word is found', () => {
    const idx = indexOf(fixture([{ n: 1, body: 'Will ran. Will you? Will had.' }], records))
    expect(idx.ignoreKeys(id('scn', 1), 'Will')).toEqual(['Will:1', 'Will:2', 'Will:3'])
  })

  it('finds a name in a record’s notes too, from that record’s own scope', () => {
    const idx = indexOf(
      fixture([], [...records, { n: 6, type: 'note', title: 'Plan', body: 'Elena goes.' }]),
    )
    expect(idx.analysis(id('nte', 6))!.mentions.map((m) => m.text)).toEqual(['Elena'])
  })
})

describe('a character is found by the short forms of its title (ADR-0010, 2026-11-18)', () => {
  const ARCHIE = { n: 1, title: '“Archie” Archibald Collins' }
  const mentions = (records: Parameters<typeof fixture>[1], body: string) =>
    indexOf(fixture([{ n: 1, body }], records))
      .analysis(id('scn', 1))!
      .mentions.map((m) => [m.text, m.status, m.recordIds.join(',')])

  it('tags a nickname, a first name and a last name one character has', () => {
    expect(mentions([ARCHIE], 'Then Archie ran, and Collins too.')).toEqual([
      ['Archie', 'tagged', id('chr', 1)],
      ['Collins', 'tagged', id('chr', 1)],
    ])
  })

  it('leaves a word that is any record’s own name to that record', () => {
    const kent = [
      { n: 1, title: 'Thomas "Tommy" Kent' },
      { n: 2, title: 'Kent', type: 'place' as const },
    ]
    expect(mentions(kent, 'So Tommy rode to Kent.')).toEqual([
      ['Tommy', 'tagged', id('chr', 1)],
      ['Kent', 'tagged', id('plc', 2)],
    ])
    const alias = [ARCHIE, { n: 2, title: 'Mr Archer', aliases: [{ text: 'Archie' }] }]
    expect(mentions(alias, 'Then Archie ran.')).toEqual([['Archie', 'tagged', id('chr', 2)]])
  })

  it('asks about a short form two characters share, and about an ordinary word', () => {
    const two = [ARCHIE, { n: 2, title: 'Mary Collins' }, { n: 3, title: 'Will Turner' }]
    expect(mentions(two, 'Then Collins ran, and Will.')).toEqual([
      ['Collins', 'suggest', `${id('chr', 1)},${id('chr', 2)}`],
      ['Will', 'suggest', id('chr', 3)],
    ])
  })

  it('drops one the character said never to, and then the other character has it alone', () => {
    const two = [
      { ...ARCHIE, aliases: [{ text: 'Collins', match: 'never' as const }] },
      { n: 2, title: 'Mary Collins' },
    ]
    expect(mentions(two, 'Then Collins ran.')).toEqual([['Collins', 'tagged', id('chr', 2)]])
    const off = [{ ...ARCHIE, aliases: [{ text: 'Archie', match: 'never' as const }] }]
    expect(mentions(off, 'Then Archie ran.')).toEqual([])
  })

  it('is for characters only, and lists them for the character’s page', () => {
    const place = [{ n: 1, title: 'Lantern Gate', type: 'place' as const }]
    expect(mentions(place, 'At the Gate, by the Lantern.')).toEqual([])
    // An ordinary word that is a last name is asked about, not tagged ("Young people…").
    expect(mentions([{ n: 1, title: 'Grace Young' }], 'Then Young came.')).toEqual([
      ['Young', 'suggest', id('chr', 1)],
    ])
    const idx = indexOf(fixture([], [ARCHIE, { n: 2, title: 'Mary Collins' }]))
    expect(idx.shortFormsOf(id('chr', 1)).map((f) => [f.text, f.mode])).toEqual([
      ['Archie', 'auto'],
      ['Archibald', 'auto'],
      ['Collins', 'ask'],
    ])
  })
})

describe('an edit re-reads only the file it changed', () => {
  it('keeps the other files’ results, and re-works a file when a name changes', () => {
    const data = fixture(
      [
        { n: 1, body: 'Elena ran.' },
        { n: 2, body: 'Elena hid.' },
      ],
      [ELENA],
    )
    const index = indexOf(data)
    const one = index.analysis(id('scn', 1))!
    const two = index.analysis(id('scn', 2))!

    // A keystroke in scene 2: a new scene object, the rest are the objects they were.
    const typed = {
      ...data,
      scenes: data.scenes.map((s, i) => (i === 1 ? { ...s, body: 'Elena hid well.' } : s)),
    }
    index.sync(typed)
    expect(index.analysis(id('scn', 1))).toBe(one)
    expect(index.analysis(id('scn', 2))).not.toBe(two)

    // A new alias is a change to what a name points at: every scene is read again.
    const named = {
      ...typed,
      records: typed.records.map((r) => ({
        ...r,
        meta: { ...r.meta, aliases: [...(r.meta.aliases ?? []), { text: 'ran' }] },
      })),
    }
    const before = index.version
    index.sync(named)
    expect(index.version).toBeGreaterThan(before)
    expect(index.analysis(id('scn', 1))).not.toBe(one)
    expect(index.analysis(id('scn', 1))!.mentions.map((m) => m.text)).toEqual(['Elena', 'ran'])
  })

  it('does not treat typing in a scene as a change of names', () => {
    const data = fixture([{ n: 1, body: 'a' }], [ELENA])
    const index = indexOf(data)
    const before = index.version
    index.sync({ ...data, scenes: [{ ...data.scenes[0]!, body: 'ab' }] })
    expect(index.version).toBe(before)
  })

  it('forgets a file that is gone', () => {
    const data = fixture([{ n: 1, body: '[[Elena Vasquez]]' }], [ELENA])
    const index = indexOf(data)
    expect(index.backlinks(id('chr', 1))).toHaveLength(1)
    index.sync({ ...data, scenes: [] })
    expect(index.backlinks(id('chr', 1))).toEqual([])
    expect(index.analysis(id('scn', 1))).toBeUndefined()
  })
})

describe('picking a link target', () => {
  const idx = indexOf(
    fixture(
      [{ n: 1, title: 'Curfew Bells', body: '' }],
      [
        ELENA,
        { n: 2, title: 'Corin' },
        { n: 3, title: 'Corin', type: 'place' },
        { n: 4, title: 'Lantern Gate', type: 'place', scope: 2 },
      ],
    ),
  )

  it('lists records and scenes seen from the book, best match first, with their type', () => {
    expect(idx.pick('co', scope1).map((p) => [p.title, p.label])).toEqual([
      ['Corin', 'Character'],
      ['Corin', 'Place'],
    ])
    expect(idx.pick('curf', scope1).map((p) => p.title)).toEqual(['Curfew Bells'])
  })

  it('finds a record by an alias, and not another book’s private record', () => {
    expect(idx.pick('lena', scope1).map((p) => p.title)).toEqual(['Elena Vasquez'])
    expect(idx.pick('lantern', scope1)).toEqual([])
    expect(idx.pick('lantern', scope2).map((p) => p.title)).toEqual(['Lantern Gate'])
  })

  it('marks the ones that share a name, so the picker writes an ID for them', () => {
    expect(idx.pick('corin', scope1).map((p) => p.byId)).toEqual([true, true])
    expect(idx.pick('elena', scope1).map((p) => p.byId)).toEqual([false])
  })

  it('lists something for an empty query', () => {
    expect(idx.pick('', scope1).length).toBeGreaterThan(0)
  })
})

describe('search', () => {
  const data = fixture(
    [
      {
        n: 1,
        title: 'Curfew Bells',
        body: 'The bells rang for the curfew. A lantern burned over the gate.',
      },
      { n: 2, title: 'Lanterns', body: 'Nothing here but quiet.' },
      { n: 3, title: 'Low Water', body: 'Élena counted the warden’s steps to the old harbour.' },
    ],
    [
      {
        n: 1,
        type: 'place',
        title: 'The Lantern Gate',
        aliases: [{ text: 'the Old Gate' }],
        body: 'Built before the tide.',
      },
    ],
  )

  it('ranks a title above a body, and finds words in the text with the line around them', () => {
    const hits = indexOf(data).search('lantern')
    expect(hits.map((h) => h.title)).toEqual(['The Lantern Gate', 'Lanterns', 'Curfew Bells'])
    expect(hits.at(-1)!.snippet).toContain('lantern burned over the gate')
    expect(hits[0]!.snippet).toBeUndefined() // found in its title: nothing to show
  })

  it('finds a prefix, an alias, a word without its accent or apostrophe, and nothing for nonsense', () => {
    const idx = indexOf(data)
    expect(idx.search('curf').map((h) => h.id)).toEqual([id('scn', 1)])
    expect(idx.search('old gate')[0]!.title).toBe('The Lantern Gate')
    expect(idx.search('elena')[0]!.id).toBe(id('scn', 3))
    expect(idx.search('wardens')[0]!.id).toBe(id('scn', 3))
    expect(idx.search('zzzzzz')).toEqual([])
    expect(idx.search('   ')).toEqual([])
  })

  it('searches record notes, and follows an edit and a deletion', () => {
    const index = indexOf(data)
    expect(index.search('tide')[0]!.id).toBe(id('plc', 1))
    index.sync({
      ...data,
      scenes: data.scenes.map((s, i) => (i === 1 ? { ...s, body: 'A tide came in.' } : s)),
    })
    expect(
      index
        .search('tide')
        .map((h) => h.id)
        .sort(),
    ).toEqual([id('plc', 1), id('scn', 2)].sort())
    expect(index.search('quiet')).toEqual([])
    index.sync({ ...data, scenes: [], records: [] })
    expect(index.search('tide')).toEqual([])
  })

  it('finds a word in a summary, with the line it is in', () => {
    const idx = indexOf(
      fixture(
        [{ n: 1, title: 'Gate', body: 'Nothing.', summary: 'The curfew bell rings twice.' }],
        [{ n: 1, type: 'place', title: 'The Lantern Gate', summary: 'Where the curfew is kept.' }],
      ),
    )
    const hits = idx.search('curfew')
    expect(hits.map((h) => h.title).sort()).toEqual(['Gate', 'The Lantern Gate'])
    expect(hits.find((h) => h.title === 'The Lantern Gate')!.snippet).toBe(
      'Where the curfew is kept.',
    )
  })
})

describe('how a record is written across the workspace', () => {
  it('counts each form and the files it is in, and the places that are still a question', () => {
    const idx = indexOf(
      fixture(
        [
          { n: 1, body: 'Elena ran. [[Elena Vasquez|Lena]] hid.' },
          { n: 2, body: 'Elena slept.' },
          { n: 3, body: 'Corin swam.' },
        ],
        [ELENA, { n: 2, title: 'Corin' }, { n: 3, title: 'Corin', type: 'place' }],
      ),
    )
    const usage = idx.nameUsage(id('chr', 1))
    expect(usage.forms).toEqual([
      { text: 'Elena', count: 2 },
      { text: 'Lena', count: 1 },
    ])
    expect(usage.files).toBe(2)
    expect(idx.nameUsage(id('chr', 2))).toEqual({ forms: [], files: 0, questions: 1 })
  })
})

describe('search: the line around a match', () => {
  const idx = indexOf(
    fixture(
      [
        {
          n: 1,
          title: 'Low Water',
          body: 'Before that, Élena counted the warden’s steps to the old harbour and the lanterns.',
        },
        { n: 2, title: 'Dusk', body: 'The  harbour\nlights   came on.' },
      ],
      [],
    ),
  )
  const marked = (h: { snippet?: string; marks?: [number, number][] }) =>
    h.marks!.map(([a, b]) => h.snippet!.slice(a, b))

  it('is found the way search folds: accents, apostrophes, fuzzy and prefix, and marks the words found', () => {
    const [hit] = idx.search('elena')
    expect(hit!.snippet).toBe(
      'Before that, Élena counted the warden’s steps to the old harbour and the lanterns.',
    )
    expect(marked(hit!)).toEqual(['Élena'])
    expect(hit!.term).toBe('elena')
    // A fuzzy match marks the word as it is written, not as it was typed.
    expect(marked(idx.search('wardn')[0]!)).toEqual(['warden'])
    expect(marked(idx.search('lantern')[0]!)).toEqual(['lanterns'])
  })

  it('squeezes white space and still marks the right words', () => {
    const [hit] = idx.search('lights')
    expect(hit!.snippet).toBe('The harbour lights came on.')
    expect(marked(hit!)).toEqual(['lights'])
  })

  it('finds the first place a word is written, as the editor opens a result at it', () => {
    expect(findFolded('Before Élena’s hat and Elena again', 'elena')).toEqual([7, 12])
    expect(findFolded('Nothing', 'elena')).toBeNull()
    expect(findFolded('xElena', 'elena')).toBeNull() // starts a word, never the middle of one
  })
})

describe('a title Markdown would read is picked by its ID', () => {
  it('marks titles with * _ [ ] < ~ | and backticks, and no ordinary one', () => {
    const idx = indexOf(
      fixture(
        [],
        [
          { n: 1, title: 'Star*Gate' },
          { n: 2, title: 'Lantern Gate', type: 'place' },
          { n: 3, title: 'Snake_case' },
        ],
      ),
    )
    expect(idx.pick('', scope1).map((p) => [p.title, p.byId])).toEqual([
      ['Star*Gate', true],
      ['Lantern Gate', false],
      ['Snake_case', true],
    ])
  })
})
