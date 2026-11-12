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

startUpdates(registerSW) // keep the app shell for offline use; a new version waits for the author
useTheme() // follow the saved theme (public/theme-init.js already set it before the first paint)
createApp(App).use(createPinia()).use(createAppRouter(createWebHistory())).mount('#app')
