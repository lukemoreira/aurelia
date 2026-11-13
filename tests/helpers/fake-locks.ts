// SPDX-License-Identifier: AGPL-3.0-or-later
// `navigator.locks` for tests: one holder per name, a queue, `ifAvailable` and `signal`.

type Callback = (lock: { name: string } | null) => unknown
interface Options {
  ifAvailable?: boolean
  signal?: AbortSignal
}

export class FakeLocks {
  private held = new Set<string>()
  private queue = new Map<string, Array<() => void>>()

  /** Whether some holder has this lock right now. */
  isHeld = (name: string) => this.held.has(name)

  request(name: string, a: Options | Callback, b?: Callback): Promise<unknown> {
    const options = typeof a === 'function' ? {} : a
    const callback = (typeof a === 'function' ? a : b)!
    const run = async () => {
      this.held.add(name)
      try {
        return await callback({ name })
      } finally {
        this.held.delete(name)
        this.queue.get(name)?.shift()?.()
      }
    }
    if (!this.held.has(name)) return run()
    if (options.ifAvailable) return Promise.resolve(callback(null))
    return new Promise((resolve, reject) => {
      const start = () => {
        options.signal?.removeEventListener('abort', onAbort)
        run().then(resolve, reject)
      }
      const onAbort = () => {
        this.queue.set(
          name,
          (this.queue.get(name) ?? []).filter((f) => f !== start),
        )
        reject(new DOMException('aborted', 'AbortError'))
      }
      options.signal?.addEventListener('abort', onAbort)
      this.queue.set(name, [...(this.queue.get(name) ?? []), start])
    })
  }

  asManager = () => this as unknown as LockManager
}
