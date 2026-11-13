// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { renameInWorkspaceJson, workspaceNameIn } from './rename-workspace'

describe('renameInWorkspaceJson', () => {
  it('changes only the name’s value, byte for byte (key order, indent, unknown keys, final newline)', () => {
    const text = `{\n  "schemaVersion": 1,\n  "id": "wsp_aaaaaaaaaa",\n  "name": "Old",\n  "universes": ["unv_aaaaaaaaaa"],\n  "x-future": { "name": "inner", "keep": [1, 2] }\n}\n`
    expect(renameInWorkspaceJson(text, 'New name')).toBe(text.replace('"Old"', '"New name"'))
  })

  it('keeps other indentation styles, CRLF line endings and a missing final newline', () => {
    const four = '{\r\n    "name"  :   "Old" ,\r\n    "id": "wsp_aaaaaaaaaa"\r\n}'
    expect(renameInWorkspaceJson(four, 'N')).toBe(four.replace('"Old"', '"N"'))
    const flat = '{"id":"wsp_a","name":"Old","universes":[]}'
    expect(renameInWorkspaceJson(flat, 'N')).toBe('{"id":"wsp_a","name":"N","universes":[]}')
  })

  it('leaves a nested or earlier "name" alone and finds the top-level one', () => {
    const text = '{"meta":{"name":"inner"},"note":"\\"name\\": \\"x\\"","name":"Old"}'
    expect(renameInWorkspaceJson(text, 'N')).toBe(text.replace('"Old"', '"N"'))
  })

  it('with a repeated top-level "name" replaces the last, the one JSON.parse reads', () => {
    const out = renameInWorkspaceJson('{"name":"First","id":"a","name":"Last"}', 'N')
    expect(out).toBe('{"name":"First","id":"a","name":"N"}')
    expect(workspaceNameIn(out)).toBe('N')
  })

  it('escapes what JSON needs escaped, and reads back as the name typed', () => {
    const out = renameInWorkspaceJson('{"name":"Old"}', 'The “Quoted” \\ name')
    expect(workspaceNameIn(out)).toBe('The “Quoted” \\ name')
  })

  it('refuses a file with no name instead of guessing', () => {
    expect(() => renameInWorkspaceJson('{"id":"wsp_a"}', 'N')).toThrow()
  })
})

describe('workspaceNameIn', () => {
  it('reads the name, and says nothing for text that holds none', () => {
    expect(workspaceNameIn('{"name":"A"}')).toBe('A')
    expect(workspaceNameIn('{"name":4}')).toBeUndefined()
    expect(workspaceNameIn('not json')).toBeUndefined()
  })
})
