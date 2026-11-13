// SPDX-License-Identifier: AGPL-3.0-or-later
// Only built into the end-to-end build (`vite build --mode e2e`, see main.ts); the production
// bundle never contains it, and a test fails if it does. It lets Playwright run the adapter
// contract inside a real browser, against OPFS, where Vitest cannot.
import type { StorageAdapter } from './adapter'
import { browserAdapter, browserDirectory } from './browser'
import { ADAPTER_CONTRACT } from './contract'
import { HandleAdapter } from './handle-adapter'

export interface ContractResult {
  name: string
  ok: boolean
  error?: string
}

/** Where the cases run: the browser's storage, or an OPFS directory standing in for a real folder. */
type Target = 'browser' | 'folder'

async function runContract(
  target: Target,
  withoutCreateWritable = false,
): Promise<ContractResult[]> {
  const proto = FileSystemFileHandle.prototype as { createWritable?: unknown }
  const real = proto.createWritable
  if (withoutCreateWritable) delete proto.createWritable // older Safari: the worker path
  const made: string[] = []
  const make = async (): Promise<StorageAdapter> => {
    const id = `contract-${crypto.randomUUID()}`
    made.push(id)
    const dir = await browserDirectory(id, true)
    return target === 'browser'
      ? browserAdapter(dir)
      : new HandleAdapter(dir, 'folder', 'test folder')
  }
  const results: ContractResult[] = []
  try {
    for (const c of ADAPTER_CONTRACT) {
      try {
        await c.run(make)
        results.push({ name: c.name, ok: true })
      } catch (e) {
        results.push({ name: c.name, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
  } finally {
    if (withoutCreateWritable) proto.createWritable = real
    const all = await (await navigator.storage.getDirectory()).getDirectoryHandle('workspaces')
    for (const id of made) await all.removeEntry(id, { recursive: true }).catch(() => undefined)
  }
  return results
}

/** A write that dies before the swap leaves the old file whole (the `createWritable` guarantee). */
async function abortedWriteKeepsOldFile(): Promise<ContractResult> {
  const name = 'a write that dies half way leaves the old file whole'
  const id = `contract-${crypto.randomUUID()}`
  const proto = FileSystemFileHandle.prototype
  const real = proto.createWritable
  try {
    const adapter = browserAdapter(await browserDirectory(id, true))
    await adapter.write('a.md', 'the old file')
    proto.createWritable = async function (this: FileSystemFileHandle, ...args) {
      const stream = await real.apply(this, args)
      stream.close = async () => {
        await stream.abort()
        throw new Error('killed before the swap')
      }
      return stream
    }
    const failed = await adapter.write('a.md', 'the new file, half writ').then(
      () => false,
      () => true,
    )
    proto.createWritable = real
    const text = (await adapter.read('a.md'))?.text
    if (!failed) return { name, ok: false, error: 'the write did not fail' }
    return text === 'the old file'
      ? { name, ok: true }
      : { name, ok: false, error: `file is now ${text}` }
  } catch (e) {
    return { name, ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    proto.createWritable = real
    const all = await (await navigator.storage.getDirectory()).getDirectoryHandle('workspaces')
    await all.removeEntry(id, { recursive: true }).catch(() => undefined)
  }
}

declare global {
  interface Window {
    __aureliaTest?: {
      runContract: typeof runContract
      abortedWriteKeepsOldFile: typeof abortedWriteKeepsOldFile
    }
  }
}

export function installTestHook() {
  window.__aureliaTest = { runContract, abortedWriteKeepsOldFile }
}
