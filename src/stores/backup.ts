// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { openBackup, server } from '@/backup/app'
import type { BackupEngine, BackupView } from '@/backup/engine'
import { listVersions, spaceUsed, type VersionInfo } from '@/backup/restore'
import { wordsFor } from '@/storage/errors'
import { detectServer } from '@/storage/remote/webdav-store'
import type { WorkspaceSession } from '@/storage/session'

export type ServerState = 'unknown' | 'available' | 'sign-in' | 'none'

/** The open workspace's backup, as the screens read it. The work itself is the engine's. */
export const useBackupStore = defineStore('backup', () => {
  const engine = shallowRef<BackupEngine | null>(null)
  const view = shallowRef<BackupView | null>(null)
  const serverState = ref<ServerState>('unknown')
  const versions = ref<VersionInfo[]>([])
  const space = ref<number | null>(null)
  const error = ref('')
  /** Ticks every 30 s while the shell is up, so "2 min ago" keeps counting. */
  const now = ref(Date.now())
  let unsubscribe: (() => void) | undefined
  let generation = 0

  /** Follow a session (or none): one engine per open workspace. */
  async function attach(session: WorkspaceSession | null) {
    const mine = ++generation
    unsubscribe?.()
    engine.value?.dispose()
    engine.value = view.value = null
    versions.value = []
    space.value = null
    serverState.value = 'unknown' // the last workspace's answer says nothing about this one
    if (!session) return
    const next = await openBackup(session).catch(() => null) // no device database: no backup, and no fuss
    if (mine !== generation || !next) return next?.dispose()
    engine.value = next
    view.value = next.view()
    unsubscribe = next.subscribe(() => (view.value = next.view()))
    void probe() // the status bar nudges toward backup only where there is a server to hold one
  }

  async function probe() {
    serverState.value = await detectServer()
  }

  async function refreshVersions() {
    const folder = view.value?.folder
    if (!folder) return void (versions.value = [])
    try {
      ;[versions.value, space.value] = await Promise.all([
        listVersions(server, folder),
        spaceUsed(server, folder),
      ])
      error.value = ''
    } catch (e) {
      error.value = wordsFor(e, 'Aurelia could not read the versions on your server.')
    }
  }

  const turnOn = () => engine.value?.turnOn()
  const turnOff = () => engine.value?.turnOff()
  const turnOnSync = () => engine.value?.turnOnSync()
  const turnOffSync = () => engine.value?.turnOffSync()
  /** Sync: look at the server for changes from other devices. */
  const poll = () => engine.value?.poll()
  const backUpNow = () => engine.value?.backUpNow()
  const resume = () => engine.value?.resume()
  const keepBoth = () => engine.value?.keepBoth()
  const useBackupHere = () => engine.value?.useBackupHere()
  const onHidden = () => engine.value?.onHidden()
  /**
   * A version before a big change. Never holds the author up: the zip is built first, so it holds
   * the text as it is now, and only the upload is waited for (10 s at most; it finishes anyway).
   */
  async function beforeRisky(reason: string) {
    const saved = await engine.value?.saveVersion(reason).catch(() => undefined)
    if (saved)
      await Promise.race([
        saved.uploaded.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ])
  }

  return {
    view,
    serverState,
    versions,
    space,
    error,
    now,
    attach,
    probe,
    refreshVersions,
    turnOn,
    turnOff,
    turnOnSync,
    turnOffSync,
    poll,
    backUpNow,
    resume,
    keepBoth,
    useBackupHere,
    onHidden,
    beforeRisky,
  }
})
