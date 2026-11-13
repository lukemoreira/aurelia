// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { schema } from '../extensions'
import { bodyToDoc, docToBody } from './body'

const files = import.meta.glob('../../../tests/golden/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const named = Object.entries(files).map(([path, text]) => ({
  name: path.split('/golden/')[1]!,
  text,
  // `foreign/` holds files written by other apps: not in this editor's own form.
  canonical: !path.includes('/foreign/'),
}))

/** The document with no memory of the file: every block is written fresh. */
const forgotten = (doc: JSONContent): JSONContent => ({
  ...doc,
  content: doc.content?.map((b) => {
    const attrs = { ...b.attrs }
    delete attrs.src
    delete attrs.sig
    return { ...b, attrs }
  }),
})
const toBody = (doc: JSONContent) => docToBody(schema.nodeFromJSON(doc))

describe('golden files', () => {
  it('has a golden file for every feature the editor edits', () => {
    expect(named.map((n) => n.name).sort()).toEqual([
      'block-ids.md',
      'breaks.md',
      'escapes.md',
      'foreign/obsidian-style.md',
      'headings.md',
      'html.md',
      'lists.md',
      'marks.md',
      'paragraphs.md',
      'quote-callout.md',
      'raw-kept.md',
      'scene-break.md',
      'wiki-links.md',
    ])
  })

  describe.each(named)('$name', ({ text, canonical }) => {
    it('is written back byte for byte when nothing is edited', () => {
      expect(toBody(bodyToDoc(text))).toBe(text)
    })
    it.runIf(canonical)('is what the editor writes for the same document', () => {
      expect(toBody(forgotten(bodyToDoc(text)))).toBe(text)
    })
  })
})
