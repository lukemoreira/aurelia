// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest'
import { OpenError, StorageError, toStorageError, wordsFor, type OpenErrorKind } from './errors'

describe('wordsFor', () => {
  it('says one plain sentence per kind of failure, and keeps the raw text for the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const kinds: OpenErrorKind[] = [
      'not-workspace',
      'not-empty',
      'unreadable',
      'newer-version',
      'gone',
    ]
    for (const kind of kinds) {
      const words = wordsFor(new OpenError(kind, 'RAW: ZodError at universe.kind'))
      expect(words).not.toContain('RAW')
      expect(words).not.toMatch(/aurelia\.json|zod|undefined/i)
      expect(words.endsWith('.')).toBe(true)
    }
    expect(warn).toHaveBeenCalled()
  })

  it('never passes on the browser’s own words', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const weird = new DOMException(
      'Failed to execute createWritable on FileSystemFileHandle',
      'AbortError',
    )
    const stored = toStorageError(weird, 'scenes/a.md')
    expect(stored.code).toBe('other')
    expect(stored.message).toBe('Aurelia could not use “scenes/a.md”.')
    expect(wordsFor(weird)).toBe('That did not work. Nothing was lost.')
    expect(wordsFor(new TypeError('x is not a function'), 'Aurelia could not make the copy.')).toBe(
      'Aurelia could not make the copy.',
    )
    expect(warn).toHaveBeenCalled()
  })

  it('names permission and room, and passes on a storage error’s own plain message', () => {
    expect(wordsFor(new DOMException('x', 'NotAllowedError'))).toContain('no longer lets Aurelia')
    expect(wordsFor(new DOMException('x', 'QuotaExceededError'))).toContain('no room left')
    expect(
      wordsFor(
        new StorageError('read-only', 'This workspace is read-only, so nothing was changed.'),
      ),
    ).toBe('This workspace is read-only, so nothing was changed.')
  })
})
