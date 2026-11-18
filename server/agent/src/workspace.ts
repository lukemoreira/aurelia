// SPDX-License-Identifier: AGPL-3.0-or-later
// The workspace as the store holds it: the synced copy `<folder>/current/` (ADR-0012), read through the
// store's own WebDAV as the signed-in person, and loaded by the app's own loader and index.
import { readManifest } from '@/backup/manifest'
import { currentPath } from '@/backup/layout'
import { WorkspaceIndex } from '@/index/workspace-index'
import { decodeFile, type StorageAdapter } from '@/storage/adapter'
import { StorageError } from '@/storage/errors'
import { loadWorkspace, type LoadedWorkspace } from '@/storage/load'
import { AURELIA_DIR, isMediaBinary } from '@/storage/paths'
import type { RemoteStore } from '@/storage/remote/remote-store'

export interface Workspace extends LoadedWorkspace {
  index: WorkspaceIndex
}

/** A folder name the app made: `Aurelia/<name> (wsp_…)`, with no way out of it. */
export function checkFolder(folder: unknown): string {
  if (
    typeof folder !== 'string' ||
    !/^Aurelia\/[^/]+ \(wsp_[a-z0-9]+\)[^/]*$/.test(folder) ||
    folder.includes('..') ||
    /[\\\p{Cc}]/u.test(folder)
  )
    throw new StorageError('other', 'That is not a workspace folder on this server.')
  return folder
}

const readOnly = () => {
  throw new StorageError('read-only', 'The assistant never writes the manuscript.')
}

/**
 * Read the text files the folder's manifest lists (the device that synced last wrote it) and load them.
 * Images and Aurelia's own folder (`.aurelia/`: trash, snapshots, proposals) are not read: the loader
 * would not use them.
 */
export async function readWorkspace(store: RemoteStore, folder: string): Promise<Workspace> {
  const found = await readManifest(store, folder)
  if (!found)
    throw new StorageError('other', 'This workspace is not on the server yet. Turn sync on first.')
  const paths = Object.keys(found.manifest.files).filter(
    (p) => !p.startsWith(AURELIA_DIR) && !isMediaBinary(p),
  )
  const bytes = new Map<string, Uint8Array<ArrayBuffer>>()
  let next = 0
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++]!
      const file = await store.read(currentPath(folder, path))
      if (file) bytes.set(path, file.bytes)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  const adapter: StorageAdapter = {
    kind: 'memory',
    label: 'the server',
    list: async () => [...bytes.keys()],
    read: async (path) => {
      const b = bytes.get(path)
      return b ? decodeFile(b, path) : null
    },
    readBytes: async (path) => bytes.get(path) ?? null,
    write: readOnly,
    writeBytes: readOnly,
    remove: readOnly,
    access: async () => 'granted',
    requestAccess: async () => true,
  }
  const loaded = await loadWorkspace(adapter)
  const index = new WorkspaceIndex()
  index.sync(loaded.data)
  return { ...loaded, index }
}
