// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, vi } from 'vitest'

// A Vue warning is a bug (a missing prop, a bad ref, a failed hydration): fail the test that
// raised it. Collected here and checked after the test, because throwing inside console.warn
// would be swallowed by Vue's own error handling.
let warnings: string[] = []
beforeEach(() => {
  warnings = []
  // No real network in tests: anything that asks the server (the backup probe) finds none.
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('no network in tests')))
  const warn = console.warn.bind(console)
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('[Vue warn]')) warnings.push(args.map(String).join(' '))
    else warn(...args)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  expect(warnings, 'Vue warnings').toEqual([])
})
