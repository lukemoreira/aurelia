// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { anchorOf, mergeChanges, proposalSchema, recordFingerprint, sceneBlocks } from './proposals'

const body = 'First paragraph.\n\nSecond *one*,\non two lines.\n\n\nThird.\n'
const ids = () => sceneBlocks(body).map((b) => b.id)

describe('scene blocks', () => {
  it('splits at blank lines and keeps each block exactly as written, with where it is', () => {
    const blocks = sceneBlocks(body)
    expect(blocks.map((b) => b.text)).toEqual([
      'First paragraph.',
      'Second *one*,\non two lines.',
      'Third.',
    ])
    for (const b of blocks) expect(body.slice(b.start, b.end)).toBe(b.text)
    expect(blocks[1]!.id).toMatch(/^b1-[0-9a-f]{8}$/)
    expect(sceneBlocks('')).toEqual([])
  })
})

describe('Accept: a per-block 3-way merge', () => {
  it('replaces the anchored block and leaves every other byte as it is now', () => {
    const r = mergeChanges(body, [
      { block: ids()[1]!, before: 'Second *one*,\non two lines.', after: 'Second.' },
    ])
    expect(r).toEqual({ ok: true, body: 'First paragraph.\n\nSecond.\n\n\nThird.\n' })
  })

  it('still applies when another block changed meanwhile', () => {
    const now = body.replace('First paragraph.', 'A new first paragraph.\n\nAnd one more.')
    const r = mergeChanges(now, [{ block: ids()[2]!, before: 'Third.', after: 'Third, better.' }])
    expect(r.ok && r.body).toBe(now.replace('Third.', 'Third, better.'))
  })

  it('is refused when the anchored block changed or is gone, and nothing is applied', () => {
    const changes = [
      { block: ids()[0]!, before: 'First paragraph.', after: 'One.' },
      { block: ids()[2]!, before: 'Third.', after: 'Three.' },
    ]
    expect(mergeChanges(body.replace('Third.', 'Third!'), changes)).toEqual({
      ok: false,
      block: ids()[2],
    })
    expect(mergeChanges('First paragraph.', changes)).toEqual({ ok: false, block: ids()[2] })
  })

  it('finds a block that moved when exactly one block reads the same; two the same is a refusal', () => {
    const moved = `Inserted.\n\n${body}`
    expect(mergeChanges(moved, [{ block: ids()[2]!, before: 'Third.', after: 'Three.' }])).toEqual({
      ok: true,
      body: moved.replace('Third.', 'Three.'),
    })
    expect(
      mergeChanges('X.\n\nThird.\n\nThird.', [
        { block: 'b0-00000000', before: 'Third.', after: 'Y' },
      ]).ok,
    ).toBe(false)
  })

  it('removes a block with its blank line, inserts paragraphs, and adds at the end', () => {
    const r = mergeChanges(body, [
      { block: ids()[0]!, before: 'First paragraph.', after: '' },
      { block: ids()[2]!, before: 'Third.', after: 'Third.\n\nA new fourth.' },
      { block: 'end', before: '', after: 'The end.' },
    ])
    expect(r.ok && r.body).toBe(
      'Second *one*,\non two lines.\n\n\nThird.\n\nA new fourth.\n\nThe end.\n',
    )
    expect(mergeChanges('', [{ block: 'end', before: '', after: 'Hello.' }])).toEqual({
      ok: true,
      body: 'Hello.',
    })
  })

  it('two side-by-side removals at the end leave no stray text', () => {
    const r = mergeChanges('A.\n\nB.\n\nC.', [
      { block: 'b1-x', before: 'B.', after: '' },
      { block: 'b2-x', before: 'C.', after: '' },
    ])
    expect(r.ok && r.body.trim()).toBe('A.')
  })

  it('the same block twice in one proposal is a refusal', () => {
    const c = { block: ids()[0]!, before: 'First paragraph.', after: 'x' }
    expect(mergeChanges(body, [c, c]).ok).toBe(false)
  })
})

describe('two paragraphs that read the same', () => {
  const text = 'He asked.\n\n“Yes.”\n\nShe asked.\n\n“Yes.”'
  const blocks = sceneBlocks(text)
  const second = blocks[3]!
  const change = { block: second.id, before: '“Yes.”', after: '“No.”', ...anchorOf(blocks, second) }

  it('the proposal says which one it was: Accept changes that one, even with paragraphs added above', () => {
    expect(change).toMatchObject({ occurrence: 1, copies: 2 })
    const now = `A new opening.\n\nAnother.\n\n${text}`
    expect(mergeChanges(now, [change])).toEqual({
      ok: true,
      body: now.replace(/“Yes\.”$/, '“No.”'),
    })
  })

  it('is refused when their number changed, since which one is then a guess', () => {
    expect(mergeChanges(`“Yes.”\n\n${text}`, [change]).ok).toBe(false)
    expect(mergeChanges(text.replace(/“Yes\.”$/, 'Maybe.'), [change]).ok).toBe(false)
  })
})

describe('an Accept that already happened', () => {
  it('is refused rather than inserting the new text a second time', () => {
    const body = 'One.\n\nTwo.'
    const [one] = sceneBlocks(body)
    const below = { block: one!.id, before: 'One.', after: 'One.\n\nOne and a half.' }
    const above = { block: one!.id, before: 'One.', after: 'Zero.\n\nOne.' }
    const end = { block: 'end', before: '', after: 'Three.' }
    for (const c of [below, above, end]) {
      const first = mergeChanges(body, [c])
      expect(first.ok).toBe(true)
      expect(mergeChanges(first.ok ? first.body : '', [c]).ok).toBe(false)
    }
    // A shorter text that the paragraph happens to begin with is a real change, not "done already".
    expect(mergeChanges(body, [{ block: one!.id, before: 'One.', after: 'One' }]).ok).toBe(true)
  })

  it('also when the change adds paragraphs on both sides', () => {
    const body = 'A.\n\nB.\n\nC.'
    const b = sceneBlocks(body)[1]!
    const both = { block: b.id, before: 'B.', after: 'X.\n\nB.\n\nY.' }
    const first = mergeChanges(body, [both])
    expect(first).toEqual({ ok: true, body: 'A.\n\nX.\n\nB.\n\nY.\n\nC.' })
    expect(mergeChanges(first.ok ? first.body : '', [both]).ok).toBe(false)
  })

  it('but a first Accept is not refused because a neighbour only begins or ends with the same words', () => {
    const below = 'Door.\n\nHe left. Then he came back.'
    const [door] = sceneBlocks(below)
    expect(
      mergeChanges(below, [{ block: door!.id, before: 'Door.', after: 'Door.\n\nHe left.' }]).ok,
    ).toBe(true)
    const above = 'Then. Silence.\n\nNight.'
    const night = sceneBlocks(above)[1]!
    expect(
      mergeChanges(above, [{ block: night.id, before: 'Night.', after: 'Silence.\n\nNight.' }]).ok,
    ).toBe(true)
    const end = { block: 'end', before: '', after: 'The end.' }
    expect(mergeChanges('It was over. The end.', [end]).ok).toBe(true)
  })
})

describe('the proposal file', () => {
  it('reads an edit and a new scene, and refuses anything else', () => {
    const base = {
      schemaVersion: 1,
      id: 'prp_abcdefghjk',
      createdAt: '2026-11-18T00:00:00Z',
      by: 'Claude',
      why: 'Tighter.',
    }
    expect(
      proposalSchema.safeParse({
        ...base,
        kind: 'edit',
        sceneId: 'scn_x',
        sceneTitle: 'X',
        baseHash: 'h',
        changes: [{ block: 'end', before: '', after: 'y' }],
      }).success,
    ).toBe(true)
    expect(
      proposalSchema.safeParse({
        ...base,
        kind: 'scene',
        chapterId: 'chp_x',
        title: 'New',
        text: 'Draft.',
      }).success,
    ).toBe(true)
    expect(proposalSchema.safeParse({ ...base, kind: 'delete', sceneId: 'scn_x' }).success).toBe(
      false,
    )
    expect(
      proposalSchema.safeParse({
        ...base,
        kind: 'edit',
        sceneId: 'scn_x',
        sceneTitle: 'X',
        baseHash: 'h',
        changes: [],
      }).success,
    ).toBe(false)
  })
})

describe('a suggested record delete', () => {
  const base = {
    schemaVersion: 1,
    id: 'prp_abcdefghjk',
    createdAt: '2026-11-18T00:00:00Z',
    by: 'Claude',
    why: 'A duplicate of Archie.',
    kind: 'delete-record',
    recordType: 'character',
    title: 'Archie Collins',
    fingerprint: '0123abcd',
  }

  it('names a record only: never a scene, chapter, part, book, image or proposal', () => {
    expect(proposalSchema.safeParse({ ...base, recordId: 'chr_abcdefghjk' }).success).toBe(true)
    expect(proposalSchema.safeParse({ ...base, recordId: 'lor_abcdefghjk' }).success).toBe(true)
    for (const id of ['scn', 'chp', 'prt', 'bok', 'unv', 'wsp', 'med', 'prp'])
      expect(proposalSchema.safeParse({ ...base, recordId: `${id}_abcdefghjk` }).success).toBe(
        false,
      )
    expect(
      proposalSchema.safeParse({ ...base, recordId: 'chr_abcdefghjk', fingerprint: '' }).success,
    ).toBe(false)
  })

  it('fingerprints a record by its details and notes, whatever order its keys were read in', () => {
    const meta = { id: 'chr_abcdefghjk', type: 'character', title: 'Archie', role: 'Clerk' }
    const fp = recordFingerprint({ meta, body: 'Notes.' } as never)
    expect(fp).toMatch(/^[0-9a-f]{8}$/)
    const reordered = { role: 'Clerk', title: 'Archie', type: 'character', id: 'chr_abcdefghjk' }
    expect(recordFingerprint({ meta: reordered, body: '\nNotes.\n' } as never)).toBe(fp)
    expect(
      recordFingerprint({ meta: { ...meta, role: 'Pilot' }, body: 'Notes.' } as never),
    ).not.toBe(fp)
    expect(recordFingerprint({ meta, body: 'Other notes.' } as never)).not.toBe(fp)
  })
})
