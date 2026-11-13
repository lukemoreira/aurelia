// SPDX-License-Identifier: AGPL-3.0-or-later
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { SYNC_POLL_MS } from '@/backup/engine'
import { useBackupStore } from '@/stores/backup'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * What keeps the open workspace's backup going while the app is on screen: one engine per
 * session, a push when the tab is hidden (after the save has landed), a try-again when it
 * is shown, focused or back online, a look at the server every few minutes when the workspace
 * is kept in sync (changes from other devices), and a clock for "2 min ago".
 */
export function useBackup() {
  const ws = useWorkspaceStore()
  const backup = useBackupStore()
  let tick: ReturnType<typeof setInterval> | undefined
  let poll: ReturnType<typeof setInterval> | undefined

  watch(
    () => ws.session,
    (session) => void backup.attach(session),
    { immediate: true },
  )

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') hide()
    else show()
  }
  const hide = () => void Promise.resolve(ws.flush()).finally(() => backup.onHidden())
  const show = () => {
    backup.now = Date.now()
    backup.resume()
    backup.poll()
  }

  onMounted(() => {
    tick = setInterval(() => (backup.now = Date.now()), 30_000)
    poll = setInterval(() => document.visibilityState === 'visible' && backup.poll(), SYNC_POLL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', hide)
    window.addEventListener('focus', show)
    window.addEventListener('online', show)
  })
  onBeforeUnmount(() => {
    clearInterval(tick)
    clearInterval(poll)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', hide)
    window.removeEventListener('focus', show)
    window.removeEventListener('online', show)
  })
}
