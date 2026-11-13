// SPDX-License-Identifier: AGPL-3.0-or-later
import { decodeFile, type Access, type FileContent, type StorageAdapter } from '@/storage/adapter'
import { StorageError } from '@/storage/errors'
import { encode } from '@/storage/hash'

/**
 * Files in a Map. Used by unit tests and as the reference the contract is written against.
 * The two switches let a test play the failures a real folder has.
 */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory'
  readonly label = 'memory'
  private files = new Map<string, Uint8Array<ArrayBuffer>>()
  /** Pretend the browser took the folder permission back. */
  accessLost = false
  /** Called before every write; throw from it to fail that write. */
  beforeWrite?: (path: string, text: string) => void | Promise<void>

  constructor(files: Record<string, string> = {}) {
    for (const [path, text] of Object.entries(files)) this.files.set(path, encode(text))
  }

  private check() {
    if (this.accessLost)
      throw new StorageError('permission', 'The browser no longer lets Aurelia use this folder.')
  }

  /** Put raw bytes in place, as another app might (a test can write what is not UTF-8). */
  putBytes(path: string, bytes: Uint8Array<ArrayBuffer>) {
    this.files.set(path, bytes)
  }

  async list(opts?: { shallow?: boolean }): Promise<string[]> {
    this.check()
    const paths = [...this.files.keys()]
    if (!opts?.shallow) return paths
    return Array.from(new Set(paths.map((p) => (p.includes('/') ? `${p.split('/')[0]}/` : p))))
  }

  async readBytes(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    this.check()
    const bytes = this.files.get(path)
    return bytes ? bytes.slice() : null
  }

  async read(path: string): Promise<FileContent | null> {
    const bytes = await this.readBytes(path)
    return bytes ? decodeFile(bytes, path) : null
  }

  async write(path: string, text: string): Promise<void> {
    this.check()
    await this.beforeWrite?.(path, text)
    this.files.set(path, encode(text))
  }

  async remove(path: string): Promise<void> {
    this.check()
    this.files.delete(path)
  }

  async access(): Promise<Access> {
    return this.accessLost ? 'prompt' : 'granted'
  }

  async requestAccess(): Promise<boolean> {
    return !this.accessLost
  }
}
