// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/** What the built page may load: itself, and nothing from anywhere else. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

// The Latin files of the body fonts: Literata 400, Inter 400 and 500.
const PRELOADED_FONTS = /\/(literata-latin-400|inter-latin-(400|500))-normal-[\w-]+\.woff2$/

/** The built page only: the content security policy, and a preload for the fonts the first paint uses. */
const builtPage = (): Plugin => ({
  name: 'aurelia:built-page',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (_html, ctx) => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
      ...Object.keys(ctx.bundle ?? {})
        .filter((file) => PRELOADED_FONTS.test(`/${file}`))
        .map((file) => ({
          tag: 'link',
          attrs: {
            rel: 'preload',
            as: 'font',
            type: 'font/woff2',
            href: `/${file}`,
            crossorigin: '',
          },
          injectTo: 'head' as const,
        })),
    ],
  },
})

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    builtPage(),
    VitePWA({
      // A new version waits: nothing reloads while the author writes (see useAppUpdate).
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      // The manifest cannot read CSS variables: these are the light `chrome` and `canvas` tokens.
      manifest: {
        name: 'Aurelia',
        short_name: 'Aurelia',
        description: 'A local-first place to write novels, histories and branching stories.',
        theme_color: '#F3EEE4',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      // The whole app shell is cached, so it opens offline.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  // No font is inlined as a data: URI: the policy allows fonts from this origin only.
  build: { assetsInlineLimit: 0 },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'scripts/**/*.test.mjs'],
    setupFiles: ['tests/setup.ts'],
    // Quiet by default; a Vue warning is never quiet (tests/setup.ts fails the test).
    onConsoleLog: (log) => (log.includes('[Vue warn]') ? undefined : false),
  },
})
