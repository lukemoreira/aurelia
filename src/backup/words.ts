// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackupView } from './engine'
import { parseFolder } from './layout'

/** "just now", "2 min ago", "3 h ago", "yesterday" or "Nov 12": how long ago, in words. */
export function agoWords(then: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  if (Math.round((day(now) - day(then)) / 86_400_000) === 1) return 'yesterday'
  return new Date(then).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

/** What the status bar says about the backup, or null when there is no backup to speak of. */
export function backupWords(view: BackupView | null, now: number): string | null {
  if (!view?.enabled) return null
  switch (view.status) {
    case 'ask':
      return 'Backup needs your OK'
    case 'paused':
      return 'Backup paused — sign in again'
    case 'failed':
      return 'Backup failed — will retry'
    case 'working':
      return 'Backing up…'
    case 'blocked':
      return 'Backup on hold — read-only'
    default:
      return view.lastBackup === null
        ? 'Backing up…'
        : `Backed up · ${agoWords(view.lastBackup, now)}`
  }
}

/** The backup words a screen reader should hear: only what the author has to act on or know failed. */
export const backupNeedsAttention = (view: BackupView | null) =>
  !!view?.enabled && ['ask', 'paused', 'failed'].includes(view.status)

/** "Today, 18:30", "Yesterday, 18:30" or "Nov 3, 18:30": when a version was made, on the author's clock. */
export function versionWhen(at: Date, now: number): string {
  const clock = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  const days = Math.round((day(now) - day(at.getTime())) / 86_400_000)
  if (days <= 0) return `Today, ${clock}`
  if (days === 1) return `Yesterday, ${clock}`
  return `${at.toLocaleDateString('en', { month: 'short', day: 'numeric' })}, ${clock}`
}

/** "84 MB", "12 KB": a size in words. */
export function sizeWords(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/**
 * `Aurelia › My Book`: where a backup folder is, for the author. The workspace ID is never shown.
 * `name` is the workspace's current name (the folder keeps the first one); without it the folder's own.
 */
export function folderWords(folder: string, name?: string): string {
  const slash = folder.indexOf('/')
  if (slash < 0) return folder
  const rest = folder.slice(slash + 1)
  return `${folder.slice(0, slash)} › ${name ?? parseFolder(rest)?.name ?? rest}`
}

/** ADR-0009 §1: the browser's answer to "keep this storage", in plain words. One place for every screen. */
export function persistedWords(persisted: boolean | null | undefined): {
  yes: boolean
  title: string
  text: string
} {
  if (persisted === true)
    return {
      yes: true,
      title: 'Kept by the browser',
      text: 'The browser agreed not to clear Aurelia’s storage on its own. Clearing site data by hand still removes it.',
    }
  if (persisted === false)
    return {
      yes: false,
      title: 'Not protected from clean-up',
      text: 'The browser may clear this storage when the disk runs low. A backup keeps your book safe.',
    }
  return {
    yes: false,
    title: 'Not asked yet',
    text: 'Aurelia asks the browser to keep the storage when you first save.',
  }
}
