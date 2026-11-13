// SPDX-License-Identifier: AGPL-3.0-or-later

// One queue per path. Every check-then-act (If-Match, If-None-Match, Overwrite) runs inside
// withLock, so two writers cannot both pass the same check.
const tails = new Map<string, Promise<void>>()

async function acquire(key: string): Promise<() => void> {
  const prev = tails.get(key) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((resolve) => (release = resolve))
  const tail = prev.then(() => mine)
  tails.set(key, tail)
  await prev
  return () => {
    release()
    if (tails.get(key) === tail) tails.delete(key)
  }
}

/** Runs fn while holding the locks of all keys. Keys are taken in sorted order: no deadlock. */
export async function withLock<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const held: Array<() => void> = []
  try {
    for (const key of [...new Set(keys)].sort()) held.push(await acquire(key))
    return await fn()
  } finally {
    for (const release of held.reverse()) release()
  }
}
