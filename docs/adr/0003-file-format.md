# ADR-0003 — Canonical file format

- Status: proposed (owner to confirm)

## Goals

Readable without Aurelia. Safe in a synced folder (OneDrive, Dropbox, iCloud,
Syncthing) and in git. Easy to migrate. Hard to corrupt.

## Layout

```
MyWorkspace/
  aurelia.json                         workspace: schemaVersion, id, name, universe order
  universes/
    unv_k3f9x2/
      universe.md                      frontmatter (title, kind, books: [order], calendars) + overview
      books/
        bok_7hq2m1/
          book.json                    title, status, targets, start, dismissedFindings,
                                       outline (a cache of order, see rule 3)
          OUTLINE.md                   derived, read-only: titles → paths (see rule 9)
          parts/prt_….md               part notes (optional)
          chapters/chp_….md            chapter fields + notes
          scenes/scn_….md              scene fields + manuscript text
          records/…                    records with scope book:bok_7hq2m1
      records/
        characters/chr_….md
        places/plc_….md
        items/itm_….md
        events/evt_….md
        arcs/arc_….md
        lore/lor_….md
        research/res_….md
        …
      media/med_….<original ext> + med_….json   images as imported, and their captions/credits
  .aurelia/
    snapshots/                         snapshot files (portable, optional to sync)
    backups/<fromVersion>/             copies made before a migration (rule 5)
```

Device-only state (search index, panel layout, recovery journal, sync state, media
thumbnails) lives in the browser's IndexedDB, **not** in the folder.

## Rules

1. **Paths come from IDs.** A file name never contains a title. A rename edits one
   frontmatter line; no path changes, no sync churn, no broken links. The path is a
   hint: the frontmatter `scope` is the truth (see rule 8).
2. **IDs** are a type prefix + 10 random base-32 characters, for example
   `chr_8f3k2m9q1x`. Made with `crypto.getRandomValues`. Never reused. This holds for
   every kind of ID, including setups (`stp_…`), choices (`chc_…`) and calendars
   (`cal_…`).
3. **Scenes are self-describing.** Each scene's frontmatter holds `chapter: chp_…` and a
   fractional `order` key. Each chapter points to its part or book the same way. So the
   outline can always be rebuilt from the files. `book.json` keeps the outline as a
   cache and summary of order; **scene frontmatter wins** when they disagree. On open,
   files that are not in the outline go to an **"Unfiled"** group — nothing is hidden.
   Conflicted copies (`book.json (conflicted copy)`, `scene (conflicted copy).md` and
   similar names from sync clients) are detected, and Aurelia offers to reconcile them.
4. **Markdown with YAML frontmatter** for anything a person writes; **JSON** for pure
   structure (`aurelia.json`, `book.json`).
5. **Migrations are safe.** Every file has `schemaVersion`.
   - An app **never writes** a file whose `schemaVersion` is higher than it knows. It
     opens the folder read-only and shows an "Update Aurelia" banner.
   - A migration copies every file it touches to `.aurelia/backups/<fromVersion>/`
     first.
   - A migration is one all-or-nothing pass. It writes a marker file at the start and
     removes it at the end, so a half-migrated folder is detected and offered a retry.
6. Unknown frontmatter keys and unknown Markdown syntax are **kept**, never dropped.
7. **YAML is edited, not regenerated.** Use the `yaml` package Document API, which keeps
   comments and key order. String values are always quoted on write. Golden test: a
   file that was not changed round-trips byte-identical.
8. **Duplicate IDs are a conflict, never a guess.** If two files carry one ID, both are
   kept, the author is shown the conflict, and a merge is offered. Aurelia never picks
   one silently. This also covers a sync client that turns a move into delete + create.
9. **Readable without Aurelia.** Keep ID-based paths (the right trade). To help a human:
   - each book gets a derived, read-only `OUTLINE.md` (title → path);
   - `title` is the first key in every frontmatter;
   - Obsidian shows `[[id:…|Name]]` as a link to a missing note. That is a known limit
     of the format, and the user docs say so plainly.
10. **Writes are compare-and-write.** Before a file is written, its stat and hash are
    compared with the last read. If they differ, nothing is written and the conflict
    flow opens (PLANS M2).

## Example scene

```markdown
---
title: The Lantern Gate
schemaVersion: 1
id: scn_4n8w2c7d0p
chapter: chp_6d2t9m4k8s
order: "a3"              # fractional key, sorts within the chapter
status: draft            # idea | outline | draft | revised | final
pov: chr_8f3k2m9q1x
location: plc_2b7x9r4k1m
time:                    # sortable key in a named calendar (see below)
  calendar: cal_4k8m2x9t1q
  at: "412-03-14T18:00"
  label: dusk            # display only
objective: Elena must get through the gate before curfew.
conflict: The warden knows her face.
outcome: She gets in, but owes a favour.
characters:              # overrides only; presence comes from [[links]] in the text
  add: [chr_1c5v8n2b6z]    # present, but not linked in the text
  remove: []               # linked in the text, but not actually present
ignoreNames: []          # places the author marked "not a name" (ADR-0010)
arcs: [arc_9t3r6y1u0e]
target: 1800
flashback: false
ending: false            # true = an ending of a branching book
changes:                 # state changes for continuity — see ADR-0006
  - { who: chr_1c5v8n2b6z, kind: relation, with: chr_8f3k2m9q1x, value: "stranger → creditor" }
  - { kind: setup, id: stp_6w2n9k4d8f, value: "Elena owes the warden a favour" }
choices:                 # empty or absent = a straight-line scene
  - id: chc_5g2h8j3k1l
    label: Pay the warden's price
    target: scn_0q9w8e7r6t
  - id: chc_7z6x5c4v3b
    label: Climb the old aqueduct
    target: scn_1a2s3d4f5g
---

The bells had already started when [[Elena Vasquez]] reached the Lantern Gate.

* * *

…
```

### Story time

`time.at` is a **sortable key with granularity**: `412`, `412-03`, `412-03-14` or
`412-03-14T18:00`, read in the named calendar. An optional `until` (same shape) makes a
span. `label` is free text ("dusk") and is display only; nothing sorts or checks on it.
How the keys are used is in [ADR-0006](0006-continuity-model.md).

## Markdown dialect (v1)

CommonMark + GFM tables, task lists and strikethrough, plus:

| Feature | Syntax |
|---|---|
| Wiki link | `[[Elena Vasquez]]`, `[[Elena Vasquez\|Elena]]`, `[[id:chr_8f3k2m9q1x]]` |
| Embed card | `![[Elena Vasquez]]` |
| Scene break | `* * *` |
| Callout | `> [!note] Title` (GitHub/Obsidian style) |
| Footnote | `[^1]` |
| Underline | `<u>text</u>` |
| Block ID | `^blk-a1b2c3` at the end of a block (kept as typed; see [ADR-0007](0007-markdown-converter.md)) |

On save, `[[Name]]` links are stored as `[[id:…\|Name]]` so they survive renames.

**HTML.** `<u>…</u>` is parsed as one dedicated underline mark. Every other raw HTML is
kept as escaped text and is **never rendered** (a test checks this).

Every feature has a golden round-trip test.
