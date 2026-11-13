// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref } from 'vue'
import { isString, usePersisted } from './usePersisted'

interface InstallPrompt extends Event {
  prompt(): Promise<unknown>
}

// Chrome and Edge offer to install through this event; Safari has no such event (a menu item instead).
const prompt = ref<InstallPrompt | null>(null)
if (typeof window !== 'undefined')
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    prompt.value = e as InstallPrompt
  })

const installed = () =>
  typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches

/** A one-time, dismissible suggestion to install Aurelia as an app (ADR-0009: it protects browser storage). */
export function useInstallHint() {
  const dismissed = usePersisted('install-hint', '', isString)
  return {
    /** Whether to show it, once the caller knows a save has happened. */
    wanted: computed(() => dismissed.value !== 'dismissed' && !installed()),
    /** The browser's own install button exists. */
    canInstall: computed(() => prompt.value !== null),
    install: async () => {
      await prompt.value?.prompt()
      dismissed.value = 'dismissed'
    },
    dismiss: () => (dismissed.value = 'dismissed'),
  }
}
