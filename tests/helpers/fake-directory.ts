// SPDX-License-Identifier: AGPL-3.0-or-later
// A FileSystemDirectoryHandle in memory, for tests in Node, where the browser's does not exist.
// It does what the File System Access API does for what HandleAdapter uses — including the
// swap-file behaviour of createWritable (nothing changes until close) and a permission that
// can be taken away.

const notFound = () => new DOMException('not found', 'NotFoundError')

class FakeFile {
  readonly kind = 'file'
  constructor(
    readonly name: string,
    private store: { bytes: Uint8Array<ArrayBuffer> },
    private dir: FakeDirectory,
  ) {}
  async getFile() {
    this.dir.check()
    const bytes = this.store.bytes
    return { arrayBuffer: async () => bytes.slice().buffer }
  }
  async createWritable() {
    this.dir.check()
    let pending: Uint8Array<ArrayBuffer> | undefined
    return {
      write: async (bytes: Uint8Array<ArrayBuffer>) => void (pending = bytes.slice()),
      close: async () => {
        if (pending) this.store.bytes = pending
      },
      abort: async () => void (pending = undefined),
    }
  }
}

export class FakeDirectory {
  readonly kind = 'directory'
  private files = new Map<string, { bytes: Uint8Array<ArrayBuffer> }>()
  private dirs = new Map<string, FakeDirectory>()
  /** What queryPermission answers; `requestPermission` turns it to 'granted' unless `refuse` is set. */
  permission: PermissionState = 'granted'
  refuse = false
  private root: FakeDirectory

  constructor(
    readonly name = 'Writing',
    root?: FakeDirectory,
  ) {
    this.root = root ?? this
  }

  check() {
    if (this.root.permission !== 'granted') throw new DOMException('no access', 'NotAllowedError')
  }
  async queryPermission() {
    return this.root.permission
  }
  async requestPermission() {
    if (!this.root.refuse) this.root.permission = 'granted'
    return this.root.permission
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    this.check()
    let dir = this.dirs.get(name)
    if (!dir) {
      if (!opts?.create) throw notFound()
      dir = new FakeDirectory(name, this.root)
      this.dirs.set(name, dir)
    }
    return dir
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    this.check()
    let store = this.files.get(name)
    if (!store) {
      if (!opts?.create) throw notFound()
      store = { bytes: new Uint8Array(0) }
      this.files.set(name, store)
    }
    return new FakeFile(name, store, this)
  }
  async removeEntry(name: string) {
    this.check()
    if (!this.files.delete(name) && !this.dirs.delete(name)) throw notFound()
  }
  async *entries() {
    this.check()
    for (const [name, store] of this.files) yield [name, new FakeFile(name, store, this)] as const
    for (const [name, dir] of this.dirs) yield [name, dir] as const
  }

  /** Put a file in place without going through the API, as another app would. */
  seed(path: string, text: string) {
    const parts = path.split('/')
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- walking down from here
    let dir: FakeDirectory = this
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part)
      if (!next) dir.dirs.set(part, (next = new FakeDirectory(part, this.root)))
      dir = next
    }
    dir.files.set(parts.at(-1)!, { bytes: new TextEncoder().encode(text) })
  }
  /** Every file below, as paths. */
  paths(prefix = ''): string[] {
    return [
      ...[...this.files.keys()].map((n) => prefix + n),
      ...[...this.dirs].flatMap(([n, d]) => d.paths(`${prefix}${n}/`)),
    ]
  }
  asHandle() {
    return this as unknown as FileSystemDirectoryHandle
  }
}
