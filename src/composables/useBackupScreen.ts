// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { server } from '@/backup/app'
import { agoWords, folderWords, statusTag, twoVersionsOf, type Tone } from '@/backup/words'
import { downloadVersion, type VersionInfo } from '@/backup/restore'
import { wordsFor } from '@/storage/errors'
import { useBackupStore } from '@/stores/backup'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAppUpdate } from './useAppUpdate'
import { saveBlob, useDownloadCopy } from './useDownloadCopy'
import { useRestore } from './useRestore'

/** Everything the Backup screen shows and does: the server card, the versions, restore and download. */
export function useBackupScreen() {
  const ws = useWorkspaceStore()
  const backup = useBackupStore()
  const layout = useLayoutStore()
  // A restored copy opens in place of this screen.
  const restore = useRestore(() => (layout.backupOpen = false))
  const { signIn } = useAppUpdate()
  const copy = useDownloadCopy()
  const busy = ref('')
  const actionError = ref('')

  const view = computed(() => backup.view)
  const enabled = computed(() => !!view.value?.enabled)
  /** Kept in sync (ADR-0012): the sync card is the control, and the server card says backup comes with it. */
  const syncing = computed(() => !!view.value?.enabled && view.value.mode === 'sync')
  const name = computed(() => ws.view?.name ?? '')

  const tag = computed<{ label: string; tone: Tone }>(() => {
    const v = view.value
    if (v?.enabled) return statusTag(v.status) ?? { label: 'On', tone: 'ok' }
    if (backup.serverState === 'sign-in') return { label: 'Sign in needed', tone: 'warn' }
    if (backup.serverState === 'none') return { label: 'Not found', tone: 'neutral' }
    if (backup.serverState === 'unknown') return { label: 'Checking…', tone: 'neutral' }
    return { label: 'Off', tone: 'neutral' }
  })

  const text = computed(() => {
    const v = view.value
    if (syncing.value && v?.status !== 'ask' && v?.status !== 'paused' && v?.status !== 'failed')
      return 'Every change goes to your server through sync, and versions are kept as usual.'
    if (v?.enabled) {
      if (v.status === 'ask') return '' // the box below says it
      if ((v.status === 'paused' || v.status === 'failed') && v.error) return v.error
      const folder = v.folder ? folderWords(v.folder, v.name) : ''
      return v.lastBackup === null
        ? `Backing up to ${folder}…`
        : `Backing up to ${folder}. Last backup ${agoWords(v.lastBackup, backup.now)}.`
    }
    if (backup.serverState === 'sign-in') return 'Your server asked you to sign in again.'
    if (backup.serverState === 'none')
      return 'Backup works when Aurelia runs on your own server with its storage service. This copy of Aurelia has none.'
    return 'Copies this workspace to your own server, in a folder you can open without Aurelia.'
  })

  const twoVersions = computed(() => twoVersionsOf(ws.view).length)

  const syncTag = computed<{ label: string; tone: Tone }>(() => {
    const v = view.value
    if (!syncing.value || !v) return { label: 'Off', tone: 'neutral' }
    const tagged = statusTag(v.status)
    if (tagged) return tagged
    return twoVersions.value ? { label: 'Two versions', tone: 'warn' } : { label: 'On', tone: 'ok' }
  })

  const syncText = computed(() => {
    const v = view.value
    if (!syncing.value || !v)
      return 'Backup keeps a copy on your server; sync keeps every device the same, with versions too. Changes you write here show up on your other devices, and theirs show up here. If two devices change the same scene, both versions are kept.'
    if (v.status === 'ask') return ''
    if (v.status === 'offline')
      return v.sync?.waiting
        ? `Your server can’t be reached. ${v.sync.waiting} ${v.sync.waiting === 1 ? 'change waits' : 'changes wait'} here and go when it can.`
        : 'Your server can’t be reached. Aurelia tries again by itself.'
    if ((v.status === 'paused' || v.status === 'failed') && v.error) return v.error
    return v.lastBackup === null
      ? 'Syncing for the first time…'
      : `Last looked at your server ${agoWords(v.lastBackup, backup.now)}.`
  })

  const devices = computed(() =>
    (view.value?.sync?.devices ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      self: d.self,
      when: agoWords(Date.parse(d.at), backup.now),
    })),
  )

  const needsSignIn = computed(
    () => view.value?.status === 'paused' || (!enabled.value && backup.serverState === 'sign-in'),
  )
  const canSwitch = computed(
    () => view.value?.status !== 'ask' && (enabled.value || backup.serverState === 'available'),
  )
  const canSync = computed(
    () => view.value?.status !== 'ask' && (syncing.value || backup.serverState === 'available'),
  )

  async function attempt(key: string, work: () => Promise<unknown>) {
    busy.value = key
    actionError.value = ''
    try {
      await work()
    } catch (e) {
      actionError.value = wordsFor(e, 'That did not work. Nothing was lost.')
    } finally {
      busy.value = ''
    }
  }

  const setOn = (on: boolean) =>
    attempt('switch', async () => {
      if (on) await backup.turnOn()
      else await backup.turnOff()
      await backup.refreshVersions()
    })
  const setSync = (on: boolean) =>
    attempt('sync', async () => {
      if (on) await backup.turnOnSync()
      else await backup.turnOffSync()
      await backup.refreshVersions()
    })
  /** The files with two versions are chosen between in their own dialog: this one gives way to it. */
  async function reviewVersions() {
    layout.backupOpen = false
    await nextTick()
    layout.filesOpen = true
  }
  const backUpNow = () =>
    attempt('now', async () => (await backup.backUpNow(), backup.refreshVersions()))
  const tryAgain = () => attempt('now', async () => (backup.resume(), backup.refreshVersions()))
  const keepBoth = () =>
    attempt('both', async () => (await backup.keepBoth(), backup.refreshVersions()))
  const useBackupHere = () =>
    attempt('use', async () => {
      const folder = await backup.useBackupHere()
      if (folder) await restore.start({ folder, name: name.value })
    })

  /** Restore a version (or the latest) as a new local copy: the restore dialog opens at "where". */
  const restoreVersion = (v?: VersionInfo) => {
    const folder = view.value?.folder
    if (folder) void restore.start({ folder, name: name.value, choice: v?.name ?? 'current' })
  }
  const download = (v: VersionInfo) =>
    attempt(`dl:${v.name}`, async () => {
      const folder = view.value?.folder
      if (folder) saveBlob(await downloadVersion(server, folder, v.name), v.name)
    })

  // Look again whenever the screen opens, and whenever a backup lands while it is open.
  watch(
    () => layout.backupOpen,
    (open) => {
      if (!open) return
      actionError.value = ''
      void backup.probe()
      void backup.refreshVersions()
    },
  )
  watch(
    () => [view.value?.lastBackup, view.value?.folder],
    () => layout.backupOpen && void backup.refreshVersions(),
  )

  return reactive({
    view,
    enabled,
    syncing,
    tag,
    text,
    syncTag,
    syncText,
    devices,
    twoVersions,
    needsSignIn,
    canSwitch,
    canSync,
    busy,
    actionError,
    restore,
    copy,
    signIn,
    setOn,
    setSync,
    reviewVersions,
    backUpNow,
    tryAgain,
    keepBoth,
    useBackupHere,
    restoreVersion,
    download,
  })
}
