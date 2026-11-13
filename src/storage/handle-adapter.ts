// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  decodeFile,
  type Access,
  type AdapterKind,
  type FileContent,
  type StorageAdapter,
} from './adapter'
import { toStorageError } from './errors'
import { encode } from './hash'
import { writeFileBytes } from './safe-write'

const NOT_THERE = new Set(['NotFoundError', 'TypeMismatchError'])
const isNotThere = (e: unknown) => e instanceof Error && NOT_THERE.has(e.name)
const MODE = { mode: 'readwrite' } as const

/**
 * A workspace in a `FileSystemDirectoryHandle`. A real folder (File System Access) and the
 * browser's own storage (OPFS) share the API, so they share this class; only the kind and
 * the permission differ.
 */
export class HandleAdapter implements StorageAdapter {
  constructor(
    readonly root: FileSystemDirectoryHandle,
    readonly kind: Exclude<AdapterKind, 'memory'>,
    readonly label: string,
  ) {}

  /** The folder that holds `path`, or null when part of the way is missing. */
  private async parent(path: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let dir = this.root
    for (const part of path.split('/').slice(0, -1)) {
      try {
        dir = await dir.getDirectoryHandle(part, { create })
      } catch (e) {
        if (!create && isNotThere(e)) return null
        throw toStorageError(e, path)
      }
    }
    return dir
  }

  async list(opts?: { shallow?: boolean }): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') {
          if (opts?.shallow) out.push(`${prefix}${name}/`)
          else await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`)
        } else out.push(`${prefix}${name}`)
      }
    }
    try {
      await walk(this.root, '')
    } catch (e) {
      throw toStorageError(e, '')
    }
    return out
  }

  async readBytes(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
      const dir = await this.parent(path, false)
      if (!dir) return null
      const file = await (await dir.getFileHandle(path.split('/').pop()!)).getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch (e) {
      if (isNotThere(e)) return null
      throw toStorageError(e, path)
    }
  }

  async read(path: string): Promise<FileContent | null> {
    const bytes = await this.readBytes(path)
    return bytes ? decodeFile(bytes, path) : null
  }

  async write(path: string, text: string): Promise<void> {
    try {
      const dir = (await this.parent(path, true))!
      const file = await dir.getFileHandle(path.split('/').pop()!, { create: true })
      await writeFileBytes(file, encode(text))
    } catch (e) {
      throw toStorageError(e, path)
    }
  }

  async remove(path: string): Promise<void> {
    try {
      const dir = await this.parent(path, false)
      await dir?.removeEntry(path.split('/').pop()!)
    } catch (e) {
      if (!isNotThere(e)) throw toStorageError(e, path)
    }
  }

  async access(): Promise<Access> {
    // Browser storage needs no permission; a folder the browser forgot to trust answers "prompt".
    return (await this.root.queryPermission?.(MODE)) ?? 'granted'
  }

  async requestAccess(): Promise<boolean> {
    return ((await this.root.requestPermission?.(MODE)) ?? 'granted') === 'granted'
  }
}
