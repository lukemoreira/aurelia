// SPDX-License-Identifier: AGPL-3.0-or-later
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import { createWebHistory } from 'vue-router'
import App from './App.vue'
import { startUpdates } from './composables/useAppUpdate'
import { useTheme } from './composables/useTheme'
import { createAppRouter } from './router'
import './styles/base.css'

// The end-to-end build only (`vite build --mode e2e`): in a production build this branch is gone.
if (import.meta.env.MODE === 'e2e')
  void import('./storage/test-hook').then((m) => m.installTestHook())

startUpdates(registerSW) // keep the app shell for offline use; a new version waits for the author
useTheme() // follow the saved theme (public/theme-init.js already set it before the first paint)
createApp(App).use(createPinia()).use(createAppRouter(createWebHistory())).mount('#app')
