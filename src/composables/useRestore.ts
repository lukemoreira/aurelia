// SPDX-License-Identifier: AGPL-3.0-or-later
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { backupState, server } from '@/backup/app'
import {
  fetchBackup,
  listBackups,
  listVersions,
  withNewId,
  writeRestored,
  type BackupListing,
  type Problem,
  type VersionInfo,
} from '@/backup/restore'
import { newId } from '@/domain/ids'
import type { StorageAdapter } from '@/storage/adapter'
import { recents } from '@/storage/app'
import {
  browserAdapter,
  browserDirectory,
  browserDirectoryExists,
  canKeepInBrowser,
  canPickFolder,
  discardBrowserDirectory,
  pickFolder,
} from '@/storage/browser'
import { inspectFolder } from '@/storage/create'
import { RemoteError, wordsFor } from '@/storage/errors'
import { detectServer } from '@/storage/remote/webdav-store'
import { useWorkspaceStore } from '@/stores/workspace'

export type RestoreStep = 'workspaces' | 'versions' | 'destination' | 'problems' | 'sign-in'

/** What a backup folder needs to be restored from. */
export interface RestoreSource {
  folder: string
  name: string
}

/**
 * "Restore from a backup": pick a workspace on the server, then a version (the latest or an
 * earlier one), then where it goes. A restore always makes a NEW local copy — it never writes
 * over a workspace that is open — and nothing opens until every file has been checked.
 */
export function useRestore(onOpened?: () => void) {
  const router = useRouter()
  const ws = useWorkspaceStore()
  const open = ref(false)
  const step = ref<RestoreStep>('workspaces')
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  const listings = ref<BackupListing[]>([])
  const picked = ref<RestoreSource | null>(null)
  const versions = ref<VersionInfo[]>([])
  const choice = ref('current')
  const problems = ref<Problem[]>([])
  /** Whether Welcome should offer a restore at all: a server is there (maybe asking for a sign-in). */
  const server_ = ref<'unknown' | 'available' | 'sign-in' | 'none'>('unknown')

  async function probe() {
    server_.value = await detectServer()
  }

  /** A call to the server that sends the author to "sign in again" when the login ran out. */
  async function guarded<T>(work: () => Promise<T>): Promise<T | undefined> {
    error.value = ''
    try {
      return await work()
    } catch (e) {
      if (e instanceof RemoteError && e.code === 'unauthorized') step.value = 'sign-in'
      else error.value = wordsFor(e, 'Aurelia could not read your server.')
    }
  }

  /** Open the dialog: at the list of workspaces, or — with a source — at the choice of where it goes. */
  async function start(source?: RestoreSource & { choice?: string }) {
    open.value = true
    problems.value = []
    error.value = ''
    if (source) {
      picked.value = { folder: source.folder, name: source.name }
      choice.value = source.choice ?? 'current'
      step.value = 'destination'
      return
    }
    step.value = 'workspaces'
    loading.value = true
    listings.value = (await guarded(() => listBackups(server))) ?? []
    loading.value = false
  }

  async function pick(listing: BackupListing) {
    picked.value = { folder: listing.folder, name: listing.name }
    loading.value = true
    const found = await guarded(() => listVersions(server, listing.folder))
    loading.value = false
    if (!found) return
    versions.value = found
    choice.value = 'current'
    step.value = 'versions'
  }

  const chooseVersion = (name: string) => {
    choice.value = name
    step.value = 'destination'
  }

  function back() {
    error.value = ''
    if (step.value === 'destination' && versions.value.length) step.value = 'versions'
    else if (step.value === 'destination' || step.value === 'versions') void start()
    else if (step.value === 'problems') step.value = 'destination'
  }

  /**
   * The ID a restored workspace gets: its own, unless this device already knows a workspace by it
   * — as a recent, as browser storage, or as a backup it remembers (a copy under that ID would
   * inherit that backup's state and could put an older copy over the newer one on the server).
   */
  async function freeId(id: string) {
    const known =
      (await recents.get(id).catch(() => undefined)) ||
      (await browserDirectoryExists(id)) ||
      !!(await backupState.load(id).catch(() => null))?.folder
    return known ? newId('wsp') : id
  }

  async function restore(where: 'browser' | 'folder') {
    const source = picked.value
    if (!source || busy.value) return
    busy.value = true
    error.value = ''
    let made: string | null = null
    try {
      // The folder picker needs the click that got us here, so it comes before the (slow) download.
      let folder: StorageAdapter | null = null
      if (where === 'folder') {
        folder = await pickFolder()
        if (!folder) return
        if ((await inspectFolder(folder)).state !== 'empty') throw new Error('not-empty')
      }
      const fetched = await fetchBackup(server, source.folder, choice.value)
      if (fetched.problems.length) {
        problems.value = fetched.problems
        step.value = 'problems'
        return
      }
      const id = JSON.parse(new TextDecoder().decode(fetched.files.get('aurelia.json')))
        .id as string
      const fresh = await freeId(id)
      const files = fresh === id ? fetched.files : withNewId(fetched.files, fresh)
      let adapter = folder
      if (!adapter) {
        made = fresh
        adapter = browserAdapter(await browserDirectory(fresh, true))
      }
      await writeRestored(adapter, files)
      await backupState.clear(fresh).catch(() => undefined) // a restored copy starts with backup off
      made = null
      open.value = false
      await ws.open(adapter)
      onOpened?.()
      await router.push(ws.startPath())
    } catch (e) {
      if (made) await discardBrowserDirectory(made).catch(() => undefined)
      error.value =
        e instanceof Error && e.message === 'not-empty'
          ? 'That folder already has files in it, so Aurelia left it alone. Choose a new, empty folder.'
          : wordsFor(e, 'Aurelia could not restore that backup. Nothing was changed.')
      if (e instanceof RemoteError && e.code === 'unauthorized') step.value = 'sign-in'
    } finally {
      busy.value = false
    }
  }

  return reactive({
    open,
    step,
    loading,
    busy,
    error,
    listings,
    picked,
    versions,
    problems,
    serverState: server_,
    canKeepInBrowser: canKeepInBrowser(),
    canPickFolder: canPickFolder(),
    probe,
    start,
    pick,
    chooseVersion,
    back,
    restore,
  })
}
