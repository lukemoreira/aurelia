# ADR-0001 — Frontend stack and editor

- Status: accepted (owner, 2026-11-12)
- Deciders: owner, Claude

## Decision

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict: true` | Large domain model; types catch link and schema mistakes. |
| UI framework | Vue 3, `<script setup lang="ts">` | Named in the spec; small, readable components. |
| State | Pinia | Official Vue store; devtools support. |
| Routing | Vue Router | Deep links to a scene or a record (`/u/:universe/b/:book/s/:scene`). |
| Styling | Tailwind CSS v4 + CSS-variable design tokens | Tokens give one source for light/dark; Tailwind reads them. |
| Components | Our own, on **Reka UI** (headless, accessible primitives) | The spec suggests PrimeVue. PrimeVue's look is hard to make distinctive, and design quality is a top priority. Reka UI gives focus traps, menus, comboboxes and ARIA without imposing a look. |
| Editor | **Tiptap 3** (ProseMirror) | Structured document, transactions, deterministic undo/redo, custom nodes (choices, embeds, callouts), first-class Vue 3 bindings, mature ecosystem. Only open-source Tiptap extensions; Tiptap Pro (closed) is banned ([ADR-0005](0005-license.md)). |
| Search | MiniSearch | Small, no dependencies, fuzzy and prefix search in the browser. |
| Validation | Zod | Schema for every file; clear errors on bad files. |
| Build | Vite + `vite-plugin-pwa` | Fast dev server; offline service worker. |
| Tests | Vitest (+ Vue Test Utils, happy-dom), Playwright | Unit tests for plain-TS layers; E2E for the main writer flows. |
| Fonts | Inter (UI), Literata (manuscript), JetBrains Mono (source) via `@fontsource` | All SIL OFL; self-hosted so the app works offline. |

## Lexical was considered

Lexical (Meta) is fast and well built, but its Vue support is community-only, and its
Markdown and collaboration story is less mature than ProseMirror's. Tiptap wins on Vue
fit and custom-node ergonomics.

## Open

The Markdown converter (`@tiptap/markdown` vs `prosemirror-markdown`) is chosen in the
M4 spike and recorded in ADR-0007. The deciding test is a lossless round trip of the
full dialect in [ADR-0003](0003-file-format.md).

## Dependency rule

Before adding a package: can we write it in a few lines? If not, prefer a package that
is maintained, widely used, small, and needs no native build step.
