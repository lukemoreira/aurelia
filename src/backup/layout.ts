// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a backup lives on the server (ADR-0009): a folder the author can open without Aurelia.
//
//   Aurelia/<Workspace name> (wsp_…)/current/…     the workspace, same layout as a folder
//                                    versions/…zip  whole-workspace snapshots
//                                    backup.json    manifest

export const BACKUP_ROOT = 'Aurelia'
export const MANIFEST_FILE = 'backup.json'

/** A name any server and file system accepts: no slashes, colons, quotes, control characters. */
export function safeName(name: string, fallback = 'Workspace'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/[. ]+$/, '')
  return cleaned || fallback
}

/**
 * `Aurelia/My Book (wsp_x)`, or with ` – <device> <id>` when this device backs up on its own.
 * Two devices can both be "Chrome on macOS": the start of the device's ID tells them apart.
 */
export const folderFor = (
  workspaceId: string,
  name: string,
  device?: { id: string; name: string },
) =>
  `${BACKUP_ROOT}/${safeName(name)} (${workspaceId})${device ? ` – ${safeName(device.name, 'Device')} ${device.id.replace(/-/g, '').slice(0, 6)}` : ''}`

const FOLDER = /^(.*) \((wsp_\w+)\)(?: – (.+))?$/

/** The workspace a backup folder's name stands for, or null when it is not one of ours. */
export function parseFolder(
  name: string,
): { name: string; workspaceId: string; device?: string } | null {
  const m = FOLDER.exec(name)
  return m ? { name: m[1]!, workspaceId: m[2]!, ...(m[3] ? { device: m[3] } : {}) } : null
}

export const manifestPath = (folder: string) => `${folder}/${MANIFEST_FILE}`
export const currentPath = (folder: string, path: string) => `${folder}/current/${path}`
export const versionsDir = (folder: string) => `${folder}/versions`

const pad = (n: number) => String(n).padStart(2, '0')

/** UTC time as a file name part: `2026-11-12T18-30-05`. */
export const stampOf = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`

/** Why a version was saved besides the hourly rhythm. Part of the file name, so it needs no database. */
export type VersionReason = 'before-keep-mine' | 'before-use-file' | 'before-use-backup' | 'manual'

export const versionName = (at: Date, reason?: string | null) =>
  `${stampOf(at)}${reason && reason !== 'hourly' ? `_${reason}` : ''}.zip`

const VERSION = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:_([a-z-]+))?\.zip$/

export function parseVersion(file: string): { at: Date; reason: string | null } | null {
  const m = VERSION.exec(file)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  return { at: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), reason: m[7] ?? null }
}

const REASONS: Record<string, string> = {
  'before-keep-mine': 'Before keeping your version of a scene',
  'before-use-file': 'Before using the file’s version of a scene',
  'before-use-backup': 'Before using the backup on your server',
  manual: 'Saved by you',
}
export const reasonWords = (reason: string | null) =>
  reason ? (REASONS[reason] ?? 'Before a big change') : 'Saved every hour while you write'
