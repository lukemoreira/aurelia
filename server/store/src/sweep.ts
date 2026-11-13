// SPDX-License-Identifier: AGPL-3.0-or-later
import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { RESERVED_PREFIX } from './paths.ts'

const TMP = new RegExp(`^${RESERVED_PREFIX.replace('.', '\\.')}-.*\\.tmp$`)

/** Deletes the store's own temp files left by a crash (older than `maxAgeMs`). Never follows symlinks, never touches anything else. */
export async function sweepTemp(
  root: string,
  maxAgeMs = 3_600_000,
  now = Date.now(),
): Promise<number> {
  let removed = 0
  for (const e of await readdir(root, { withFileTypes: true })) {
    const p = join(root, e.name)
    if (e.isDirectory()) removed += await sweepTemp(p, maxAgeMs, now).catch(() => 0)
    else if (e.isFile() && TMP.test(e.name)) {
      const st = await lstat(p).catch(() => null)
      if (st?.isFile() && now - st.mtimeMs > maxAgeMs) {
        await rm(p, { force: true })
        removed++
      }
    }
  }
  return removed
}
