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
| Editor | Tiptap 3 (ProseMirror), open-source extensions only. Markdown converter picked in the M4 spike (ADR-0007) | [ADR-0001](docs/adr/0001-frontend-stack.md) |
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
- Tables, footnotes and the Markdown source-mode toggle move to M5 (v0.2). Until then,
  tables and footnotes in a file are kept as raw Markdown, never dropped.
- Focus mode; editor font, size, line height, paragraph spacing.
- Live word counts (scene, chapter, book, session).
- **Names in the editor** (ADR-0010): hover or focus a name for its card; suggestions
  with a faint dashed underline ("Is this Will Ashby?" → writes an explicit link, or
  "Not a name"); "Show names" highlight. **Rename everywhere**: name-form mapping, a
  preview of every place (uncertain ones not ticked), a version saved first, one undo.
  Test: renaming "Elena" never touches "Elenath" or "elena@example.com".
- Exit: golden-file round-trip tests for every dialect feature M4 edits, plus tests that
  tables and footnotes survive as raw text; a 150k-word book stays fast.

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

### Release v0.2 "Plan" — shape the story

**M5 · Story planning and branching**
- Editor: tables, footnotes and the Markdown source-mode toggle (moved from M4), with
  golden round-trip tests.
- Outline: Parts → Chapters → Scenes, drag-and-drop, columns (POV, status, arc).
- Inspector for Part / Chapter / Scene / Arc fields (spec table).
- Arcs as threads; "scenes advanced" across books.
- Corkboard (index cards, colour by arc or status).
- **Branching**: scene choices (label → target scene), Story map (node graph),
  Play mode (click through the story), checks for dead ends (scenes can be marked as
  endings), unreachable scenes, choices with no target and "no ending reachable from
  here".
- **Continuity** ([ADR-0006](docs/adr/0006-continuity-model.md)): manual scene state
  changes (shown with plain labels, never the raw kind names), presence from `[[links]]`
  with author overrides, story time as a sortable key with granularity, calendars and
  flashbacks. `stateAt()` folds in **reading order**; in branching books it is a
  fixed-point dataflow over the scene graph, and findings say "on every path" or "on
  some paths". Dismissed findings are stored by fingerprint in `book.json`.
- Continuity view: presence map, arc lanes, POV balance, story time vs reading order,
  pacing, and the checks list (dead-then-alive, two places at once, time order, item in
  two hands, setup without payoff, silent arc, long absence, broken links). Severities
  are Error / Warning / Note.
- Exit: plan and reorder a book without leaving the workspace; write and play a
  branching story start to end; every check in ADR-0006 has a test that finds it and a
  test that does not raise it on a clean story; a test with a flashback that reveals an
  earlier death raises no finding on the earlier scenes; a test book with a loop and a
  hub gives the right "every path / some paths" answers.

### Release v0.3 "World" — build the world

**M6 · Worldbuilding library**
- Character sheet (identity, inner life, voice, relationships with types, appearances)
  with a **Progression** view: state scene by scene in reading order, built from scene
  changes.
- Worlds and places as a free hierarchy (planet → … → room, custom levels), sensory
  details, Earth as a root for history writing.
- Items, events, lore, research (with sources), factions, cultures, magic/tech systems.
- **Find new names** (ADR-0010): a Names panel lists recurring capitalised words that are
  not records yet, with "Create character / Create place / Not a name".
- Timeline with real dates (incl. BCE) and custom calendars (builds on the M5 outline
  columns).
- Media gallery (portraits, maps, reference images) stored in the project folder. The
  original file and extension are kept (no transcoding); thumbnails are a device-side
  cache.
- Exit: records link across books in one universe and show in backlinks and search.

### Release v0.4 "Protect and share"

**M7 · History and export**
- Snapshots per scene and per book, diff, restore.
- Export: Markdown bundle, DOCX, EPUB, PDF (print stylesheet), export profiles. A
  branching book exports in outline order, with a "Choices" list (label → scene title)
  at the end of each scene.
- Import: Markdown folders, Twine (branching) with a preview and a report.
- Exit: exports are repeatable; import reports what it could not read; a branching
  export shows every choice (test).

### Release v0.5 "Assist" → hardening → **v1.0**

**M8 · Assistant** ([ADR-0008](docs/adr/0008-ai-assistant.md)) — opt-in, the author's
own account
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
