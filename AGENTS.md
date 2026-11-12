# AGENTS.md — rules for anyone (human or AI) working on Aurelia

Read [`PLANS.md`](PLANS.md) first. It has the milestones, the decisions and the
progress log. The ADRs in [`docs/adr/`](docs/adr/) explain why things are the way
they are.

## Non-negotiables

1. **Never lose an author's words.** Autosave, recovery journal, snapshots. A conflict
   keeps both versions. A migration backs up first. Unknown data is kept, never dropped.
   **Every save is compare-and-write:** stat + hash the target, and if it differs from
   the last-read hash, do not write — open the conflict flow. An app never writes a file
   whose `schemaVersion` is higher than it knows.
2. **Local-first.** Writing, planning, worldbuilding and search work offline with no
   account. Cloud and AI are optional add-ons.
3. **Links use stable IDs.** A rename or a move must never break a link. Two files with
   one ID are a conflict shown to the author, never picked silently.
4. **AI never edits the manuscript by itself.** It returns suggestions the author accepts.
5. **Design quality is a feature.** Build from the design in `docs/design/`. Use the
   tokens, never raw colours or ad-hoc spacing. Check both themes and keyboard use.

## Code layout

```
src/
  domain/      entities, schema (zod), IDs, migrations, story graph — plain TS, no Vue
  storage/     StorageAdapter + adapters, safe writes, journal — plain TS
  index/       link resolver, backlinks, search — plain TS
  editor/      Tiptap extensions + Markdown conversion
  composables/ use*.ts — data, mutations, side effects (unit-testable)
  stores/      Pinia (UI state only)
  components/  thin Vue components (render + call composables)
  views/       route-level screens
  styles/      tokens.css, base.css
```

- Logic lives in composables or the plain-TS layers, not in components.
- A component over ~300 lines is split.
- Reuse before you write: search for an existing composable or component first.
- Wire it or delete it: no export without a real caller.

## Workflow

- Work in small milestones. Each has exit criteria and tests.
- Before you finish a milestone: `npm run check` and `npm run e2e` pass, `PLANS.md` is
  updated (ticked criteria, decisions, what is left).
- Branch per change; never commit to `main` directly.
- Commit messages: Conventional Commits (`feat(editor): …`). Sign off (`git commit -s`).
- Every source file starts with `// SPDX-License-Identifier: AGPL-3.0-or-later`.

## Tests

- Plain-TS layers: unit tests next to the code (`*.test.ts`).
- Markdown: golden files in `tests/golden/` — every dialect feature round-trips.
- Storage: tests for interrupted writes, permission loss, external changes (including a
  change while the file is open). Run the adapter contract on an in-memory adapter and
  on OPFS. Test the File System Access adapter with a `FileSystemDirectoryHandle` from
  `navigator.storage.getDirectory()`.
- YAML: an unchanged file round-trips byte-identical (golden test).
- E2E (Playwright): create a workspace, write a scene, link a character, reload.
  Playwright cannot click the native folder picker, so E2E does not use it.
- Tests are quiet and deterministic. No real network.
