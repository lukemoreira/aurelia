// SPDX-License-Identifier: AGPL-3.0-or-later
import { HandleAdapter } from './handle-adapter'

/** Only Chrome and Edge can open a real folder. */
export const canPickFolder = () => typeof window.showDirectoryPicker === 'function'

/** Browser storage (OPFS) works in every current browser. */
export const canKeepInBrowser = () => typeof navigator.storage?.getDirectory === 'function'

const folderLabel = (name: string) => `the folder “${name}”`

/** Let the author pick a folder. Null when they close the picker. */
export async function pickFolder(): Promise<HandleAdapter | null> {
  try {
    const handle = await window.showDirectoryPicker!({ id: 'aurelia', mode: 'readwrite' })
    return new HandleAdapter(handle, 'folder', folderLabel(handle.name))
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return null
    throw e
  }
}

/** One directory per workspace in the browser's private file system, named by workspace ID. */
export async function browserDirectory(
  id: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  const all = await root.getDirectoryHandle('workspaces', { create })
  return all.getDirectoryHandle(id, { create })
}

export const browserAdapter = (dir: FileSystemDirectoryHandle) =>
  new HandleAdapter(dir, 'browser', 'this browser')

/** Ask the browser not to clear this site's storage. Null when it cannot say. */
export async function requestPersistence(): Promise<boolean | null> {
  return (await navigator.storage?.persist?.()) ?? null
}

export async function isPersisted(): Promise<boolean | null> {
  return (await navigator.storage?.persisted?.()) ?? null
}
