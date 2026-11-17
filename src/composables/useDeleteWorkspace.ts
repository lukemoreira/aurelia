// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, nextTick, ref } from 'vue'
import { backupState } from '@/backup/app'
import { useBackupStore } from '@/stores/backup'
import { copyFilename, saveBlob } from '@/composables/useDownloadCopy'
import type { RecentRow, useOpenWorkspace } from '@/composables/useOpenWorkspace'
import { journal, recents, reopen } from '@/storage/app'
import { discardBrowserDirectory } from '@/storage/browser'
import {
  copyOfStored,
  deleteBrowserWorkspace,
  glanceAt,
  removeFolderFromList,
  unsavedWords,
  type DeleteDeps,
  type Glance,
} from '@/storage/delete-workspace'
import { StorageError, wordsFor } from '@/storage/errors'
import { useWorkspaceStore } from '@/stores/workspace'

/** The "Delete workspace" / "Remove from list" dialog on the Welcome screen, and what it does. */
export function useDeleteWorkspace(open: ReturnType<typeof useOpenWorkspace>) {
  const ws = useWorkspaceStore()
  const backup = useBackupStore()
  const target = ref<RecentRow | null>(null)
  /** What is in the workspace; null when it could not be read. Undefined while reading. */
  const glance = ref<Glance | null | undefined>(undefined)
  /** This device has backup or sync state for it: a copy may be on the author's server. */
  const hasBackup = ref(false)
  /** The journal holds words that never reached the workspace's files. */
  const hasUnsaved = ref(false)
  const busy = ref(false)
  const copying = ref(false)
  const copied = ref(false)
  const failure = ref('')

  const isOpen = computed({
    get: () => target.value !== null,
    set: (v) => !v && !busy.value && (target.value = null),
  })
  const folder = computed(() => target.value?.recent.kind === 'folder')

  async function begin(row: RecentRow) {
    target.value = row
    glance.value = undefined
    hasBackup.value = false
    hasUnsaved.value = false
    copied.value = false
    failure.value = ''
    if (row.recent.kind === 'folder') return
    const key = row.recent.key
    const [backedUp, unsaved] = await Promise.all([
      backupState
        .load(key)
        .then((s) => s.folder !== null)
        .catch(() => false),
      unsavedWords(journal, key)
        .then((w) => w.size > 0)
        .catch(() => false),
    ])
    const found = await reopen(row.recent)
    const read = 'adapter' in found ? await glanceAt(found.adapter) : null
    if (target.value !== row) return // another row's dialog is open now
    hasBackup.value = backedUp
    hasUnsaved.value = unsaved
    glance.value = read
  }

  const deps = (): DeleteDeps => ({
    recents,
    journal,
    backup: backupState,
    removeDirectory: discardBrowserDirectory,
    locks: navigator.locks,
    release: async (id) => {
      const open = ws.session?.data.workspace.id === id
      await ws.release(id)
      // Its backup engine is not closed with the session here: stop it, and let a round in flight end.
      if (open) await backup.stop()
    },
    forget: (id) => ws.forget(id),
  })

  async function confirm() {
    const row = target.value
    if (!row || busy.value) return
    busy.value = true
    failure.value = ''
    try {
      const { recent } = row
      if (recent.kind === 'folder') await removeFolderFromList(recent, deps())
      else await deleteBrowserWorkspace(recent, deps())
      await open.loadRecents()
      open.message.value = {
        kind: 'info',
        text:
          recent.kind === 'folder'
            ? `Removed ${recent.name} from the list.`
            : `Deleted ${recent.name}.`,
      }
      target.value = null
      // The row that had focus is gone: land on the message that says what happened.
      await nextTick()
      setTimeout(() => document.getElementById('welcome-message')?.focus(), 0)
    } catch (e) {
      failure.value = wordsFor(e, 'Aurelia could not finish deleting that. Try again.')
    } finally {
      busy.value = false
    }
  }

  /** "Download a copy first": the workspace as a zip, even when it is not the one open here. */
  async function download() {
    const row = target.value
    if (!row || copying.value) return
    copying.value = true
    copied.value = false
    failure.value = ''
    try {
      const { recent } = row
      const session = ws.session
      let blob: Blob
      if (session?.data.workspace.id === recent.key) blob = await session.exportZip()
      else {
        const found = await reopen(recent)
        if (!('adapter' in found))
          throw new StorageError('other', `${recent.name} could not be read, so no copy was made.`)
        blob = await copyOfStored(found.adapter, recent, journal)
      }
      saveBlob(blob, copyFilename(recent.name))
      if (target.value === row) copied.value = true
    } catch (e) {
      if (target.value === row) failure.value = wordsFor(e, 'Aurelia could not make the copy.')
    } finally {
      copying.value = false
    }
  }

  return {
    target,
    isOpen,
    folder,
    glance,
    hasBackup,
    hasUnsaved,
    busy,
    copying,
    copied,
    failure,
    begin,
    confirm,
    download,
  }
}
