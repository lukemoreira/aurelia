// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { linkText, parseLinks } from './links'

describe('parseLinks', () => {
  it('reads the four forms and the embed', () => {
    const text =
      'See [[Elena Vasquez]] and [[Elena Vasquez|Elena]] and [[id:chr_8f3k2m9q1x]].\n\n![[Gate]]'
    const links = parseLinks(text)
    expect(links.map((l) => [l.target, l.label, l.id, l.embed])).toEqual([
      ['Elena Vasquez', undefined, undefined, false],
      ['Elena Vasquez', 'Elena', undefined, false],
      ['id:chr_8f3k2m9q1x', undefined, 'chr_8f3k2m9q1x', false],
      ['Gate', undefined, undefined, true],
    ])
  })

  it('says exactly where the target and the label sit', () => {
    const text = 'a [[ Elena | Lena ]] b'
    const [l] = parseLinks(text)
    expect(text.slice(...l!.targetAt)).toBe('Elena')
    expect(text.slice(...l!.labelAt!)).toBe(' Lena ')
    expect(text.slice(l!.start, l!.end)).toBe('[[ Elena | Lena ]]')
  })

  it('reads an escaped pipe from a table cell as the split', () => {
    const [l] = parseLinks('| [[Elena Vasquez\\|Elena]] |')
    expect([l!.target, l!.label]).toEqual(['Elena Vasquez', 'Elena'])
  })

  it('reads touching links, a link in bold, and a name with an underscore', () => {
    expect(
      parseLinks('[[A]][[B]] **[[Bold Name]]** [[snake_case_name]]').map((l) => l.target),
    ).toEqual(['A', 'B', 'Bold Name', 'snake_case_name'])
  })

  it('does not read a link in code, behind a backslash, or an empty one', () => {
    expect(parseLinks('`[[A]]` and \\[[B]] and [[ ]] and [[C]]').map((l) => l.target)).toEqual([
      'C',
    ])
    expect(parseLinks('```\n[[A]]\n```\n[[B]]').map((l) => l.target)).toEqual(['B'])
  })

  it('needs no link to be fast on a text without one', () => {
    expect(parseLinks('Nothing here, only [single] brackets.')).toEqual([])
  })
})

describe('linkText', () => {
  it('writes a name, or an ID with the name as its label', () => {
    expect(linkText('Elena')).toBe('[[Elena]]')
    expect(linkText('Corin', { id: 'chr_1' })).toBe('[[id:chr_1|Corin]]')
    expect(linkText('Gate', { embed: true })).toBe('![[Gate]]')
  })
})
