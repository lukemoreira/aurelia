// SPDX-License-Identifier: AGPL-3.0-or-later
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useBackupStore } from '@/stores/backup'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * What keeps the open workspace's backup going while the app is on screen: one engine per
 * session, a push when the tab is hidden (after the save has landed), a try-again when it
 * is shown or focused, and a clock for "2 min ago".
 */
export function useBackup() {
  const ws = useWorkspaceStore()
  const backup = useBackupStore()
  let tick: ReturnType<typeof setInterval> | undefined

  watch(
    () => ws.session,
    (session) => void backup.attach(session),
    { immediate: true },
  )

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') hide()
    else backup.resume()
  }
  const hide = () => void Promise.resolve(ws.flush()).finally(() => backup.onHidden())
  const show = () => {
    backup.now = Date.now()
    backup.resume()
  }

  onMounted(() => {
    tick = setInterval(() => (backup.now = Date.now()), 30_000)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', hide)
    window.addEventListener('focus', show)
  })
  onBeforeUnmount(() => {
    clearInterval(tick)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', hide)
    window.removeEventListener('focus', show)
  })
}
