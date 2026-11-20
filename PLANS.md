# Aurelia — Build Plan

> *Write worlds. Shape stories.*
> A local-first studio for novels, history and interactive (branching) fiction.

This file is the living plan. Update it at the end of every milestone: tick the
exit criteria, record decisions, and write what is left. The product spec this
plan comes from is in [`docs/spec/aurelia-product-specification.html`](docs/spec/aurelia-product-specification.html).

---

## 1. Owner decisions (2026-11-12)

| Topic | Decision | Record |
|---|---|---|
| Frontend | Vue 3 (`<script setup lang="ts">`), Pinia, Vue Router, Tailwind CSS v4, Vite | [ADR-0001](docs/adr/0001-frontend-stack.md) |
| Editor | Tiptap 3 (ProseMirror), open-source extensions only. Markdown: `marked` with our own converter (the M4 spike, ADR-0007) | [ADR-0001](docs/adr/0001-frontend-stack.md) |
| License | AGPL-3.0-or-later | [ADR-0005](docs/adr/0005-license.md) |
| Branching | Choices between scenes are in **v1**, not later | [ADR-0004](docs/adr/0004-branching-scenes.md) |
| Design | Design quality is a top priority. Every screen is designed before it is built | [docs/design/](docs/design/) |
| Continuity | Tracking character progression, scene links and story-consistency metrics is a **core feature**, not an extra | [ADR-0006](docs/adr/0006-continuity-model.md) |
| AI assistant | Authors connect **their own** Claude or ChatGPT account to get an agent that helps | [ADR-0008](docs/adr/0008-ai-assistant.md) |
| Names | Character and place names are **found and tagged automatically** in the text, and a rename can change them everywhere in one step | [ADR-0010](docs/adr/0010-name-mentions.md) |
| Storage in v0.1 | **The browser.** Real folders in Chrome and Edge; browser storage (OPFS) in Safari and Firefox, protected by cloud backup to the author's own Google Drive, OneDrive or Nextcloud, with versions. The desktop app comes later, before M8 | [ADR-0009](docs/adr/0009-browser-storage-and-backup.md) |
| Own server and sync | Aurelia runs on the owner's TrueNAS behind Cloudflare Access. A storage container on that server (a mounted volume) is a backup target in M2b, and **two-way sync between devices comes right after the editor (M4b)**, not after v1 | [ADR-0009 amendment](docs/adr/0009-browser-storage-and-backup.md), [self-hosting](docs/self-hosting.md) |

## 2. Decisions this plan makes (owner can overrule)

1. **Every book belongs to a universe.** A standalone book gets its own universe with
   `kind: "standalone"`, and the UI hides that level. One ownership rule for storage,
   links, index and sync. → [ADR-0002](docs/adr/0002-project-model.md)
2. **Arcs are threads, not folders.** The spec says an arc lists "books/scenes affected",
   so an arc can cross books. Arcs link to scenes many-to-many. The folder level above
   chapters is an optional **Part** ("Part One", "Act II"). → ADR-0002
3. **Every record has an owner scope**: the universe (shared) or one book (private to
   it). "Promote to shared" moves a record from book to universe and keeps its ID. If a
   sync client turns the move into delete + create, two files may share one ID: that is
   a conflict shown to the author, never picked silently.
4. **File paths come from IDs, not titles.** A rename changes one line of frontmatter,
   never a path. No sync churn, no broken links. A derived `OUTLINE.md` per book maps
   titles to paths for people. → [ADR-0003](docs/adr/0003-file-format.md)
5. **One file per scene.** Smaller files mean smaller sync conflicts.
6. **The search index is device state.** It lives in IndexedDB, not in the project
   folder, so two devices never fight over it. It can always be rebuilt from the files.
7. **History writing** gets real dates (with BCE) and custom calendars in the timeline,
   plus source citations on research records.
8. **Scenes are self-describing.** Each scene stores its chapter and a fractional
   `order` key; `book.json` is a cache of order and scene frontmatter wins. The outline
   can always be rebuilt, and stray files go to an "Unfiled" group.
9. **Continuity folds in reading order.** Story time only feeds the time checks. In
   branching books state is a fixed-point dataflow over the scene graph, not a list of
   paths. → [ADR-0006](docs/adr/0006-continuity-model.md)

### Moved or dropped from the spec

The owner can object to any row.

| Spec item | Where it went |
|---|---|
| Recent and pinned items (§4) | M1 command palette and navigator |
| Timeline view with configurable columns (§4) | M5 outline columns + M6 timeline |
| Scrivener / Ulysses / Campfire / World Anvil import investigation (§10) | After v1.0 |
| Templates and plot scaffolds (roadmap phase 7) | M9 |
| Media handling (roadmap phase 2) | M6 |
| `sync-manifest.json`, `index.db`, `device-state.json` in the folder (§7) | Device-side IndexedDB (decision 6). Sync manifests are revisited in M10 |
| Arcs as folders | Arcs are threads (decision 2) |
| PrimeVue | Reka UI ([ADR-0001](docs/adr/0001-frontend-stack.md)) |
| MOBI export | Not planned |

## 3. Architecture in one picture

```
┌──────────────────────────────── UI (Vue components, thin) ───────────────────────────────┐
│ App shell · Navigator · Editor · Inspector · Corkboard · Story map · Sheets · Palette    │
└───────────────┬──────────────────────────────┬───────────────────────────┬───────────────┘
        composables (use*.ts)          Pinia stores (UI state)       commands registry
┌───────────────┴──────────┐ ┌─────────────────┴──────────┐ ┌──────────────┴──────────────┐
│ domain/                  │ │ editor/                    │ │ index/                      │
│ entities, schema (zod),  │ │ Tiptap nodes, Markdown ⇄   │ │ stable-ID resolver,         │
│ IDs, migrations, scopes, │ │ doc, wiki links, embeds,   │ │ backlinks, MiniSearch,      │
│ story graph (choices)    │ │ choices, word counts       │ │ graph data (IndexedDB)      │
└───────────────┬──────────┘ └────────────────────────────┘ └─────────────────────────────┘
┌───────────────┴───────────────────────────────────────────────────────────────────────────┐
│ storage/  StorageAdapter: FsAccess (real folder) · OPFS (browser) · later Tauri          │
│ compare-and-write saves · recovery journal · autosave queue · external-change polling     │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ backup/   RemoteStore: Google Drive · OneDrive · WebDAV (Nextcloud) · later Dropbox, S3    │
│ manifest + hashes · upload queue · versions with retention · restore                     │
└───────────────────────────────────────────────────────────────────────────────────────────┘
 later:  sync/ (two-way, builds on backup manifests; encryption)   ai/ (providers, context)
```

Rules:
- `domain/`, `editor/` (Markdown part), `index/` and `storage/` are plain TypeScript.
  They do not import Vue. They are tested without a browser UI.
- Components stay thin. Logic lives in `use*.ts` composables or in the layers above.
- A layer only talks to the layer below it through its interface.

## 4. Milestones

Each milestone is a small vertical slice with exit criteria and tests.
Do not scaffold future features early.

### Release v0.1 "Write" — write a book on your own disk

**M0 · Foundations**
- Vite + Vue 3 + TS strict, ESLint, Prettier, Vitest, Playwright, GitHub Actions CI.
- Design tokens (light + dark) as CSS variables, self-hosted fonts.
- `AGENTS.md`, ADRs 0001–0005, schema v1 with validators and a migration runner.
- Exit: `npm run check` (lint + types + unit) and `npm run e2e` pass in CI.
- Test rule: Playwright cannot click the native folder picker. E2E uses an in-memory or
  OPFS workspace; the File System Access adapter is tested as described in M2.
- **Done (2026-11-12).** Vite + Vue 3 + TS strict app at the repo root; ESLint (flat),
  Prettier, Vitest + happy-dom, Playwright (Chromium, one smoke test), CI workflow.
  `src/styles/tokens.css` is the one token source (light, dark, system dark) mapped into
  Tailwind v4 `@theme`; `@fontsource` fonts self-hosted; a WCAG contrast test covers both
  themes. `src/domain/`: ID generator, zod schema v1 (workspace, universe, book, part,
  chapter, scene, record; unknown keys kept) and a migration runner with
  `NewerSchemaError`. `scripts/check-spdx.mjs` and `scripts/check-licenses.mjs` run in
  `npm run check`. `App.vue` is a placeholder; M1 builds the shell.

**M1 · App shell and design system**
- Layout: top bar, left navigator, centre, right inspector, status bar.
- Resizable and collapsible panels; layout saved per device.
- Light / dark / system theme. Command palette (Cmd/Ctrl+K). Keyboard navigation.
- Recent and pinned items in the palette and the navigator (spec §4).
- Base components: Button, IconButton, Input, Select, Tabs, Menu, Dialog, Tooltip,
  Tree, Tag, Field (on Reka UI headless primitives).
- Exit: switch universes and books with sample data; state survives reload; AA contrast
  checked for both themes.
- **Done (2026-11-12).** Design system in `src/components/ui/` (Button, IconButton,
  Field, Input, Select, SegmentedControl, Tabs, Menu, Dialog, Sheet, Popover, Tooltip, Tree
  with pin buttons, Tag, StatusDot, Avatar, Kbd, Icon) with the `/ui` gallery. Shell in
  `src/components/shell/`: top bar (book switcher, view tabs, palette button, storage and
  review-inbox popovers, theme toggle, settings), navigator (universe switcher, filter,
  Pinned, Books / Library · shared / Standalone trees), centre with breadcrumb row, scene
  inspector (Scene tab only, read-only), status bar; below 1024 px
  the navigator and inspector are sheets and the top bar is the phone header. Panels
  resize (drag, arrow keys, Home/End) and collapse (Cmd/Ctrl+\ and Cmd/Ctrl+Alt+\).
  Command palette (Cmd/Ctrl+K): records, scenes, books and chapters, actions; Recent (8)
  and Pinned, pinned from the palette (Alt+P) or a navigator row. Everything saved per
  device in localStorage (`aurelia.theme`, and `aurelia.v1.*` for book, scene per book,
  panels, expanded branches, recent, pinned). Routes: `/` Welcome, `/w/:bookId/:sceneId?` Write,
  `/w/:bookId/{plan,continuity,world,map}` placeholders with empty states. The Saltmarch
  sample (`src/sample/`) is validated with the zod schemas on load; its IDs are derived
  from names so they are the same on every load (a random `newId` would break saved
  routes). The workspace store (`src/stores/workspace.ts`) takes a `WorkspaceData`
  (`src/domain/workspace-data.ts`): M2 feeds it from storage. PWA baseline with
  `vite-plugin-pwa`. Left for later: Recent is in the palette only (the navigator lists
  Pinned); records open a placeholder in World until M5.
- **Review fixes (2026-11-12).** Honest UI (nothing claims to be saved), accessible palette and
  keyboard, strict CSP, prompt-only PWA updates, `parseDocument` as the one way to read a file.

**M2 · Local project storage**
- `StorageAdapter` interface. **File System Access adapter** (Chrome, Edge): real
  folders. This one is certain.
- **OPFS adapter** (Safari, Firefox): the book lives in browser storage. Ask for
  persistent storage on the first save and show the answer. Suggest installing Aurelia
  as an app. Never the only copy: see M2b ([ADR-0009](docs/adr/0009-browser-storage-and-backup.md)).
  The Tauri 2 desktop app comes later, before M8.
- **Every save is compare-and-write**: stat + hash the target; if it differs from the
  last-read hash, do not write and open the conflict flow. Recovery journal in
  IndexedDB, autosave queue, save status.
- Folder permission lost → clear "Reconnect folder" flow.
- External changes (another app, a sync client): the **open scene's file is polled on a
  timer**, not only on focus; other files are checked on focus. Conflicted copies
  (`scene (conflicted copy).md`, `book.json (conflicted copy)`) are found and shown, and
  a reconcile is offered.
- Tests: the adapter contract runs on an in-memory adapter and on OPFS. The File System
  Access adapter is tested with a `FileSystemDirectoryHandle` from
  `navigator.storage.getDirectory()`.
- Exit: create, edit, close, reopen offline. Data survives reload and a killed write.
  An external change while the file is open is detected and never overwritten.
- PWA updates are prompt-only: nothing reloads while the author writes. A new version
  waits behind an "Update available — Reload" toast (`useAppUpdate`).
- **Done (2026-11-12).** `src/storage/`: `StorageAdapter` (list, read with a SHA-256 of the
  bytes on disk, write, remove, access) with an in-memory adapter and one
  `HandleAdapter` for both a real folder (File System Access, handles kept in IndexedDB
  for "recent") and browser storage (OPFS, one directory per workspace). Writes use
  `createWritable()` (swap file, replaced on close); where it is missing (older Safari,
  OPFS only) a small worker writes through a sync access handle, which edits in place —
  safe only because the journal holds the new text until the write is confirmed. One
  save pipeline (`save-pipeline.ts`): journal in IndexedDB first, compare-and-write
  (read + hash the file, refuse if it is not what we last read), journal cleared after
  the write, ~1 s debounce with a 5 s cap, retry with backoff, "blocked" when the browser
  takes the folder permission back. Startup recovery finishes a write the file has not
  seen, drops one that did land, and opens the conflict flow with both texts otherwise.
  Conflict choices never lose either side: the version not chosen is written as
  `<name> (Aurelia copy).<ext>` first (numbered if taken), and that name is found like any
  conflicted copy. `session.ts` holds the open workspace: polls the open scene's file
  every 2.5 s (paused when hidden), checks every file when the window is focused,
  reloads what changed outside, finds conflicted copies (Dropbox, Nextcloud, Syncthing,
  Aurelia's own) and reconciles them — the file not kept goes to `.aurelia/conflicts/`,
  never deleted. A workspace with any file of a newer `schemaVersion` opens read-only
  through `guardWrites`, which refuses every write at the adapter. Files that cannot be
  read, and two files with one ID, are shown by path and never written. Scene bodies are
  edited as plain Markdown; only the body changes — the head (frontmatter, comments, key
  order, line endings) is written back byte for byte, and `words` is counted from the
  text, never stored. "New scene" (button and palette) adds a scene with a fractional
  `order`. `navigator.storage.persist()` is asked on the first save of a browser
  workspace and the answer is shown; a one-time install tip; "Download a copy (.zip)"
  (stored zip, `zip.ts`, no dependency) for every real workspace. New dependency: `yaml`
  (ISC) and `fake-indexeddb` (dev). Tests: the adapter contract (`contract.ts`) runs on
  the memory adapter, on `HandleAdapter` over a fake directory handle in Vitest, and in
  Chromium on OPFS and on an OPFS handle standing in for a folder (through a hook that
  exists only in `vite build --mode e2e`; a test fails if the production build has it).
  Left for later: a scene's title and details cannot be edited yet (M3/M4); `OUTLINE.md`
  and `book.json`'s outline cache are not rewritten when a scene is added (the
  scene files win); a folder picked in a browser that has `showDirectoryPicker` cannot be
  clicked in Playwright, so the folder flow is tested with a fake handle, and has not
  been tried by hand in Edge or on a synced folder; the recovery journal is not shown to
  the author beyond the notes and banners.
- **Review fixes (2026-11-12).** A workspace read that a save finished during is read
  again, never shown (`SavePipeline.writes`). One tab writes a workspace: the first holds
  a Web Lock (`aurelia-workspace:<id>`), a second opens read-only and takes over, re-reading
  the files, when the first lets go. Compare-and-write is read-then-write, not atomic
  (AGENTS.md says so). Errors reach the screen only through `wordsFor` (`errors.ts`).

**M2b · Backup and versions** ([ADR-0009](docs/adr/0009-browser-storage-and-backup.md))
- `RemoteStore` interface; adapters for **Google Drive** (`drive.file`), **OneDrive**
  (`Files.ReadWrite.AppFolder`) and **WebDAV / Nextcloud** (app password; CORS set up
  once with the WebAppPassword app). OAuth 2.0 + PKCE in the browser, no Aurelia server.
  Dropbox next.
- **Your own server** (ADR-0009 amendment): a WebDAV storage container on the self-hosted
  server writes into a mounted volume (a TrueNAS dataset). The app's nginx sends `/dav/`
  to it, so it is on the same address (no CORS) and behind Cloudflare Access. It refuses
  any request without a valid Access token, because the server's port is open on the
  home network. TrueNAS app file and guide updated.
- Uploads changed files a minute after typing stops and when the tab is hidden; a
  version zip every hour of writing and before risky steps, with retention (hourly 2
  days, daily 30 days, weekly 6 months, monthly for ever).
- `backup.json` manifest with hashes and revision: a backup written by another device is
  never overwritten — the author chooses "Keep both" or "Use the backup here".
- Restore from the Welcome screen (provider → workspace → version), checked against the
  hashes. "Download a backup (.zip)" always available; "Only in this browser" shown
  until a backup exists.
- Offered to real-folder users too (versions help everyone).
- **Built so far (browser half, 2026-11-12): "Your server" only.** `RemoteStore` +
  `WebDavStore` (`src/storage/remote/`, same-origin `/dav/`, `connect-src 'self'`); the
  backup engine (`src/backup/`): uploads changed files a minute after typing stops and when
  the tab is hidden, `backup.json` claimed with compare-and-write before any file goes up
  (a 412 or a foreign device means stop and ask: *Keep both* / *Use the backup here*),
  hourly versions and before the conflict choices with the retention function, what still
  has to go kept in the device database (IndexedDB v2), retries with a wait, "sign in
  again" on 401. Restore from Welcome and from the Backup screen always makes a NEW local
  copy (a new workspace ID when this device already has that one), every file checked
  against the manifest (versions: against the zip's CRC-32). Left: Google Drive, OneDrive,
  Nextcloud, Dropbox; restoring over an open workspace; the "storage empty but remembered"
  marker; the real storage container is not run by the end-to-end tests (an in-test WebDAV
  follows its contract).
- Exit: clear all site data, then restore — every file matches its hash; two browsers
  backing up one workspace never overwrite each other; an expired token keeps changes
  queued and shows "Reconnect"; a WebDAV server without CORS gives a clear setup
  message; the storage container refuses a request with no Access token, a wrong AUD tag
  or an expired token (tests).

**M3 · Domain, links and search**
- All entity types load and save. Stable IDs. YAML edited through the `yaml` Document
  API (comments and key order kept, strings quoted on write).
- Self-describing outline: each scene holds `chapter` and a fractional `order`;
  `book.json` is a cache and scene frontmatter wins. On open, files not in the outline
  go to an "Unfiled" group. A derived read-only `OUTLINE.md` is written per book.
- Duplicate IDs are shown as a conflict (both kept, merge offered), never picked.
- Schema migrations (ADR-0003 rule 5): an app never writes a file with a higher
  `schemaVersion` (read-only mode + "Update Aurelia" banner); backups go to
  `.aurelia/backups/<fromVersion>/`; one all-or-nothing pass with a marker file, so a
  half-migrated folder is detected.
- `[[Name]]` and `[[id:…]]` links; a picker when two records share a name.
- **Names found automatically** ([ADR-0010](docs/adr/0010-name-mentions.md)): records get
  `aliases` (auto / ask / never); the index finds tagged mentions and suggestions in every
  scene (whole words, capitals, possessives, longest match, book + universe scope);
  `ignoreNames` on scenes. Presence and backlinks use tagged mentions.
- Backlinks ("Linked from"), "Links to", global search (MiniSearch).
- **M3a built (2026-11-12, branch `feat/m3a-outline-records`): the domain write layer, outline
  editing, and characters and places.** Links, backlinks, search, names found in the text and
  schema migrations are the next wave (M3b).
  *Write layer:* `patchFrontmatter` (`storage/yaml-edit.ts`) reads the YAML with the `yaml`
  Document API only to find where a key sits and rewrites just that place, so comments, spacing,
  key order, unknown keys, line endings and the body stay byte for byte (a patch that changes
  nothing returns the same text; strings are quoted on write); `setTopLevel` / `removeTopLevel`
  do the same for `book.json` and `aurelia.json` (`storage/json-edit.ts`, which `rename` now
  shares). Every entity — universe, book, part, chapter, scene, record — loads and saves
  through the session (`write`, `create`, `setFields`): text that does not read as its kind is
  refused before it is journaled or written. Several-file actions run one at a time
  (`session.exclusive`) and the focus/poll checks wait for them. *Outline:* add a book (in a
  shared universe or on its own), part, chapter (with an empty first scene) and scene; rename;
  delete = move to `.aurelia/trash/<stamp>/<path>` with a `manifest.json` written first (copy,
  check, then remove, via `moveFile`; Undo toast and a "Recently deleted" list; a place that has
  been taken is never written over); reorder by drag-and-drop or by keyboard (Alt+↑/↓, F2 renames,
  Del deletes, the context-menu key opens a row's menu, "Move to chapter…") with fractional
  keys (`keyBetween`) so a move changes ONE file (the moved item's own `order`/`chapter`/`part`);
  `book.json`'s outline cache and `OUTLINE.md` (now also written when a workspace is created)
  are derived after every structural change and never read as the truth (a stale cache loses to
  the scene files). Files not in the outline show under **Unfiled** (a scene whose chapter is
  gone; "Move to chapter…" files it). A book or universe on disk that no list names is adopted
  in memory, never hidden. Two files with one ID are shown (banner, Files dialog) with "Keep
  this one"; the other goes to `.aurelia/conflicts/`. *Crash order:* content files first, the
  line that lists them (universe `books`, `aurelia.json`) and the cache last; a stop at any step
  leaves a state the app shows (tests stop every write and removal of every action and reopen).
  *Inspector:* title, status, summary and (for scenes) point of view for scene, chapter, part
  and book — additive optional schema fields, so no migration. *World:* records by type with
  create / rename / delete (to the trash) / find by name, scoped to the universe or to one book;
  the record sheet (Profile of `Character.dc.html`): name, summary, the type's basic fields,
  other names with auto / ask / never (the field only; finding mentions is M3b), plain-text
  notes. Left for later: the rich notes editor (other branch), the Progression tab, linked-from,
  promoting a record between scopes, deleting a book's universe-level records with it,
  migrations (rule 5), and making a shared universe from the UI (no screen does yet; adding a book to one is tested).
  *Review fixes:* words typed while a delete moves the files go into the trashed copy (the pipeline
  holds the old paths meanwhile); a chapter or scene is not restored while its book is still in the
  trash, and a scene whose book is missing is reported; an `&anchor` is never rewritten; an empty
  YAML value is set properly; when no order key fits between two neighbours they get fresh keys
  (placement is always what was asked); `OUTLINE.md` and the outline cache in `book.json` are
  derived and never raise a conflict; alias keys this version does not know are kept. Moves are
  announced to a screen reader, Backspace and ⌘⌫ delete, Undo takes focus after a keyboard delete
  (Esc dismisses, Ctrl/⌘+Z undoes), and the inspector is absent on views that have none.
  *Backup:* the trash and `.aurelia/conflicts/` are backed up like every other file (the engine
  uploads everything the adapter lists), so a deleted chapter survives on the server and comes
  back with a restore; a test pins it.
- **M3b built (2026-11-16, branch `feat/m3b-links-names`): links, backlinks, search and names
  found automatically** (the editor parts of M4 that needed M3 are in the same branch).
  *Index* (`src/index/`, plain TS, derived and never stored): `links.ts` reads `[[Name]]`,
  `[[Name|label]]`, `[[id:…]]`, `![[…]]` (not in code, not behind a backslash); `names.ts` is the
  ADR-0010 detector, a pure function of text + names + answers (whole words, the author's
  capitals, possessives, longest name first, shared / ask / never, sentence-start words that are
  also names, nothing inside links, code, addresses); `workspace-index.ts` resolves names, aliases
  and IDs from a book, then its universe (a book's own record wins over a shared one with the same
  name; two at one step are *ambiguous*, an ID never is), and derives backlinks, "Links to",
  found names, open questions and what a record is called across the workspace. `sync(data)` is
  incremental: a keystroke re-reads only that file (objects compared by reference), and a name,
  title, summary or alias change bumps one version so everything derived from names is worked out
  again. Search is MiniSearch (MIT, ~6 kB gz) over titles, other names, summaries, scenes and notes,
  added to the search index only when a search first asks. Measured (`PERF_REPORT=1 npx vitest run
  src/index/perf.test.ts`, Node + happy-dom): 100 scenes / 150k words sync in ~1 ms, every name and
  link found and backlinks worked out in ~20 ms, a first search ~50 ms (index built), a keystroke
  with links and names drawn in a 20,000-word scene median ~5 ms, p95 ~7 ms.
  *Editor:* links, embeds and names are **decorations over the text, never part of it**, so
  ADR-0007's guarantees hold untouched (one new golden file, `links-and-names.md`, round-trips byte
  for byte). `[[` opens a picker (records and scenes, type shown, keyboard first); a name two
  things share writes `[[id:…|Name]]`, otherwise `[[Name]]`. A link draws blue (warn and dashed when
  it points nowhere or at two things); `![[…]]` draws a read-only card after its paragraph. A card
  opens on pointer rest and on the caret after a pause, never while typing (Escape closes, Alt+↓
  moves into it); Mod-click, or Enter inside a link, opens it. Names are plain until **Show names**
  (palette or the switch above the text) underlines them in their type's colour; a name Aurelia is
  not sure of gets a dashed underline and a "?" and a card ("Is this Will Ashby?", "Which one is
  Corin?") whose answers are *yes, it is this one* (writes `[[id:…|Will]]` at that one place) or
  *not a name* (scene `ignoreNames`, nothing in the text). Record notes use the same editor
  (links work; names are not looked for in notes). Inspector tabs **Names** and **Links**; the
  record sheet shows "Found in your writing" and "Links". The palette gains "In your writing"
  (the line around each match). **Rename everywhere** (after renaming a record whose old name is
  written somewhere): each form and what it becomes (changed words carry through "Elena" →
  "Helena"; "Lena" is kept), every place with its sentence, uncertain ones (a title in quotes, a name
  another record shares, a name set to ask, an ordinary word) unticked, then one step: a version is
  saved first when backup is on (said only if it truly reached the server), and a copy of every
  changed file always goes to `.aurelia/safety/<stamp>/`, the files are written through the session
  (compare-and-write), a refusal stops the run and says how far it got, and one Undo puts every
  file and the other names back (a file typed in since is left and named). Nothing is written on
  open or on looking.
  *Decisions the spec left open:* a "not a name" key is `Will:2` (the second "Will" in the scene,
  counting the word wherever it stands, so the editor and the index number the same places and an
  accept never shifts an answer) — never a `^blk-` ID, since an answer is not a reason to write into
  the manuscript; an answer hides only a question, never a real name; a link to a name that exists in
  a book and in the universe resolves to the book's; a scene is found by its title after records;
  Enter in a link is always a new paragraph and Mod+Enter (or Mod-click) opens it; a link by ID shows
  only its label (the address is drawn as nothing and the caret steps over it); an embed shows its
  card, and its line only under the caret; a title Markdown would read is linked by ID.
  *Left:* "find new names" (M6), "state at this scene" on the card (M5), a toolbar button for
  `[[`, "Someone or somewhere else…" on a suggestion, names inside record notes, `[[Name|label]]`
  typed through the picker, a virtual list for very many rename places (it shows 150, then more).
- Exit: rename or move a record and no link breaks; a shared character resolves from
  two books in one universe; an unchanged file round-trips byte-identical (golden test);
  a half-migrated folder and a duplicate ID are both detected (tests).

**M4 · Manuscript editor**
- Spike first: pick the Markdown converter (`@tiptap/markdown` or
  `prosemirror-markdown`). Record it in ADR-0007.
- Rich editing with Markdown typing and a toolbar.
- Headings, marks (including `<u>` as one dedicated mark), lists, checklists, quotes,
  callouts, scene breaks, wiki links with autocomplete, entity embed cards, stable block
  IDs. Every other raw HTML is kept as escaped text and never rendered (test).
- Tables, footnotes and the Markdown source-mode toggle moved to M5 (v0.2) and are **done there**
  (see M5). Until then, tables and footnotes in a file were kept as raw Markdown, never dropped.
- Focus mode; editor font, size, line height, paragraph spacing.
- Live word counts (scene, chapter, book, session).
- **Names in the editor** (ADR-0010): hover or focus a name for its card; suggestions
  with a faint dashed underline ("Is this Will Ashby?" → writes an explicit link, or
  "Not a name"); "Show names" highlight. **Rename everywhere**: name-form mapping, a
  preview of every place (uncertain ones not ticked), a version saved first, one undo.
  Test: renaming "Elena" never touches "Elenath" or "elena@example.com".
- Exit: golden-file round-trip tests for every dialect feature M4 edits, plus tests that
  tables and footnotes survive as raw text; a 150k-word book stays fast.
- **Done (2026-11-12), the editor itself.** `src/editor/`: Tiptap 3 on `marked`
  (ADR-0007, measured), with the dialect's own nodes (callout, scene break, raw block for
  what is not edited yet, `verbatim` text, one `<u>` mark). Each block remembers the
  Markdown it was read from, so opening writes nothing and an edit rewrites only its own
  block (golden files in `tests/golden/`, a fuzz of typed text, byte-identical for every
  file). Toolbar per `Main` (Reka toolbar: roving focus, pressed states, a short bar along
  the bottom on a phone), Markdown typing, a link box, focus mode (F11, Escape, palette),
  editor settings per device (font, size, line height, paragraph spacing), a "this
  session" word count beside scene, chapter and book. The sample opens in the same editor,
  read-only. Saves still go through `session.editScene`; an outside change replaces the
  text in place and keeps the caret, and cannot be undone into the old text. Measured:
  150k words into the model in ~50 ms, a keystroke in a 20,000-word scene ~3 ms.
  **M4 part 2 is built with M3b** (above): wiki-link autocomplete, entity embed cards, names in
  the editor and Rename everywhere. Still left: stable block IDs as attributes (`^blk-…` is kept as
  text), editing a callout's title (shown and kept), and the Markdown source mode, tables and
  footnotes (M5).

**M4b · Sync through your server** ([ADR-0009 amendment](docs/adr/0009-browser-storage-and-backup.md)) — owner: "Yes, sync after editor"
- Two-way sync of a workspace between devices through a WebDAV target (your own server
  first; Nextcloud works the same way). Builds on `backup.json` hashes and revisions,
  written with compare-and-write.
- Pull on open and every few minutes; push changed files after saving.
- A file changed on two devices is never overwritten: both texts kept, shown as a
  conflict. A version is saved before remote changes are applied. Deletes are kept as
  markers; moves follow stable IDs.
- Status bar shows "Synced", "Syncing", "Offline — changes waiting" or "Conflict".
- Exit: random edit sequences on two and three devices, online and offline, never lose a
  word (property tests); a device back from a week offline gets every change and loses
  none of its own.
- **Built (2026-11-12, [ADR-0012](docs/adr/0012-sync.md)):** per-file base (server ETag + hash) in the
  device database; a round plans push / pull / compare / delete from three facts per file
  (`sync-plan.ts`, pure) and acts with `If-Match` / `If-None-Match` only (`sync.ts`); a conflict keeps
  the device's text in the file and the server's as `… (Aurelia copy <hash>).md` that reaches every
  device; deletes are tombstones in `backup.json` (`sync.devices` replaces the single-writer rule);
  remote changes are applied through the session (`applyRemote` → `pipeline.receive`: compare-and-write
  after any save in flight, unsaved edits become the M2 conflict); a `before-sync` version first;
  restore "…and keep it in sync" keeps the folder's workspace ID with each file's base from the restore's
  own reads. Status bar: Synced / Syncing… / Offline — changes waiting / Conflict — 1 scene has two
  versions. Property tests (random edits, creates, deletes, moves, offline periods, 2 and 3 devices)
  and two-browser end-to-end tests pass. Left: sync through Google Drive and OneDrive (M10), a
  three-way merge of texts (a conflict keeps both whole), the real storage container in the sync run.

### Release v0.2 "Plan" — shape the story

**M5 · Story planning and branching**
- Editor: tables, footnotes and the Markdown source-mode toggle (moved from M4), with
  golden round-trip tests. **Done (2026-11-16)**: see the progress log and
  [ADR-0007](docs/adr/0007-markdown-converter.md) (the part on tables, footnotes and the source).
- Outline: Parts → Chapters → Scenes, drag-and-drop, columns (POV, status, arc). **Done (M5a).**
- Inspector for Part / Chapter / Scene / Arc fields (spec table). **Done (M5a)**, except a chapter's checklist.
- Arcs as threads; "scenes advanced" across books. **Done (M5a).**
- Corkboard (index cards, colour by arc or status). **Done (M5a).**
- **Branching**: scene choices (label → target scene), Story map (node graph),
  Play mode (click through the story), checks for dead ends (scenes can be marked as
  endings), unreachable scenes, choices with no target and "no ending reachable from
  here". **Done (M5a)**, except the editor's "Choices" block at the end of a scene (ADR-0004 §5) and
  the export's "Choices" list (§10).
- **Continuity** ([ADR-0006](docs/adr/0006-continuity-model.md)): manual scene state
  changes (shown with plain labels, never the raw kind names), presence from `[[links]]`
  with author overrides, story time as a sortable key with granularity, calendars and
  flashbacks. `stateAt()` folds in **reading order**; in branching books it is a
  fixed-point dataflow over the scene graph, and findings say "on every path" or "on
  some paths". Dismissed findings are stored by fingerprint in `book.json`. **Done (M5b)**,
  except BCE years and the "Age and dates" check ("Mark as change" is a shortcut and palette command,
  not a toolbar button).
- Continuity view: presence map, arc lanes, POV balance, story time vs reading order,
  pacing, and the checks list (dead-then-alive, two places at once, time order, item in
  two hands, setup without payoff, silent arc, long absence, broken links). Severities
  are Error / Warning / Note. **Done (M5b)**, for one book; "Whole universe" built in M6b.
- Exit: plan and reorder a book without leaving the workspace; write and play a
  branching story start to end; every check in ADR-0006 has a test that finds it and a
  test that does not raise it on a clean story; a test with a flashback that reveals an
  earlier death raises no finding on the earlier scenes; a test book with a loop and a
  hub gives the right "every path / some paths" answers.

### Release v0.3 "World" — build the world

**M6 · Worldbuilding library**
- Character sheet (identity, inner life, voice, relationships with types, appearances)
  with a **Progression** view: state scene by scene in reading order, built from scene
  changes. *M6a built the sheet; the Progression view is built (M6b).*
- Worlds and places as a free hierarchy (planet → … → room, custom levels), sensory
  details, Earth as a root for history writing.
- Items, events, lore, research (with sources), factions, cultures, magic/tech systems.
- **Find new names** (ADR-0010): a Names panel lists recurring capitalised words that are
  not records yet, with "Create character / Create place / Not a name".
- Timeline with real dates (incl. BCE) and custom calendars (builds on the M5 outline
  columns). **Built (M6b)**, as a mode of the Continuity view.
- Media gallery (portraits, maps, reference images) stored in the project folder. The
  original file and extension are kept (no transcoding); thumbnails are a device-side
  cache.
- Exit: records link across books in one universe and show in backlinks and search.

**M6a · the World library (built)** — everything above except the Progression view and the
timeline.
- [x] Character sheet: Overview (who they are, inner life), Relationships (typed, listed on both
  sheets, kept on the record that listed it), Appearances (scenes by book, from the index), Voice.
- [x] Places and worlds as a tree of any depth: author's own level name (`kind`), sensory details,
  breadcrumbs, "Start from Earth", move by drag, Alt+↑/↓ (out / into the place above) and
  "Move to…"; no cycles, one key of one file per move.
- [x] Faction, culture, system, item, event, lore and research (title, author, address, note
  per source) made from the World view's New menu; their fields are searched.
- [x] Find new names (World › New names, and the Names tab): ≥ 3 times, not at a sentence start,
  not a record or any word of one; Create character / place; Not a name kept in `book.json`.
- [x] Media gallery: originals kept byte for byte (`media/med_….<ext>` + `med_….json` with
  caption and credit), thumbnails in the browser's private file system (never the folder), a
  portrait or picture on any record, delete to the trash with Undo; backup, restore and sync carry
  the files as bytes.
- Decisions: see ADR-0003, ADR-0009, ADR-0010 and ADR-0012 ("As built (M6a)").
- Later, not now: the gallery draws every image of the universe (two at a time); a window of tiles
  at a time (as the outline table does) when a universe holds hundreds.

### Release v0.4 "Protect and share"

**M7 · History and export**
- [x] **M7a · History (built)** ([ADR-0013](docs/adr/0013-snapshots.md)): snapshots per scene and per book
  (plain files in `.aurelia/snapshots/`, immutable, written last-file-last through the session), by hand
  and as "Before restore"; compare with the text now or with another snapshot, word by word, marked in
  words as well as colour; restore a scene or a whole book, which never deletes (a scene made since stays
  and is named; a scene deleted since comes back; a conflict, a duplicate ID or a file still saving is
  left as it is and named). History at the foot of the Scene and Book tabs; palette "Take snapshot of
  this scene / book". Snapshots are backed up (current/, manifest, versions) and synced like any file,
  tested. Left: removing a snapshot (it would go to the trash), snapshotting records.
- [x] Exit: exports are repeatable; import reports what it could not read; a branching
  export shows every choice (tests in M7b).

**M7b · Export and import (built)** — [ADR-0014](docs/adr/0014-export-and-import.md)
- [x] Export a book as a Markdown bundle (.zip), DOCX, EPUB 3 and PDF (a print view and the browser's
  "Save as PDF"; no PDF library). DOCX and EPUB are written by hand on the stored zip writer. Headings,
  emphasis, quotes, lists, tables, footnotes, scene breaks; links to records are plain names.
- [x] Export profiles: named, saved settings (format, title page, chapter and scene titles, scene
  separator, page size, font, size, spacing, language) in `.aurelia/export-profiles.json` (keeps unknown
  keys, has `schemaVersion`, never written over a file it cannot read).
- [x] Repeatable: the same book and profile give the same bytes in every format (fixed zip stamp read in
  UTC, fixed entry order, EPUB identifier from the book, fixed `dcterms:modified`); tested twice, in three
  time zones; golden files for the DOCX `document.xml` and the EPUB package and chapter.
- [x] A branching book exports in outline order with a "Choices" list (label → scene title) at the end of
  each scene, every choice shown (a choice to a scene that is gone says so); linked in the EPUB and PDF.
- [x] Import into a **new** book, never touching another: Markdown (several files, a folder, a zip from
  any tool read with `DecompressionStream`) and Twine (Twee 3, Twine 2 published HTML). Always a preview and
  a report of what could not be read and why; size limits in plain words; macros and variables stay as text
  and are named.
- [x] From the Export dialog (palette "Export this book…", the Book tab) and Import (palette "Import a
  book…", the Book tab, the Welcome screen: a new workspace that holds the book). Both themes, keyboard,
  390 px, axe clean.
- Left (not in M7b): Ink and Twine export; export of a
  chapter or a scene alone; a contents page, running heads and a cover in DOCX and PDF.

### Release v0.5 "Assist" → hardening → **v1.0**

**M8 · Assistant** ([ADR-0008](docs/adr/0008-ai-assistant.md)) — opt-in, the author's
own account
- **Built first (M8a, [ADR-0015](docs/adr/0015-assistant-on-your-server.md)):** the owner's own server
  runs Claude Code (installed at start by Anthropic's installer, never in Aurelia's image) for each person,
  each signed in with their own Claude account through Claude Code's own sign-in; read and propose tools
  over the synced copy; the Review inbox and the same cards inside the text; Accept with a snapshot first
  and a per-block 3-way merge; Ask for changes. Left for M8: ChatGPT, API keys, the Claude Desktop/MCP
  path, the scope picker and the "what will be sent" sheet, `propose_record`, and the open owner item on
  Anthropic's Commercial Terms (ADR-0015).
- **Story base and guided start (M8b, [ADR-0016](docs/adr/0016-story-base.md)):** each book has a story
  base (objectives, world and history, main narrative in `book.json`; main characters as Character
  records), edited by hand on the Book tab. "Set up the story base with the assistant" asks one short
  question at a time and proposes each area (`propose_story_base`, `propose_character`), reviewed like any
  suggestion; Claude reads `get_story_base` first on every question.
- One tool registry (read tools + propose tools, no direct writes) shared by the MCP
  server and the in-app agent.
- Review inbox: every AI proposal is a diff (inserted text highlighted) the author
  accepts, edits or rejects. There is no "accept all". A proposal stores `baseHash` and
  the block IDs it targets; Accept is a per-block 3-way merge and is refused when an
  anchored block is gone or changed. Accepting takes a snapshot first (needs M7).
- The domain, index and continuity layers run unchanged in Node (CI test). The MCP
  server rebuilds its index on start (a 150k-word book in under 5 seconds). The
  browser + `npx @aurelia/mcp` path works for real-folder workspaces only.
- One provider adapter shape for all three paths: stateless, function tools only,
  stream-first; only `response.completed` (or its equivalent) counts as success, and a
  stream that dies produces no proposal.
- Browser API keys are wrapped with a non-extractable WebCrypto key.
- **Use Aurelia from Claude**: local MCP server (`@aurelia/mcp`, Claude Desktop
  extension `.mcpb`, built into the desktop app).
- **Continue with ChatGPT** (desktop app): open-source Sign in with ChatGPT, loopback
  callback, plan usage via the Responses API, tokens in the OS keychain.
- **API key**: Anthropic, OpenAI, OpenAI-compatible (Ollama, LM Studio); works in the
  browser too.
- Assistant panel: scope picker, "what will be sent" preview, tool-call log, cost shown
  for API keys.
- Exit: a Claude Desktop user and a ChatGPT Plus user can each ask "check Tomas's
  continuity in chapter 7" and accept a fix; no path writes to the manuscript without an
  accepted proposal; an injected instruction inside a research note cannot do more than
  create a proposal in the in-app agent (test). The same injection test runs on the MCP
  path, where Claude Desktop's other tools are outside Aurelia's control: every tool
  result is wrapped as untrusted data, and a Claude project without web tools is
  recommended for sensitive work.

**v1.0 hardening**: accessibility pass, performance budget, crash recovery tests,
docs site, sample universe, signed desktop builds, first public release.

### After v1.0 (order to be confirmed with the owner)

- **M9 · Writing utilities**: project dictionary, offline spellcheck (nspell +
  Hunspell dictionaries, licence checked per language) and grammar (Harper, WASM) —
  **off by default**; repeated words, long sentences. Also templates and plot scaffolds,
  and the continuity check "knows before learning" (needs a tagged-mention syntax).
- **Imports from other tools**: investigate Scrivener, Ulysses, Campfire and World
  Anvil import.
- **M10 · More sync**: sync through Google Drive and OneDrive, an S3-compatible
  adapter, optional end-to-end encryption (libsodium: Argon2id + XChaCha20-Poly1305).
  WebDAV sync itself moved up to M4b.
- **M11 · Sharing and views**: beta-reader mode, comments, revision mode; graph view,
  maps.
- Branching extras: variables and conditions, Ink / Twine export.

## 5. Risks and open items

| # | Risk / open item | Plan |
|---|---|---|
| R1 | **Real-folder access works only in Chromium browsers.** Safari and Firefox do not support the File System Access API. | OPFS there, protected by cloud backup and versions (M2b, ADR-0009). The Tauri desktop app (before M8) gives real folders on every OS. |
| R2 | **WebDAV and S3 from a browser need CORS.** Nextcloud and most servers do not send CORS headers by default. | Nextcloud: one-time setup with the WebAppPassword app, with a guide in the Backup screen. Others: documented setup. The desktop app removes the limit. |
| R3 | Markdown round-trip of custom nodes (choices, embeds, callouts) can lose data. | Golden-file tests per node; unknown syntax is kept as raw text, never dropped. |
| R4 | **Browser storage can be wiped** (clearing site data, disk pressure, Safari's clean-up of unused sites). | Four layers (ADR-0009): persistent-storage request and "install as an app"; automatic cloud backup with versions; restore from the Welcome screen; manual zip download, with "Only in this browser" shown until a backup exists. |
| R11 | Cloud providers change APIs and token rules; browser tokens for Google expire fast. | One `RemoteStore` interface; changes stay queued while disconnected; "Reconnect" banner. Re-check provider docs before M2b. |
| R5 | Branching needs variables and conditions for real games. | v1 has choices + play mode. Variables come after v1 unless the owner moves them. |
| R6 | Trademark / domain checks for "Aurelia". | Owner to check before the first public release. |
| R7 | **AI provider rules change often** (Anthropic tightened subscription use in 2026; Sign in with ChatGPT is new and in preview). | Re-check ADR-0008's facts before M8 starts. API keys and local models stay as the fallback. |
| R8 | Signed desktop builds cost money and setup (Apple Developer ID, Windows code-signing certificate). | Budget before v1.0; unsigned dev builds until then. Ship as direct notarised downloads, not through the Mac App Store (ADR-0005). |
| R9 | A sync client can turn a move into delete + create, or write conflicted copies. | Duplicate-ID conflict flow, conflicted-copy detection and a rebuildable outline (M2, M3). |
| R10 | Sign in with ChatGPT is a preview and its contract can change. | ADR-0008 records the verified contract (2026-11-12). Re-check before M8. |
| R12 | **Sync can lose words** (two devices, offline edits, a stale device coming back). | Never overwrite: conflicts keep both texts; a version before every remote change; delete markers; property tests over random multi-device edit sequences (M4b). |
| R13 | The storage container is reachable on the home network, where Cloudflare Access does not apply. | It checks the Access token itself (team keys + AUD tag) and refuses everything else (M2b tests). ZFS snapshots of the dataset add a layer. |

## 6. Open decisions

None right now. (v0.1 storage scope was decided on 2026-11-12: the browser, with cloud
backup — ADR-0009.)

## 7. Progress log

- 2026-11-12 — Repo created. License, plan, ADRs 0001–0006, screen designs on the
  design canvas (https://claude.ai/artifact/3VYR9hu3XSczZj3FcXGQ7g). Owner priorities:
  design quality; branching in v1; continuity tracking is core. Next: owner design
  review, then M0.
- 2026-11-12 — AI assistant added (ADR-0008, M8). Two adversarial reviews
  (architecture, design) applied to the docs and the canvas; new designs for adding a
  change, editing choices, the review inbox, the "before you send" sheet, problem and
  empty states, and the phone.
- 2026-11-12 — Owner chose the browser for v0.1. Safari and Firefox books are protected
  by cloud backup (Google Drive, OneDrive, Nextcloud) and versions: ADR-0009, M2b.
- 2026-11-12 — M0 Foundations built: project scaffold, tokens and fonts, schema v1 and
  migrations, SPDX and licence checks, CI. Next: M1 app shell.
- 2026-11-12 — M1 App shell built: shell layout, resizable panels, command palette with
  recent and pinned items, Saltmarch sample, per-device state, narrow-screen sheets, PWA
  baseline, e2e with axe in both themes. Next: M2 local project storage.
- 2026-11-12 — Self-hosting: Docker image (nginx, non-root, read-only), GHCR publish
  workflow, TrueNAS custom app behind the owner's Cloudflare Tunnel + Access, and a
  "Sign in again" prompt when the Access session ends. Books never reach the server.
  See [`docs/self-hosting.md`](docs/self-hosting.md).
- 2026-11-12 — Owner decisions: the owner's own server (a mounted volume behind a storage
  container) becomes an M2b backup target, and two-way sync moves up to **M4b**, right
  after the editor (ADR-0009 amendment). Next: M2 local project storage.
- 2026-11-12 — M2 Local project storage built: folder and browser (OPFS) workspaces,
  compare-and-write saves with a recovery journal, conflict flow, external-change
  polling, conflicted copies, read-only for newer files, download a copy. Next: M2b
  backup and versions, then M3.
- 2026-11-12 — M2b browser half built: backup to the author's own server (`/dav/`),
  versions with retention, restore from Welcome and the Backup screen, status-bar chip
  and banners. Also: Welcome says the real reason on an http page (no file access).
  Next: wire the real storage container in the end-to-end run, then M3.
- 2026-11-12 — M2b review fixes (browser half). Data safety: a restore whose workspace ID
  this device still holds backup state for gets a new ID and starts with backup off (an
  old copy can no longer be backed over `current/`); a failed final `backup.json` write
  is found and closed by the next round (`claimOpen`); the engine waits for pending
  saves (`flush`) before reading files or building a version; a version before a big
  change is zipped before the 10 s race; a round re-reads stored state (a tab that took
  over); "Keep both" folders carry a device-ID suffix; "Use the backup here" does not
  prune the other device's versions; the device database says "close your other tabs"
  instead of hanging on an upgrade, and lets go when another tab upgrades; a change that
  arrives while a round is being refused no longer sets it off again. UX: no workspace
  ID on screen, Close is secondary, focus moves to each restore step's heading, one
  live region, gold is a border only, the status bar nudges "turn on backup" in warn
  where a server exists, one `persistedWords`, h3 sections.
- 2026-11-12 — Rename workspace (branch `feat/rename-workspace`): "Rename workspace…" in the
  workspace menu (status bar and top bar) and the command palette. Only the `name` in
  `aurelia.json` changes, byte for byte, through the save pipeline (journal, compare-and-write;
  an outside change is the conflict flow, which calls the file "Workspace settings"). The
  device's recent list follows once saved. The backup folder keeps its first name (it is found
  by ID); `backup.json` carries the current name (now optional, older manifests still load), and
  the Backup screen and restore list show it. One `checkWorkspaceName` for create and rename.
- 2026-11-12 — M4 Manuscript editor built (the part that does not need M3): Tiptap 3 with a
  measured Markdown converter (ADR-0007), byte-identical open and edit-only-the-block saves,
  toolbar, Markdown typing, focus mode, editor settings, live word counts. Next: M3, then
  the names, links and rename part of M4.
- 2026-11-12 — M3a (branch `feat/m3a-outline-records`): the domain write layer, outline editing
  (add, rename, delete to the trash with Undo and "Recently deleted", reorder by drag and by
  keyboard, Unfiled), duplicate-ID choice, the inspector's fields, and the World view with
  record sheets for characters, places and the other types. Parallel browser tests: set
  `E2E_PORT` (`E2E_PORT=4175 npm run e2e`). Next: M3b (links, backlinks, search, names).
- 2026-11-12 — M4b Sync through your server (branch `feat/m4b-sync`): two-way sync of a workspace
  between devices through the WebDAV target, per ADR-0012. The one engine has two modes (backup, sync);
  with sync on, the sync round replaces the plain upload and versions, retention, retries and "sign in
  again" are shared. Random-order property tests prove: no saved word is lost, devices converge,
  a deleted file does not silently return, nothing reaches `current/` without a precondition.
- 2026-11-16 — M5a Story planning and branching (branch `feat/m5a-plan-branching`): the Plan view
  (outline table: parts, chapters, scenes with point of view, status, arcs and words, edited in
  place, reordered by drag and by keyboard with the same one-file moves as the navigator, drawn
  a window of rows at a time; and a corkboard of index cards in chapter columns, coloured by arc
  or status, paged by chapter range), the inspector's fields for a scene (point of view, place,
  objective, conflict, outcome, word target, arcs, ending, choices), chapter (objective, target,
  arcs), part and arc (colour, description, and the scenes that advance it across the universe's
  books), and branching per ADR-0004: choices edited in the inspector (a new scene can be made in
  the same step), the story map (own layered layout, with a gap for every choice that crosses rows,
  pan, zoom, arrow keys), the four checks as Error / Warning words with "Mark intended" stored by
  fingerprint in `book.json`, and read-only Play mode. A book's mode is switched on its Book tab.
  The sample's Salt & Ash now has 11 scenes, 15 choices and 3 endings, and shows two warnings.
  Left: continuity and story time (M5b, below), the "Choices" block in the editor and in exports, a
  chapter checklist. (The editor's tables and footnotes are done: see their own entry.)
- 2026-11-16 — M3b Links, backlinks, search and names found automatically (branch
  `feat/m3b-links-names`): the index (`src/index/`), `[[`/embed/hover-card/names in the editor as
  decorations over unchanged Markdown, the Names and Links tabs, search in the palette, and Rename
  everywhere with a preview, a version or a safety copy first, compare-and-write per file and one
  Undo. Parallel browser tests: `E2E_PORT=4177 npm run e2e`.
- 2026-11-16 — M6a The World library (branch `feat/m6a-world`): character sheet with tabs, places
  as a free hierarchy with Earth, the other record types, Find new names, and the media gallery.
  Storage learned bytes: `StorageAdapter.writeBytes`, binary-safe moves to the trash, restore and
  sync of images (never read as text, never rewritten). Left for M6b (needs Continuity): the
  character Progression view and the timeline with real dates and calendars.
- 2026-11-16 — M5b Continuity (branch `feat/m5b-continuity`): per ADR-0006. A scene records changes
  from the inspector's "Add" board (who, what happens, the details, in plain words; a relationship
  shows what it was as of the scene) and a story time (a calendar of the universe, a key to the
  minute, an end, a label, and in order / flashback / flash-forward). `stateAt()` folds the changes in
  reading order; a branching book runs a fixed point over the scene graph with one set of values per
  fact, so findings say "on every path" or "on some paths" (tests: a loop and a hub, a flashback that
  reveals an earlier death raising nothing before it). Presence is the tagged names and links of the
  index, the point of view and `characters.add`, less `characters.remove` (those are "Mentioned").
  Eight checks plus the story map's, each a pure function with a test that finds it and one that
  does not raise it on a clean story; "Mark intended" keeps the fingerprint in `book.json` (a list
  drops only the stale marks it owns). The Continuity view: presence map and arc lanes as real
  tables (a stretch of 24 chapters, sticky headers, rows drawn a window at a time, "Table view"),
  story time against reading order, POV balance, pacing and the findings list; 120 chapters and 200
  characters read and drawn in ~15 ms (the view mounts in ~0.2 s). The inspector shows the state at
  the scene and the findings about it; a character's link card shows their state at the scene.
  Left for the next wave: "Whole universe" scope and "Shows on X's progression" (with the M6 sheet),
  a toolbar button for "Mark as change" (the editor toolbar belongs to the tables worker), BCE years,
  "Age and dates" (needs the M6 sheet fields),
  "Knows before learning", "Whole universe" scope, the Progression view (M6).
- 2026-11-16 — M5 editor: tables, footnotes and the Markdown source mode (branch
  `feat/editor-tables-footnotes`). **Tables** (GFM; `@tiptap/extension-table`, MIT) are real tables:
  Tab and Shift+Tab between cells (Tab in the last cell adds a row), Enter goes down a row, a
  "Table" button (Mod+Alt+T) and, while the caret is in one, a Table menu in the bar (add row above or
  below, add column before or after, align a column left, centre or right, delete row, column or
  table). An untouched table is written back byte for byte in whatever form it had; a changed one is
  written tidy (padded columns, `:--` `:-:` `--:` from the alignment, `\|` in a cell). A table with a
  row of more cells than its header is still kept as written, since `marked` would drop the extra
  cells. **Footnotes**: `[^1]` is a reference node and `[^1]: …` a note (several lines, paragraphs,
  lists, several to a paragraph); a "Footnote" button (Mod+Alt+F) puts a reference at the caret and an
  empty note after the last one with the caret in it; the number drawn is the reference's place, the
  words of the note show over it on hover or when the caret has stepped onto it; the file's labels are
  never renamed unless "Renumber footnotes" is pressed. **Source mode**: a "Markdown source" switch
  above the text for the open scene opens the body (not the details at the top) in a plain monospace
  area; what is typed is what is saved; switching either way writes nothing. ADR-0007 has the
  decisions. The property test now generates tables and footnotes (a note read alone must read as
  the same note; footnote labels are kept out of `marked`'s link-definition table); 120,000 files
  (40 seeds × 3,000) find one odd case in 20,000, all in corners the editor met before as well (8 on
  the same files). Rename everywhere now reaches names in table cells and notes. Paste of an HTML
  table makes a table (cells flattened to one line). Parallel browser tests:
  `E2E_PORT=4180 npm run e2e`. Left: a note's caret-to-reference jump (the note is at the end of the
  text, reached with the arrows), tables and footnotes inside quotes and lists (kept as written).
- 2026-11-17 — M6b Progression and the Timeline (branch `feat/m6b-progression-timeline`): the character
  sheet's Progression tab (chapter table, scrubber, state at a scene, change log), the Continuity view's
  "This book / Whole universe" scope and a Timeline mode (calendars, eras, BCE, zoom, flashbacks, events,
  keyboard, table view), "Shows on X's progression" in the add-change board, birth dates and the Age and
  dates check, BCE in the story-time picker. See ADR-0006 "Built in M6b".
- 2026-11-17 — M7a History (branch `feat/m7a-history`): per ADR-0013. A snapshot of a scene or a book is a
  folder `.aurelia/snapshots/snp_…/` with `snapshot.json` (written last) and the files byte for byte; one
  function (`takeSnapshot`) for the author's button, the palette and the "Before restore" that every
  restore takes first (M8's Accept will call the same one). Restore puts back writing only, never deletes,
  names what it kept, brought back or left, and refuses to write over a conflict. Compare is a word diff of
  our own (`domain/word-diff.ts`, no dependency) drawn like the Review inbox, with "[Removed: …]" and
  "[Added: …]" for a screen reader. Snapshots go into backup and versions and sync as ordinary files
  (tests on both). Also: the Progression state card shows "Not yet: …" facts learned later in the story
  (ADR-0006). Left: removing a snapshot.
- 2026-11-17 — M7b Export and import (branch `feat/m7b-export-import`): "Export this book…" (palette, Book
  tab): Markdown bundle, Word, EPUB 3 and PDF (print view), with saved export profiles; "Import a book…"
  (palette, Book tab) and "Import a book" on the Welcome screen: Markdown files, a folder or a
  zip, Twee and Twine 2 HTML into a new book, with a preview and a report. Repeatable bytes, a Choices list
  for a branching book, zips read with `DecompressionStream`. See ADR-0014.
- 2026-11-17 — Delete a workspace (branch `feat/delete-workspace`): each Recent row on the Welcome screen has a
  trash button beside Open. A browser workspace is deleted after a confirm that shows books, words and when it
  was last opened, offers "Download a copy first" and says a backup on the server is kept. A folder workspace
  is only taken off the list: the folder and its files are never touched. `storage/delete-workspace.ts`
  refuses while another tab holds the workspace's Web Lock or this tab holds unsaved work, then removes the
  OPFS directory first and, only after that works, the journal rows, backup state and list entry of that key.
- 2026-11-18 — M8a The assistant on your own server (branch `feat/m8-agent`, ADR-0015): a third container,
  `aurelia-agent`, runs the unmodified Claude Code program (`claude -p`, no built-in tools, only Aurelia's
  MCP tools, no settings, nothing kept) for each person with their own Claude account, signed in through
  Claude Code's own `claude auth login` relayed from the Assistant tab, in a folder of their own (by a hash
  of their Cloudflare email). The Agent SDK is not used: its licence is not open source (ADR-0005). Tools read
  the synced copy through the store as the asker, with the app's own loader, index and continuity code in
  plain Node; `propose_edit` and `propose_scene` write `.aurelia/proposals/prp_….json` only. The Review
  inbox and in-text cards: Accept (snapshot first, per-block 3-way merge, refused when the text changed),
  Reject, Ask for changes (the revision replaces the old one). Also: the store's login check returns the
  token's claims, and a few classes in src/ lost TypeScript parameter properties so Node can strip their types.
- 2026-11-18 — M8b Story base and guided start (branch `feat/m8-guided-start`, ADR-0016): `storyBase` in
  `book.json` (objectives, world, narrative; no migration), a "Story base" section on the Book tab that
  lists the world's characters, and "Set up the story base with the assistant" (Assistant tab before the first
  message, and the Book tab once the book is synced). New tools: `get_story_base` (read first on every
  question, fenced), `propose_story_base` (each section with the text it replaces; Accept refused when one
  changed, a book snapshot first when it replaces the author's text) and `propose_character` (a new
  Character record; refused for a name the world has, so a second Accept makes none). Restoring a book
  snapshot now puts the story base back as the snapshot holds it. Review fixes: writes keep unknown and
  non-text keys of `storyBase`; a save is refused when another device changed that section meanwhile; no
  length cap on a section's `before`; a character whose name the world has shows as out of date; wider
  fence matching; no guided start with no book open. Second round: a save that could not finish yet is not
  taken for another device's change; a non-text section reads as its JSON (a suggestion over it takes a
  snapshot); an emptied base stays `{}`; a restore compares bases whatever their key order; the
  character card says why it is out of date.
- 2026-11-18 — Suggested record deletes (branch `feat/m8-delete-record`, ADR-0016; owner: "I want the agent
  to be able to delete records when needed"): `propose_delete_record` writes a `delete-record` proposal (a
  record's ID, type, title and a fingerprint of its details and notes). The card says what goes, why, that
  Accept moves it to Recently deleted, and how many scenes and records link to it. Accept moves it there
  through `deleteItem`, only while the record still reads as it did (checked inside the delete's turn);
  otherwise the card is out of date and Accept refuses. Never a scene, chapter, part or book.
- 2026-11-18 — Short forms of a character's name (branch `feat/names-short-forms`, ADR-0010
  amendment; owner: "Archie for Archibald, Tommy for Tommy Kent", automatic): a character is also
  found by the nickname in quotes, the first name and the last name of its title (never a rank, a
  particle, a suffix or an initial). A record's own title or alias wins; a form two characters share,
  or an ordinary word, is asked about; an alias with `never` turns one off. Worked out with the names
  of a scope, never stored; Rename everywhere is unchanged. The character's page lists them ("Also
  found as") with "Stop finding …", which writes a `never` alias.
- 2026-11-20 — Find and replace in the whole book (branch `feat/find-replace`): "Find and replace in
  this book…" in the palette and ⌘⇧H / Ctrl+Shift+H. Find, Replace with, Match case, Whole words only
  (a Unicode letter, mark or digit is part of a word); plain text, never a pattern. Only the scene text
  of the open book: never titles, record notes, the details at the top or snapshots, and never inside a
  `[[link]]`, code, raw HTML, a link definition, an address or a note label — those are counted ("3
  inside links, not changed"). Every match is listed by scene (number and title) with the words around
  it, each can be unticked; with Match case off the replacement keeps the match's ALL CAPS or capital
  first letter. It goes through the rename writer, now shared: the open scene's words are saved, a
  version, a "Before replace" snapshot of the book (in History), a copy of each file, a compare before
  each write, a stop that says how far it got, and one Undo in the toast ("Replaced 12 places in 5
  scenes."). Also: an indented code block and a link definition are now kept as written by Rename
  everywhere too. Review fixes: Find matches the text as it reads (an escaped `a\*b`, never a `*` mark)
  and needs a letter or digit; the list is frozen while open (found again after typing pauses, or after a
  refused run, which says the ticks were reset); a Markdown link's target and title and a reference
  label are never changed, by either feature; a replacement at a line's start cannot make a heading or a
  list, nor an entity; whole words go through `don't` but not `’s`, and do not apply to Chinese,
  Japanese or Thai. Second review: Find also matches punctuation the editor escaped at a line's start
  (`1984\.`, `\- Hello`, `\# Chapter`) and text right after an escaped backslash (`C:\\Elena`); a
  replacement cannot start a heading or a list inside a list item or a quote; an escaped `\](` in plain
  text is not a link target (Rename everywhere too); whole words match `Elena'll`, `’d`, `'ve`, `'re`, `'m`.
- 2026-11-20 — Word goals and days in a row (branch `feat/word-goals`): one daily goal for the workspace
  and a goal for each book (`book.json` `targets.words`, set on the Book tab's "Word goal" field or in the
  popover). `.aurelia/writing-log.json` (schemaVersion 1, unknown keys kept) holds `dailyGoal` and, for each
  local date, that day's `goal` and each book's `{ words, at }` when first seen that day. Words today = books'
  words now less today's starts; a past day runs to the next recorded day's starts; a book first seen today
  (new or imported) starts at its total, so an import is not writing; never below 0. Days in a row count back
  from today (today once its goal is met), each day against the goal it was recorded with, no goal = any words.
  Written only when a start is recorded or the goal changes, through `writeDerived` on the disk's own text, so
  two devices merge to the earliest `at` per day and book; a newer or unreadable file is never written (goals
  then work for the visit and the popover says why). The status bar shows "320 / 500 words today"; it opens
  today's bar, the streak, the book's bar and the two fields; palette "Set word goals…"; one toast a day
  ("You reached today's goal."), never when opening the app. No notifications. Known and accepted: two devices
  that each write their first start of a day before sync meets leave one file and a conflict copy the app
  ignores, so one start can be lost. Review fixes: the log stays loaded while typing (it was re-read on every
  keystroke); starts are taken inside the session's turn, so an import or a restore is not counted as writing;
  the log is kept in the shell, so focus mode and midnight still count; recorded days later than today are
  ignored; goals read digits only ("90.000", "1e5" are refused); a typed goal is kept when the popover closes;
  the toast fires only when typing takes the words past the goal, once a day per workspace. Second review: a
  reconnected folder reads the log again and writes to it again (a write that failed while it was away left the
  goals in memory for the rest of the visit); the toast also needs words typed here, so a restored version, a
  sync or an outside change never fires it.
- 2026-11-20 — Read aloud (branch `feat/read-aloud`; owner: "the app reads the open scene aloud, so the author
  hears clumsy lines"): the browser's `speechSynthesis`, no package. Only voices with `localService` are listed
  or used (a network voice, like Chrome's "Google …" ones, sends the text away), and every utterance sets its
  voice, because one with none speaks with the browser's default, which may be a network one. With no local
  voice it says so and reads nothing; where `speechSynthesis` does not exist the toolbar button, the palette
  entry and the settings are not drawn. It reads from the paragraph with the caret
  (the whole paragraph, or the selection's first) to the end of the scene, one utterance per paragraph, all queued at once, as a reader sees it: a link says its
  words (never an ID or a target), no Markdown marks, and footnote markers, notes, tables and code are left out.
  The paragraph being read is a `reading-now` decoration (`src/editor/reading.ts`) scrolled gently into view:
  the document is not touched, so the scene is not edited and nothing saves. A small control shows Pause or
  Resume and Stop. Esc, typing, leaving the scene and closing the page stop it. Settings, per device: the voice
  (default a local voice for the browser's language, since a book has no language yet) and the speed, 0.8 to
  1.5. ⌘⌥R / Ctrl+Alt+R and the palette's "Read this scene aloud" start and stop it.
  Review fixes: a reading that was paused is resumed after a stop and before the next start (Chrome stays paused
  after a cancel, so the next reading was silent); text kept as written (inline code, images, bare links) is not
  spoken; the voice list is read again when reading starts; Esc that a dialog or the palette handled does not stop
  it; the control returns focus to the text when reading ends under it, and its status line is a live region that
  stays on the page; the tooltip and the palette say "from this paragraph". Second review: a link with a title and
  a reference link (also kept as written) say their words, never the address; only inline code, images, HTML
  tags and links that show just an address stay silent. Third review: such a link's words are said without their
  Markdown marks, every link in kept text that runs together is read, and the read-aloud bar rises above a toast.
  The link skip zones of Find and Rename everywhere now treat `\\](` (an escaped backslash) as a real link.
