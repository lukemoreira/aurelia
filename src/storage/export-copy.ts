// SPDX-License-Identifier: AGPL-3.0-or-later
import type { StorageAdapter } from './adapter'
import { encode } from './hash'
import { zipFiles } from './zip'

/** Every file of a workspace as a zip; `pending` holds text not yet saved, which wins over the file. */
export async function zipWorkspace(
  adapter: StorageAdapter,
  name: string,
  pending: Map<string, string> = new Map(),
): Promise<Blob> {
  const paths = new Set([...(await adapter.list()), ...pending.keys()])
  const root = name.replace(/[\\/:*?"<>|]+/g, '-')
  const files = []
  for (const path of paths) {
    const text = pending.get(path)
    const data = text !== undefined ? encode(text) : await adapter.readBytes(path)
    if (data) files.push({ path: `${root}/${path}`, data })
  }
  return zipFiles(files)
}
