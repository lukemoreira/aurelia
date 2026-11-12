// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref } from 'vue'

type Register = typeof import('virtual:pwa-register').registerSW

/** How often an open tab asks whether a new version is out. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000

const updateReady = ref(false)
const signInNeeded = ref(false)
let applyUpdate: ((reload?: boolean) => Promise<void>) | undefined

/**
 * An update check that fails may mean the Cloudflare Access session ended: the server then
 * answers with a redirect to the login page, or refuses (401/403). Only that sets
 * `signInNeeded`; offline does not.
 */
async function probeSignIn(): Promise<void> {
  try {
    const res = await fetch('/sw.js', { cache: 'no-store', redirect: 'manual' })
    if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403)
      signInNeeded.value = true
  } catch {
    // Offline: nothing to say.
  }
}

/**
 * Register the service worker. A new version is only announced (`updateReady`): nothing
 * reloads until the author chooses to, because a reload must never cut into writing.
 */
export function startUpdates(register: Register): void {
  applyUpdate = register({
    immediate: true,
    onNeedRefresh: () => (updateReady.value = true),
    // Opened after the session ended: the browser cannot fetch /sw.js, so registering fails.
    onRegisterError: () => void probeSignIn(),
    onRegisteredSW: (_url, registration) => {
      if (registration)
        setInterval(() => void registration.update().catch(probeSignIn), UPDATE_CHECK_MS)
    },
  })
}

/** The "update available" state for the toast: reload on request, or leave it for later. */
export function useAppUpdate() {
  return {
    updateReady,
    reload: () => void applyUpdate?.(true),
    signInNeeded,
    signIn: () => location.assign('/signin'),
    dismiss: () => {
      updateReady.value = false
      signInNeeded.value = false
    },
  }
}
