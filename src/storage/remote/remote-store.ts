// SPDX-License-Identifier: AGPL-3.0-or-later

/** One thing in a remote folder. Paths are relative to the store's root, with `/` separators. */
export interface RemoteEntry {
  name: string
  path: string
  folder: boolean
  /** The server's opaque version tag. Compare it, never read it. */
  etag: string | null
  size: number
  modified: Date | null
}

export interface RemoteFile {
  bytes: Uint8Array<ArrayBuffer>
  etag: string | null
}

export interface WriteOptions {
  /** Write only if the file still has this tag (else `precondition`). */
  ifMatch?: string
  /** Write only if there is no such file yet (else `precondition`). */
  ifNoneMatch?: '*'
}

/**
 * Somewhere a backup can go: the author's own server today, other places later. Errors are
 * `RemoteError`s. Every implementation is told apart from the app by this interface alone.
 */
export interface RemoteStore {
  /** The children of a folder; a folder that is not there lists as empty. */
  list(path: string): Promise<RemoteEntry[]>
  /** The file, or null when there is none. */
  read(path: string): Promise<RemoteFile | null>
  /** Replace the whole file or create it (and the folders above it). Returns its new tag. */
  write(
    path: string,
    bytes: Uint8Array<ArrayBuffer>,
    options?: WriteOptions,
  ): Promise<string | null>
  /** Remove a file or folder. Removing what is not there is not an error. */
  remove(path: string, options?: { ifMatch?: string }): Promise<void>
  /** Make a folder and every folder above it. A folder that exists is not an error. */
  mkdir(path: string): Promise<void>
  /** Move a file. With `overwrite: false` an existing target is a `precondition` error. */
  move(from: string, to: string, options?: { overwrite?: boolean }): Promise<void>
}
