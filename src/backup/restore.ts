// SPDX-License-Identifier: AGPL-3.0-or-later
import type { StorageAdapter } from '@/storage/adapter'
import { StorageError } from '@/storage/errors'
import { encode, hashBytes } from '@/storage/hash'
import { WORKSPACE_FILE } from '@/storage/paths'
import type { RemoteStore } from '@/storage/remote/remote-store'
import { readZip } from '@/storage/zip'
import { BACKUP_ROOT, currentPath, parseFolder, parseVersion, versionsDir } from './layout'
import { readManifest } from './manifest'

/** A workspace that has a backup on the server. */
export interface BackupListing {
  folder: string
  name: string
  workspaceId: string
  /** Set when a device backs up to a folder of its own ("Keep both"). */
  device: string | null
  deviceName: string
  lastBackup: string
  files: number
  size: number
}

export interface VersionInfo {
  name: string
  at: Date
  size: number
  reason: string | null
}

/** What is wrong with a file of a backup, named by path. A restore with any of these never opens. */
export interface Problem {
  path: string
  kind: 'missing' | 'changed' | 'unreadable'
}

export interface Fetched {
  files: Map<string, Uint8Array<ArrayBuffer>>
  problems: Problem[]
}

/** Every workspace on the server that has a readable `backup.json`, newest backup first. */
export async function listBackups(store: RemoteStore): Promise<BackupListing[]> {
  const folders = (await store.list(BACKUP_ROOT)).filter((e) => e.folder)
  const found = await Promise.all(
    folders.map(async (e): Promise<BackupListing[]> => {
      const parsed = parseFolder(e.name)
      const read = parsed && (await readManifest(store, e.path).catch(() => null))
      if (!parsed || !read) return []
      const m = read.manifest
      return [
        {
          folder: e.path,
          name: m.name ?? parsed.name,
          workspaceId: m.workspaceId,
          device: parsed.device ?? null,
          deviceName: m.deviceName,
          lastBackup: m.lastBackup,
          files: Object.keys(m.files).length,
          size: Object.values(m.files).reduce((n, f) => n + f.size, 0),
        },
      ]
    }),
  )
  return found.flat().sort((a, b) => b.lastBackup.localeCompare(a.lastBackup))
}

/** The versions of a backup folder, newest first. */
export async function listVersions(store: RemoteStore, folder: string): Promise<VersionInfo[]> {
  return (await store.list(versionsDir(folder)))
    .flatMap((e) => {
      const v = parseVersion(e.name)
      return v && !e.folder ? [{ name: e.name, at: v.at, size: e.size, reason: v.reason }] : []
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime())
}

const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const isText = (bytes: Uint8Array) => {
  try {
    text.decode(bytes)
    return true
  } catch {
    return false
  }
}

const CHUNK = 6

/**
 * Read a backup back: the latest (`current/`, every file checked against the manifest's
 * hashes) or one version (a zip, every file against its stored CRC). Nothing is written
 * anywhere; the caller shows `problems` and goes no further while there are any.
 */
export async function fetchBackup(
  store: RemoteStore,
  folder: string,
  choice: 'current' | string,
): Promise<Fetched> {
  const files = new Map<string, Uint8Array<ArrayBuffer>>()
  const problems: Problem[] = []
  if (choice === 'current') {
    const found = await readManifest(store, folder)
    if (!found) throw new StorageError('other', 'There is no backup in that folder.')
    const listed = Object.entries(found.manifest.files)
    for (let i = 0; i < listed.length; i += CHUNK)
      await Promise.all(
        listed.slice(i, i + CHUNK).map(async ([path, expected]) => {
          const file = await store.read(currentPath(folder, path))
          if (!file) return void problems.push({ path, kind: 'missing' })
          files.set(path, file.bytes)
          if ((await hashBytes(file.bytes)) !== expected.hash)
            problems.push({ path, kind: 'changed' })
        }),
      )
  } else {
    const zip = await store.read(`${versionsDir(folder)}/${choice}`)
    if (!zip) throw new StorageError('other', 'That version is no longer on your server.')
    for (const entry of readZip(zip.bytes)) {
      const path = entry.path.slice(entry.path.indexOf('/') + 1) // the folder the zip was made in
      files.set(path, entry.data)
      if (!entry.crcOk) problems.push({ path, kind: 'changed' })
    }
  }
  if (!files.has(WORKSPACE_FILE) && !problems.some((p) => p.path === WORKSPACE_FILE))
    problems.push({ path: WORKSPACE_FILE, kind: 'missing' })
  for (const [path, bytes] of files) if (!isText(bytes)) problems.push({ path, kind: 'unreadable' })
  return { files, problems: problems.sort((a, b) => a.path.localeCompare(b.path)) }
}

/** The same files under a new workspace ID: only `aurelia.json` changes. */
export function withNewId(
  files: Map<string, Uint8Array<ArrayBuffer>>,
  id: string,
): Map<string, Uint8Array<ArrayBuffer>> {
  const main = files.get(WORKSPACE_FILE)
  if (!main) throw new StorageError('other', 'That backup has no workspace file.')
  const json = JSON.parse(text.decode(main)) as Record<string, unknown>
  return new Map(files).set(WORKSPACE_FILE, encode(`${JSON.stringify({ ...json, id }, null, 2)}\n`))
}

/** Write a restored workspace. `aurelia.json` goes last, so the folder only counts as a workspace once it is whole. */
export async function writeRestored(
  adapter: StorageAdapter,
  files: Map<string, Uint8Array<ArrayBuffer>>,
): Promise<void> {
  const order = [...files.keys()].sort(
    (a, b) => Number(a === WORKSPACE_FILE) - Number(b === WORKSPACE_FILE),
  )
  for (const path of order) await adapter.write(path, text.decode(files.get(path)!))
}

/** One version, as a zip for the browser to save. */
export async function downloadVersion(
  store: RemoteStore,
  folder: string,
  name: string,
): Promise<Blob> {
  const zip = await store.read(`${versionsDir(folder)}/${name}`)
  if (!zip) throw new StorageError('other', 'That version is no longer on your server.')
  return new Blob([zip.bytes], { type: 'application/zip' })
}

/** The space a backup takes on the server: its versions and its current files. */
export async function spaceUsed(store: RemoteStore, folder: string): Promise<number> {
  const versions = await listVersions(store, folder)
  const manifest = await readManifest(store, folder).catch(() => null)
  return (
    versions.reduce((n, v) => n + v.size, 0) +
    Object.values(manifest?.manifest.files ?? {}).reduce((n, f) => n + f.size, 0)
  )
}
