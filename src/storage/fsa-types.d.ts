// SPDX-License-Identifier: AGPL-3.0-or-later
// What the File System Access API adds beyond TypeScript's DOM types.

interface FileSystemPermissionOptions {
  mode: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission?(options: FileSystemPermissionOptions): Promise<PermissionState>
  requestPermission?(options: FileSystemPermissionOptions): Promise<PermissionState>
}

interface Window {
  showDirectoryPicker?(options?: {
    id?: string
    mode?: 'read' | 'readwrite'
  }): Promise<FileSystemDirectoryHandle>
}
