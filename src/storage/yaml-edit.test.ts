// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { patchFrontmatter } from './yaml-edit'

// A hand-kept scene: comments, an unknown key, blank lines, flow lists, quoted and plain strings.
const SCENE = `---
title: The Lantern Gate
schemaVersion: 1
id: scn_4n8w2c7d0p
chapter: chp_6d2t9m4k8s
order: "a3"              # fractional key, sorts within the chapter
status: draft            # idea | outline | draft | revised | final

pov: chr_8f3k2m9q1x
characters:
  add: [chr_1c5v8n2b6z]
  remove: []
mood: 'wet, grey'        # a key Aurelia does not know
changes:
  - { who: chr_1c5v8n2b6z, kind: relation, value: "stranger → creditor" }
---

The bells had already started when [[Elena Vasquez]] reached the Lantern Gate.

* * *
`

describe('patchFrontmatter', () => {
  it('returns the very same text when nothing changes (golden: byte for byte)', () => {
    expect(patchFrontmatter(SCENE, {})).toBe(SCENE)
    expect(patchFrontmatter(SCENE, { status: 'draft', order: 'a3', pov: 'chr_8f3k2m9q1x' })).toBe(
      SCENE,
    )
  })

  it('changes only the field that was set: comments, key order, the body and other keys stay', () => {
    const edited = patchFrontmatter(SCENE, { title: 'The Bell Gate' })
    expect(edited).toBe(SCENE.replace('title: The Lantern Gate', 'title: "The Bell Gate"'))
  })

  it('keeps the comment written after a changed value', () => {
    expect(patchFrontmatter(SCENE, { status: 'revised' })).toBe(
      SCENE.replace('status: draft', 'status: "revised"'),
    )
  })

  it('quotes strings it writes, writes lists of small objects one to a line, and adds new keys last', () => {
    const edited = patchFrontmatter(SCENE, {
      summary: 'She gets in.',
      aliases: [{ text: 'Elena' }, { text: 'Lena', match: 'ask' }],
    })
    expect(edited).toBe(
      SCENE.replace(
        '---\n\nThe bells',
        'summary: "She gets in."\naliases:\n  - { text: "Elena" }\n  - { text: "Lena", match: "ask" }\n---\n\nThe bells',
      ),
    )
  })

  it('takes a key away, and leaves a key that was never there alone', () => {
    expect(patchFrontmatter(SCENE, { pov: undefined })).toBe(
      SCENE.replace('pov: chr_8f3k2m9q1x\n', ''),
    )
    expect(patchFrontmatter(SCENE, { location: undefined })).toBe(SCENE)
  })

  it('keeps long strings on one line', () => {
    const long = 'word '.repeat(60).trim()
    expect(patchFrontmatter(SCENE, { summary: long })).toContain(`summary: "${long}"`)
  })

  it('keeps the file’s own line endings, and a byte order mark', () => {
    const crlf = `\uFEFF${SCENE.replace(/\n/g, '\r\n')}`
    const edited = patchFrontmatter(crlf, { title: 'New' })
    expect(edited).toBe(crlf.replace('title: The Lantern Gate', 'title: "New"'))
    expect(edited).not.toMatch(/[^\r]\n/)
  })

  it('refuses text with no frontmatter or broken YAML, and never loses the body', () => {
    expect(() => patchFrontmatter('Just prose.', { title: 'x' })).toThrow(/no details/)
    expect(() => patchFrontmatter('---\ntitle: [oops\n---\nbody', { title: 'x' })).toThrow(
      /not valid YAML/,
    )
  })

  it('round-trips a title that needs quoting', () => {
    const edited = patchFrontmatter(SCENE, { title: 'He said: "no" # really' })
    expect(edited).toContain('title: "He said: \\"no\\" # really"')
  })

  describe('anchors and aliases', () => {
    const text = '---\ntitle: "T"\nsummary: &s "Shared"\nnote: *s\n---\n\nbody\n'

    it('never changes a value other lines point to: it says why instead', () => {
      expect(() => patchFrontmatter(text, { summary: 'New' })).toThrow(/anchor \(&s\)/)
      expect(() => patchFrontmatter(text, { summary: undefined })).toThrow(/anchor/)
    })

    it('can replace the line that points (the alias goes, the anchored value stays), and edit others', () => {
      expect(patchFrontmatter(text, { note: 'Mine' })).toBe(
        text.replace('note: *s', 'note: "Mine"'),
      )
      expect(patchFrontmatter(text, { title: 'U' })).toBe(text.replace('title: "T"', 'title: "U"'))
    })
  })

  describe('a value with nothing after the colon', () => {
    const text = '---\ntitle: "T"\nsummary:\nid: "x"\nrole:\n---\n\nbody\n'

    it('is set as a proper quoted value, in the middle and at the end', () => {
      expect(patchFrontmatter(text, { summary: 'S' })).toBe(
        text.replace('summary:\n', 'summary: "S"\n'),
      )
      expect(patchFrontmatter(text, { role: 'R' })).toBe(text.replace('role:\n', 'role: "R"\n'))
    })

    it('is taken away whole', () => {
      expect(patchFrontmatter(text, { summary: undefined })).toBe(text.replace('summary:\n', ''))
    })
  })
})
