// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref } from 'vue'

type Register = typeof import('virtual:pwa-register').registerSW

/** How often an open tab asks whether a new version is out. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000

const updateReady = ref(false)
let applyUpdate: ((reload?: boolean) => Promise<void>) | undefined

/**
 * Register the service worker. A new version is only announced (`updateReady`): nothing
 * reloads until the author chooses to, because a reload must never cut into writing.
 */
export function startUpdates(register: Register): void {
  applyUpdate = register({
    immediate: true,
    onNeedRefresh: () => (updateReady.value = true),
    onRegisteredSW: (_url, registration) => {
      if (registration)
        setInterval(() => void registration.update().catch(() => {}), UPDATE_CHECK_MS)
    },
  })
}

/** The "update available" state for the toast: reload on request, or leave it for later. */
export function useAppUpdate() {
  return {
    updateReady,
    reload: () => void applyUpdate?.(true),
    dismiss: () => (updateReady.value = false),
  }
}
