// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFileBytes } from './safe-write'

/** A worker that never loads: it reports an error instead of answering. */
class BrokenWorker extends EventTarget {
  static made: BrokenWorker[] = []
  terminated = false
  constructor() {
    super()
    BrokenWorker.made.push(this)
  }
  postMessage() {
    queueMicrotask(() => this.dispatchEvent(new Event('error')))
  }
  terminate() {
    this.terminated = true
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  BrokenWorker.made = []
})

describe('writing without createWritable', () => {
  it('fails the write when the worker errors, instead of waiting for ever, and starts a fresh worker next time', async () => {
    vi.stubGlobal('Worker', BrokenWorker)
    const handle = {} as FileSystemFileHandle // no createWritable: the worker path
    const bytes = new Uint8Array([1]) as Uint8Array<ArrayBuffer>
    await expect(writeFileBytes(handle, bytes)).rejects.toThrow('stopped')
    expect(BrokenWorker.made[0]?.terminated).toBe(true)
    await expect(writeFileBytes(handle, bytes)).rejects.toThrow('stopped')
    expect(BrokenWorker.made).toHaveLength(2)
  })
})
