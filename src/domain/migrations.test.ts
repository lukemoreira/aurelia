// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { sceneSchema } from './schema/scene'
import { migrate, NewerSchemaError, parseDocument } from './migrations'

describe('migrate', () => {
  it('returns a current document unchanged', () => {
    const doc = { schemaVersion: 1, title: 'x' }
    expect(migrate(doc, 1)).toEqual(doc)
  })

  it('runs each step in order and keeps unknown keys', () => {
    const registry = {
      1: (d: Record<string, unknown>) => ({ ...d, a: true }),
      2: (d: Record<string, unknown>) => ({ ...d, b: true }),
    }
    expect(migrate({ schemaVersion: 1, extra: 'kept' }, 3, registry)).toEqual({
      schemaVersion: 3,
      extra: 'kept',
      a: true,
      b: true,
    })
  })

  it('does not change the input', () => {
    const doc = { schemaVersion: 1 }
    migrate(doc, 2, { 1: (d) => ({ ...d, a: 1 }) })
    expect(doc).toEqual({ schemaVersion: 1 })
  })

  it('refuses a newer file with a typed error', () => {
    expect(() => migrate({ schemaVersion: 9 }, 1)).toThrow(NewerSchemaError)
    try {
      migrate({ schemaVersion: 9 }, 1)
    } catch (e) {
      expect(e).toMatchObject({ found: 9, supported: 1 })
    }
  })

  it('fails on a missing step or a bad version', () => {
    expect(() => migrate({ schemaVersion: 1 }, 2, {})).toThrow('No migration from schema version 1')
    expect(() => migrate({}, 1)).toThrow('schemaVersion')
    expect(() => migrate({ schemaVersion: '1' }, 1)).toThrow('schemaVersion')
  })

  it('says a file that is not an object is not an object', () => {
    for (const bad of [null, 7, 'text', [], undefined])
      expect(() => migrate(bad, 1)).toThrow('File is not an object')
  })
})

describe('parseDocument', () => {
  const scene = {
    title: 'S',
    schemaVersion: 1,
    id: 'scn_8f3k2m9q1x',
    chapter: 'chp_a1b2c3d4e5',
    order: 'a0',
  }

  it('reads a current file and keeps what it does not know', () => {
    expect(parseDocument(sceneSchema, { ...scene, mood: 'tense' })).toMatchObject({ mood: 'tense' })
  })

  it('refuses a newer file with the typed error, even though the shape would pass', () => {
    expect(() => parseDocument(sceneSchema, { ...scene, schemaVersion: 2 })).toThrow(
      NewerSchemaError,
    )
  })

  it('refuses what is not an object, and a wrong shape', () => {
    expect(() => parseDocument(sceneSchema, null)).toThrow('File is not an object')
    expect(() => parseDocument(sceneSchema, { ...scene, id: 'chr_8f3k2m9q1x' })).toThrow()
  })
})
