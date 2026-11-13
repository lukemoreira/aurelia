// SPDX-License-Identifier: AGPL-3.0-or-later

let worker: Worker | undefined
let nextId = 0

/** Run the sync-access-handle writer; the answer carries the browser's error name on failure. */
function writeInWorker(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  worker ??= new Worker(new URL('./sync-write.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  const id = nextId++
  return new Promise((resolve, reject) => {
    const done = () => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onBroken)
      w.removeEventListener('messageerror', onBroken)
    }
    const onMessage = (e: MessageEvent<{ id: number; error?: string }>) => {
      if (e.data.id !== id) return
      done()
      if (e.data.error) reject(Object.assign(new Error(e.data.error), { name: e.data.error }))
      else resolve()
    }
    // A worker that failed to load or died answers nothing: fail the write so the save retries.
    const onBroken = () => {
      done()
      w.terminate()
      if (worker === w) worker = undefined
      reject(new Error('The writer stopped before it answered.'))
    }
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onBroken)
    w.addEventListener('messageerror', onBroken)
    w.postMessage({ id, handle, bytes })
  })
}

/**
 * Replace a file's bytes.
 *
 * `createWritable()` writes to a swap file and swaps it in on close, so a write that dies
 * leaves the old file whole. Where it is missing (older Safari, browser storage only) the
 * only way to write is a sync access handle in a worker, which edits the file in place: a
 * kill mid-write can leave it half written. That is safe here only because the save pipeline
 * keeps the new text in the recovery journal until the write is confirmed.
 */
export async function writeFileBytes(
  handle: FileSystemFileHandle,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  if (typeof handle.createWritable !== 'function') return writeInWorker(handle, bytes)
  const writable = await handle.createWritable()
  try {
    await writable.write(bytes)
    await writable.close()
  } catch (e) {
    await writable.abort().catch(() => undefined)
    throw e
  }
}
