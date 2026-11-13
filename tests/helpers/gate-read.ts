// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MemoryAdapter } from './memory-adapter'

/** Hold the first read of `path` (the files being read again) until released. */
export function gateRead(a: MemoryAdapter, path: string) {
  const read = a.read.bind(a)
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let held = false
  a.read = async (p) => {
    const found = await read(p)
    if (p === path && !held) {
      held = true
      await gate
    }
    return found
  }
  return { release: () => release(), isHeld: () => held }
}
