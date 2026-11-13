// SPDX-License-Identifier: AGPL-3.0-or-later
import { StorageError } from './errors'
import { hashBytes } from './hash'

export interface FileContent {
  text: string
  /** SHA-256 of the bytes as they are on disk. */
  hash: string
}

export type AdapterKind = 'memory' | 'folder' | 'browser'
export type Access = 'granted' | 'prompt' | 'denied'

/**
 * Where a workspace's files live. Paths are workspace-relative, with `/` separators.
 * Every implementation must pass the contract in `contract.ts`.
 */
export interface StorageAdapter {
  readonly kind: AdapterKind
  /** Where it lives, in words: `the folder “Writing”` or `this browser`. */
  readonly label: string
  /** Every file below the root (or, shallow, the top-level names; folders end with `/`). */
  list(opts?: { shallow?: boolean }): Promise<string[]>
  /** The file as it is now, or null when there is none. Throws `unreadable` for text that is not UTF-8. */
  read(path: string): Promise<FileContent | null>
  readBytes(path: string): Promise<Uint8Array<ArrayBuffer> | null>
  /** Replace the whole file or create it. A write that fails leaves the old file as it was. */
  write(path: string, text: string): Promise<void>
  /** Remove a file. Removing what is not there is not an error. */
  remove(path: string): Promise<void>
  /** Whether the browser still lets us use the files. Never prompts. */
  access(): Promise<Access>
  /** Ask again. Only works from a click. */
  requestAccess(): Promise<boolean>
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Decode with the hash of the same bytes. A file that is not UTF-8 is never shown as text, so never rewritten. */
export async function decodeFile(
  bytes: Uint8Array<ArrayBuffer>,
  path: string,
): Promise<FileContent> {
  const hash = await hashBytes(bytes)
  try {
    return { text: utf8.decode(bytes), hash }
  } catch {
    throw new StorageError('unreadable', `“${path}” is not text Aurelia can read.`)
  }
}

/** Move a file by copying it first and removing the original only once the copy reads back the same. */
export async function moveFile(adapter: StorageAdapter, from: string, to: string): Promise<void> {
  const source = await adapter.readBytes(from)
  if (!source) return
  let text: string
  try {
    text = utf8.decode(source) // keeps a byte order mark, so the copy has the same bytes
  } catch {
    throw new StorageError(
      'unreadable',
      `“${from}” is not text Aurelia can read, so it was left where it is.`,
    )
  }
  await adapter.write(to, text)
  const copy = await adapter.readBytes(to)
  if (!copy || (await hashBytes(copy)) !== (await hashBytes(source)))
    throw new StorageError('other', `Could not copy “${from}”, so it was left where it is.`)
  await adapter.remove(from)
}
