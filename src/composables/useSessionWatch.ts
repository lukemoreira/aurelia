// SPDX-License-Identifier: AGPL-3.0-or-later
import { onBeforeUnmount, onMounted } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'

/** How often the open scene's file is checked for a change made outside Aurelia. */
const POLL_MS = 2500

/**
 * What keeps the open workspace true to its files while the app is on screen: save when the
 * tab is hidden or closing, poll the open scene's file, and look at every file when the
 * window is focused again. The polling pauses while the tab is hidden.
 */
export function useSessionWatch() {
  const ws = useWorkspaceStore()
  let timer: ReturnType<typeof setInterval> | undefined

  const visible = () => document.visibilityState === 'visible'
  const pollScene = () => {
    if (visible() && ws.sceneId) void ws.session?.checkScene(ws.sceneId)
  }
  const onVisibility = () => {
    if (visible()) void ws.session?.checkAll()
    else void ws.flush()
  }
  const onFocus = () => void ws.session?.checkAll()
  const onHide = () => void ws.flush()

  onMounted(() => {
    timer = setInterval(pollScene, POLL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onHide)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pagehide', onHide)
  })
}
