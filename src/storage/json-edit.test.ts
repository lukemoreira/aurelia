// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { removeTopLevel, setTopLevel, topLevelValueSpan } from './json-edit'

const BOOK = `{
  "title": "Saltmarch",
  "schemaVersion": 1,
  "id": "bok_aaaaaaaaaa",
  "mode": "linear",
  "mystery": { "keep": ["me", { "name": "not top level" }] },
  "outline": [
    { "chapter": "chp_a", "scenes": ["scn_a"] }
  ]
}
`

describe('setTopLevel', () => {
  it('replaces one value and leaves every other byte of the file alone', () => {
    const edited = setTopLevel(BOOK, 'title', 'The Lantern Gate')
    expect(edited).toBe(BOOK.replace('"Saltmarch"', '"The Lantern Gate"'))
  })

  it('replaces a nested value laid out like the file (indentation kept)', () => {
    const edited = setTopLevel(BOOK, 'outline', [{ chapter: 'chp_a', scenes: ['scn_a', 'scn_b'] }])
    expect(JSON.parse(edited).outline).toEqual([{ chapter: 'chp_a', scenes: ['scn_a', 'scn_b'] }])
    expect(edited.startsWith(BOOK.slice(0, BOOK.indexOf('"outline"')))).toBe(true)
    expect(edited).toContain('  "outline": [\n    {\n      "chapter": "chp_a",')
    expect(edited.endsWith('\n}\n')).toBe(true)
  })

  it('does not mistake a key nested deeper for a top-level one', () => {
    expect(topLevelValueSpan(BOOK, 'name')).toBeNull()
    expect(JSON.parse(setTopLevel(BOOK, 'name', 'x')).mystery).toEqual(JSON.parse(BOOK).mystery)
  })

  it('adds a missing key as the last member, and into an empty object', () => {
    const added = setTopLevel(BOOK, 'summary', 'A harbour.')
    expect(JSON.parse(added)).toEqual({ ...JSON.parse(BOOK), summary: 'A harbour.' })
    expect(added).toContain('  ],\n  "summary": "A harbour."\n}')
    expect(JSON.parse(setTopLevel('{}\n', 'a', 1))).toEqual({ a: 1 })
    expect(JSON.parse(setTopLevel('{\n}\n', 'a', [1]))).toEqual({ a: [1] })
  })

  it('keeps CRLF line endings and tab indentation', () => {
    const crlf = '{\r\n\t"title": "A",\r\n\t"list": [1]\r\n}\r\n'
    const edited = setTopLevel(crlf, 'list', [1, 2])
    expect(edited).not.toMatch(/[^\r]\n/)
    expect(JSON.parse(edited).list).toEqual([1, 2])
    expect(edited).toContain('\t"title": "A"')
  })

  it('reads a value that is a string with an escaped quote or a bare number', () => {
    const text = '{"a": "x \\" y", "b": 12, "c": true}'
    expect(setTopLevel(text, 'b', 13)).toBe('{"a": "x \\" y", "b": 13, "c": true}')
    expect(setTopLevel(text, 'a', 'z')).toBe('{"a": "z", "b": 12, "c": true}')
  })
})

describe('removeTopLevel', () => {
  const text = '{\n  "a": 1,\n  "b": [2, 3],\n  "c": "x"\n}\n'
  it('takes a first, middle or last member away with its comma and line, and nothing else', () => {
    expect(removeTopLevel(text, 'a')).toBe('{\n  "b": [2, 3],\n  "c": "x"\n}\n')
    expect(removeTopLevel(text, 'b')).toBe('{\n  "a": 1,\n  "c": "x"\n}\n')
    expect(removeTopLevel(text, 'c')).toBe('{\n  "a": 1,\n  "b": [2, 3]\n}\n')
    expect(removeTopLevel('{\n  "a": 1\n}\n', 'a')).toBe('{\n}\n')
  })
  it('is the same text when the key is not there, and ignores a nested key of that name', () => {
    expect(removeTopLevel(text, 'z')).toBe(text)
    const nested = '{"a": {"b": 1}, "c": 2}'
    expect(removeTopLevel(nested, 'b')).toBe(nested)
    expect(JSON.parse(removeTopLevel(nested, 'c'))).toEqual({ a: { b: 1 } })
  })
})
