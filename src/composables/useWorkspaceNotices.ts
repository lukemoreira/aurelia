// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch } from 'vue'
import type { ConflictView } from '@/storage/session'
import type { BannerKind } from '@/components/shell/Banner.vue'
import { wordsFor } from '@/storage/errors'
import { useBackupStore } from '@/stores/backup'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAppUpdate } from './useAppUpdate'
import { useInstallHint } from './useInstallHint'

export interface BannerSpec {
  id: string
  kind: BannerKind
  title: string
  text: string
  tag?: string
  action?: string
  run?: () => void
  dismiss?: string
  onDismiss?: () => void
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** The banners above the writing, from the open workspace's state (States board), most urgent first. */
export function useWorkspaceNotices() {
  const ws = useWorkspaceStore()
  const backup = useBackupStore()
  const layout = useLayoutStore()
  const { updateReady, reload, signIn } = useAppUpdate()
  const install = useInstallHint()
  /** The conflict being compared, and whether the file list is open. */
  const comparing = ref<string>()
  const filesOpen = ref(false)
  /** What a dialog is waiting for (`resolve`, or a copy's path), and why it failed. One place for both dialogs. */
  const busy = ref('')
  const error = ref('')
  watch([comparing, filesOpen], () => (error.value = ''))

  async function attempt(key: string, work: () => Promise<void>): Promise<boolean> {
    busy.value = key
    error.value = ''
    try {
      await work()
      return true
    } catch (e) {
      error.value = wordsFor(e)
      return false
    } finally {
      busy.value = ''
    }
  }
  /** The author's choice in the open conflict. */
  async function resolve(choice: 'theirs' | 'mine') {
    const path = comparing.value
    if (
      path &&
      (await attempt('resolve', async () => {
        // A version of the whole workspace first (when backup is on), so either choice can be undone.
        await backup.beforeRisky(choice === 'mine' ? 'before-keep-mine' : 'before-use-file')
        await ws.session?.resolveConflict(path, choice)
      }))
    )
      comparing.value = undefined
  }
  /** The author's choice for a conflicted copy. */
  const reconcile = (path: string, keep: 'original' | 'copy') =>
    attempt(path, async () => void (await ws.session?.reconcileCopy(path, keep)))

  const banners = computed<BannerSpec[]>(() => {
    const view = ws.view
    const session = ws.session
    if (!view || !session) return []
    const out: BannerSpec[] = []

    if (view.newerVersion)
      out.push({
        id: 'read-only',
        kind: 'info',
        title: 'This workspace was saved by a newer version of Aurelia',
        text: updateReady.value
          ? 'It is open read-only, so nothing can be overwritten. Update Aurelia to edit it.'
          : 'It is open read-only, so nothing can be overwritten. Update Aurelia when it offers a new version, then open this workspace again.',
        tag: 'Read-only',
        ...(updateReady.value ? { action: 'Get the update', run: reload } : {}),
      })

    if (view.otherTab)
      out.push({
        id: 'other-tab',
        kind: 'info',
        title: 'This workspace is open in another tab',
        text: 'Close that tab to write here.',
        tag: 'Read-only',
      })

    if (view.settling)
      out.push({
        id: 'settling',
        kind: 'info',
        title: 'Getting this workspace ready…',
        text: 'You can write in a moment.',
        tag: 'One moment',
      })

    if (view.permissionLost && view.kind === 'folder')
      out.push({
        id: 'permission',
        kind: 'warn',
        title: `Aurelia can’t reach ${view.label}`,
        text: 'Keep writing. Your words are kept safe on this device until you reconnect.',
        tag: 'Folder',
        action: 'Reconnect folder',
        run: () => void session.reconnect(),
      })

    if (view.save.kind === 'failed')
      out.push({
        id: 'save-failed',
        kind: 'danger',
        title: 'Could not save your changes',
        text: `${view.save.message ?? ''} Your words are kept in the recovery journal on this device, and Aurelia will try again.`.trim(),
        tag: 'Not saved',
        action: 'Try again',
        run: () => void session.flush(),
      })

    for (const c of view.conflicts)
      out.push({
        id: `conflict:${c.path}`,
        kind: 'info',
        title: `“${c.title}” changed outside Aurelia while it was open here`,
        text: 'Nothing was overwritten. Both versions are kept.',
        tag: 'Two versions',
        action: 'Compare versions',
        run: () => (comparing.value = c.path),
      })

    if (view.copies.length)
      out.push({
        id: 'copies',
        kind: 'warn',
        title: `${view.copies.length} ${plural(view.copies.length, 'copy', 'copies')} set aside by a sync tool`,
        text: 'Two versions of a file met. Choose which to keep. Nothing is deleted.',
        tag: 'Conflicted copy',
        action: 'Review',
        run: () => (filesOpen.value = true),
      })

    if (view.problems.length)
      out.push({
        id: 'problems',
        kind: 'warn',
        title: `${view.problems.length} ${plural(view.problems.length, 'file', 'files')} could not be read`,
        text: `They are left exactly as they are. Start with “${view.problems[0]!.path}”.`,
        tag: 'Not loaded',
        action: 'See files',
        run: () => (filesOpen.value = true),
      })

    const b = backup.view
    if (b?.enabled && b.status === 'ask')
      out.push({
        id: 'backup-ask',
        kind: 'warn',
        title: 'Another device already backs this workspace up',
        text: 'Aurelia stopped, so nothing on your server is overwritten. Choose what to do.',
        tag: 'Backup',
        action: 'Choose',
        run: () => (layout.backupOpen = true),
      })
    if (b?.enabled && b.status === 'paused')
      out.push({
        id: 'backup-paused',
        kind: 'warn',
        title: 'Backup paused — sign in again',
        text: 'Your words are safe on this device and wait to be backed up once you are signed in.',
        tag: 'Backup',
        action: 'Sign in again',
        run: signIn,
      })

    if (view.journalFailed)
      out.push({
        id: 'journal',
        kind: 'warn',
        title: 'Aurelia can’t keep its safety copy on this device',
        text: 'This browser would not store it (a private window can do that). Saving to your files still works.',
        tag: 'Heads up',
      })

    for (const n of view.notes)
      out.push({
        id: `note:${n.id}`,
        kind: 'info',
        title: n.title,
        text: n.text,
        dismiss: 'Dismiss',
        onDismiss: () => session.dismissNote(n.id),
      })

    if (view.kind === 'browser' && view.saved && install.wanted.value)
      out.push({
        id: 'install',
        kind: 'info',
        title: 'Install Aurelia as an app',
        text: install.canInstall.value
          ? 'An installed app is less likely to have its storage cleared by the browser.'
          : 'An installed app is less likely to have its storage cleared. In Safari choose File → Add to Dock; on an iPhone, Share → Add to Home Screen.',
        tag: 'Tip',
        ...(install.canInstall.value
          ? { action: 'Install', run: () => void install.install() }
          : {}),
        dismiss: 'Not now',
        onDismiss: install.dismiss,
      })

    return out
  })

  // The dialog stays open while a choice is applied, and the conflict leaves the view the moment
  // it is resolved: keep showing the last one meanwhile.
  const live = computed(() => ws.view?.conflicts.find((c) => c.path === comparing.value))
  let last: ConflictView | undefined
  const conflict = computed(() => {
    if (live.value) last = live.value
    return last?.path === comparing.value ? last : undefined
  })
  return { banners, comparing, conflict, filesOpen, busy, error, resolve, reconcile }
}
