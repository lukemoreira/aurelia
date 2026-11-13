// SPDX-License-Identifier: AGPL-3.0-or-later
// A worker that writes a browser-storage file where `createWritable` does not exist (older
// Safari). A sync access handle can only be opened off the main thread.

interface SyncAccessHandle {
  truncate(size: number): void
  write(data: Uint8Array, opts: { at: number }): number
  flush(): void
  close(): void
}
interface Request {
  id: number
  handle: { createSyncAccessHandle(): Promise<SyncAccessHandle> }
  bytes: Uint8Array
}
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null
  postMessage(message: unknown): void
}

scope.onmessage = async ({ data: { id, handle, bytes } }) => {
  try {
    const access = await handle.createSyncAccessHandle()
    try {
      access.truncate(0)
      access.write(bytes, { at: 0 })
      access.flush()
    } finally {
      access.close()
    }
    scope.postMessage({ id })
  } catch (e) {
    scope.postMessage({ id, error: e instanceof Error ? e.name : 'Error' })
  }
}
