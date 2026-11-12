// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startUpdates, UPDATE_CHECK_MS, useAppUpdate } from './useAppUpdate'

type Options = Parameters<Parameters<typeof startUpdates>[0]>[0] & {}

function register() {
  let options!: Options
  const apply = vi.fn(() => Promise.resolve())
  const fake = ((o: Options) => {
    options = o
    return apply
  }) as unknown as Parameters<typeof startUpdates>[0]
  startUpdates(fake)
  return { options: () => options, apply }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  useAppUpdate().dismiss()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('app updates', () => {
  it('says nothing, and reloads nothing, until a new version is waiting', () => {
    const { apply } = register()
    expect(useAppUpdate().updateReady.value).toBe(false)
    vi.advanceTimersByTime(UPDATE_CHECK_MS * 3)
    expect(apply).not.toHaveBeenCalled()
  })

  it('announces a waiting version, and reloads only when asked', () => {
    const { options, apply } = register()
    options().onNeedRefresh?.()
    const update = useAppUpdate()
    expect(update.updateReady.value).toBe(true)
    expect(apply).not.toHaveBeenCalled()
    update.reload()
    expect(apply).toHaveBeenCalledWith(true)
  })

  it('can be put off: "Later" hides it without reloading', () => {
    const { options, apply } = register()
    options().onNeedRefresh?.()
    useAppUpdate().dismiss()
    expect(useAppUpdate().updateReady.value).toBe(false)
    expect(apply).not.toHaveBeenCalled()
  })

  it('asks for a new version every hour, and survives being offline', async () => {
    const { options } = register()
    const update = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError('offline'))
    options().onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration)
    vi.advanceTimersByTime(UPDATE_CHECK_MS - 1)
    expect(update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
    expect(update).toHaveBeenCalledTimes(2)
  })

  describe('sign-in probe', () => {
    async function failedCheck(probe: () => Promise<unknown>) {
      vi.stubGlobal('fetch', vi.fn(probe))
      const { options } = register()
      const update = vi.fn().mockRejectedValue(new TypeError('redirected'))
      options().onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration)
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MS)
    }
    it('asks for a sign-in when the probe is redirected', async () => {
      await failedCheck(() => Promise.resolve({ type: 'opaqueredirect' }))
      expect(useAppUpdate().signInNeeded.value).toBe(true)
      expect(fetch).toHaveBeenCalledWith('/sw.js', { cache: 'no-store', redirect: 'manual' })
    })

    it('asks for a sign-in when the app opens after the session ended', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve({ type: 'opaqueredirect' })),
      )
      const { options } = register()
      options().onRegisterError?.(new TypeError('redirected'))
      await vi.advanceTimersByTimeAsync(0)
      expect(useAppUpdate().signInNeeded.value).toBe(true)
    })

    it.each([401, 403])('asks for a sign-in when the probe is refused (%i)', async (status) => {
      await failedCheck(() => Promise.resolve({ type: 'basic', status }))
      expect(useAppUpdate().signInNeeded.value).toBe(true)
    })

    it('does not when the probe gets a normal answer', async () => {
      await failedCheck(() => Promise.resolve({ type: 'basic', status: 200 }))
      expect(useAppUpdate().signInNeeded.value).toBe(false)
    })

    it('does not when the probe fails too (offline), and nothing is left unhandled', async () => {
      await failedCheck(() => Promise.reject(new TypeError('offline')))
      expect(useAppUpdate().signInNeeded.value).toBe(false)
    })
  })
})
