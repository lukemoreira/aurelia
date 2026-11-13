// SPDX-License-Identifier: AGPL-3.0-or-later

/** What went wrong with a file, in the few kinds the screens tell apart. */
export type StorageErrorCode = 'permission' | 'unreadable' | 'quota' | 'read-only' | 'other'

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StorageError'
  }
}

export const isPermissionError = (e: unknown) =>
  e instanceof StorageError && e.code === 'permission'

/** What went wrong talking to a backup server, in the few kinds the screens tell apart. */
export type RemoteErrorCode =
  'precondition' | 'conflict' | 'unauthorized' | 'too-large' | 'offline' | 'server'

export class RemoteError extends Error {
  constructor(
    readonly code: RemoteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RemoteError'
  }
}

const REMOTE_WORDS: Record<RemoteErrorCode, string> = {
  precondition:
    'Someone else changed the backup at the same moment, so Aurelia stopped and left it alone.',
  conflict: 'Your server would not make the folder for the backup.',
  unauthorized: 'Your server needs you to sign in again.',
  'too-large': 'A file is too big for your server to take.',
  offline: 'Aurelia could not reach your server. It will try again.',
  server: 'Your server could not keep the backup just now. It will try again.',
}

const at = (path: string) => (path ? `“${path}”` : 'a file')

/** Turn what the browser throws into a `StorageError` (a missing file is handled by callers). */
export function toStorageError(e: unknown, path: string): StorageError {
  if (e instanceof StorageError) return e
  const name = e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return new StorageError('permission', `The browser no longer lets Aurelia use ${at(path)}.`)
  if (name === 'QuotaExceededError')
    return new StorageError('quota', `There is no room left to save ${at(path)}.`)
  // The browser's own words are for the console, never for the author.
  console.warn('[storage]', path, e)
  return new StorageError('other', `Aurelia could not use ${at(path)}.`)
}

/** Why a folder cannot be opened as a workspace. */
export type OpenErrorKind = 'not-workspace' | 'not-empty' | 'unreadable' | 'newer-version' | 'gone'

export class OpenError extends Error {
  constructor(
    readonly kind: OpenErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'OpenError'
  }
}

const OPEN_WORDS: Record<OpenErrorKind, string> = {
  'not-workspace': 'This folder has no Aurelia workspace in it.',
  'not-empty': 'That folder has other files in it, so Aurelia left it alone.',
  unreadable: 'Aurelia could not read this workspace’s main file. Nothing was changed.',
  'newer-version': 'A newer version of Aurelia saved this workspace. Update Aurelia to open it.',
  gone: 'That workspace is no longer where Aurelia left it.',
}

/**
 * What to tell the author about an error: one plain sentence, never the browser’s or a
 * library’s own text, which goes to the console. `fallback` says what failed.
 */
export function wordsFor(e: unknown, fallback = 'That did not work. Nothing was lost.'): string {
  if (e instanceof StorageError) return e.message
  if (e instanceof RemoteError) {
    console.warn('[remote]', e.code, e.message)
    return REMOTE_WORDS[e.code]
  }
  if (e instanceof OpenError) {
    console.warn('[open]', e.message)
    return OPEN_WORDS[e.kind]
  }
  const name = e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'The browser no longer lets Aurelia use these files.'
  if (name === 'QuotaExceededError') return 'There is no room left on this device.'
  console.warn('[error]', e)
  return fallback
}
