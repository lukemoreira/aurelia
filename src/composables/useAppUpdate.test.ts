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
  useAppUpdate().dismiss()
})
afterEach(() => vi.useRealTimers())

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
})
