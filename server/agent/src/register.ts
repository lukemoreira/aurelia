// SPDX-License-Identifier: AGPL-3.0-or-later
// The app's plain-TS layers (src/domain, src/index, src/storage) are written for Vite: `@/…` imports and
// no file extensions. This hook lets Node run them unchanged (ADR-0008: "the plain-TS layers run
// unchanged in Node"). Loaded with `node --import ./src/register.ts`.
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The app's `src/`: three folders up from here, in the repository and in the image alike. */
const APP_SRC = fileURLToPath(new URL('../../../src/', import.meta.url))

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : ''
    let file: string | null = null
    if (specifier.startsWith('@/')) file = APP_SRC + specifier.slice(2)
    else if (specifier.startsWith('.') && parent.startsWith(APP_SRC) && !/\.\w+$/.test(specifier))
      file = fileURLToPath(new URL(specifier, context.parentURL))
    if (file) {
      const hit = [file, `${file}.ts`, `${file}/index.ts`].find(
        (f) => /\.\w+$/.test(f) && existsSync(f),
      )
      if (hit) return next(pathToFileURL(hit).href, context)
    }
    return next(specifier, context)
  },
})
