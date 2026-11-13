// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { bodyForEditor, newHead, parseFrontmatter, splitDocument, withBody } from './frontmatter'

const FILES: Record<string, string> = {
  plain: '---\ntitle: "A"\nid: "scn_a"\n---\n\nBody text.\n',
  'comments and key order':
    '---\ntitle: "A"   # the name\nz: 1\na: 2\n# a note\nid: "scn_a"\n---\n\nBody',
  'no blank line': '---\ntitle: "A"\n---\nBody right after',
  'several blank lines': '---\ntitle: "A"\n---\n\n\n\nBody after gaps',
  'empty body': '---\ntitle: "A"\n---\n\n',
  'no body at all': '---\ntitle: "A"\n---',
  'empty frontmatter': '---\n---\nBody',
  windows: '---\r\ntitle: "A"\r\n---\r\n\r\nLine one\r\nLine two\r\n',
  bom: '﻿---\ntitle: "A"\n---\n\nBody',
  'a horizontal rule in the body': '---\ntitle: "A"\n---\n\nAbove\n\n---\n\nBelow',
  'scene break and wiki links':
    '---\ntitle: "A"\n---\n\n[[id:chr_x|Elena]] waited.\n\n* * *\n\nThen left.',
}

describe('splitting a Markdown file', () => {
  for (const [name, text] of Object.entries(FILES))
    it(`${name}: head + body is the file, byte for byte`, () => {
      const parts = splitDocument(text)!
      expect(parts.head + parts.body).toBe(text)
      // Unchanged text through the editor and back is the same file: nothing is rewritten on a plain open.
      expect(withBody(parts.head, bodyForEditor(parts.head, parts.body))).toBe(text)
    })

  it('finds the details and the body', () => {
    const parts = splitDocument(FILES.plain!)!
    expect(parts.yaml).toBe('title: "A"\nid: "scn_a"')
    expect(parts.body).toBe('Body text.\n')
  })

  it('a rule inside the body is not taken for the end of the details', () => {
    expect(splitDocument(FILES['a horizontal rule in the body']!)!.body).toBe(
      'Above\n\n---\n\nBelow',
    )
  })

  it('has no details when the file does not start with them', () => {
    expect(splitDocument('Just text.')).toBeNull()
    expect(splitDocument('\n---\ntitle: x\n---\n')).toBeNull()
  })

  it('replaces only the body: the head is untouched, comments and key order included', () => {
    const parts = splitDocument(FILES['comments and key order']!)!
    expect(withBody(parts.head, 'New words.')).toBe(`${parts.head}New words.`)
  })

  it('keeps Windows line endings in the body the editor sends back', () => {
    const parts = splitDocument(FILES.windows!)!
    expect(bodyForEditor(parts.head, parts.body)).toBe('Line one\nLine two\n')
    expect(withBody(parts.head, 'a\nb')).toBe(`${parts.head}a\r\nb`)
  })
})

describe('frontmatter data', () => {
  it('reads YAML as data, empty as an empty object', () => {
    expect(parseFrontmatter('title: "A"\norder: "a3"')).toEqual({ title: 'A', order: 'a3' })
    expect(parseFrontmatter('')).toEqual({})
  })

  it('says the details are not valid YAML instead of throwing a parser trace', () => {
    expect(() => parseFrontmatter('title: [oops')).toThrow(/not valid YAML/)
  })

  it('writes a new head with title first and every string quoted', () => {
    const head = newHead({ title: 'Untitled scene', schemaVersion: 1, id: 'scn_a', order: 'a' })
    expect(head).toBe(
      '---\ntitle: "Untitled scene"\nschemaVersion: 1\nid: "scn_a"\norder: "a"\n---\n\n',
    )
    expect(parseFrontmatter(splitDocument(head)!.yaml)).toEqual({
      title: 'Untitled scene',
      schemaVersion: 1,
      id: 'scn_a',
      order: 'a',
    })
  })
})
