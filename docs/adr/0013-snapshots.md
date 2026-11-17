# ADR-0013 — Snapshots: history, compare and restore (M7a)

- Status: accepted (built in M7a). Builds on [ADR-0003](0003-file-format.md) (`.aurelia/snapshots/`
  was reserved there), [ADR-0009](0009-browser-storage-and-backup.md) (versions) and
  [ADR-0012](0012-sync.md) (sync).
- Rule 1 of AGENTS.md is the rule of this milestone: **a restore never loses a word.**

## Context

An author needs to go back: to the scene as it was before a rewrite, to the book as it was before a
reorganising afternoon. Backup versions (ADR-0009) already hold the whole workspace every hour, but
they live on a server, cover everything at once and are not something an author reads a scene from.
A snapshot is the author's own, small, named history of one scene or one book, kept in the folder
beside the writing and readable without Aurelia.

## What a snapshot is

One folder per snapshot, with plain files in it:

```
.aurelia/snapshots/
  snp_k3f9x2m1ab/
    snapshot.json                      what it is (below)
    files/universes/unv_…/books/bok_…/scenes/scn_….md     the files, byte for byte, at their workspace paths
```

`snapshot.json`: `schemaVersion: 1`, `id`, `kind` (`scene` | `book`), `target` (the scene or book ID),
`universe`, `book`, `title` (what it was called then), optional `name` (the author's), `reason`
(`manual` | `before-restore`; any other text a later version writes is still listed), `at` (ISO time) and `files: [{ path, hash }]` (the SHA-256 of each copy).

- **A scene snapshot** copies the scene's file. **A book snapshot** copies the book's `book.json` and
  every part, chapter and scene file of that book. It does not copy records (characters, places…):
  they belong to the universe, which other books share, and they have the trash, versions and
  rename-everywhere's own safety copies. `OUTLINE.md` is derived and is not copied.
- **IDs** are `snp_` plus ten random characters (ADR-0003 rule 2). The loader never reads `.aurelia/`, so
  a copied scene is never a second file with the scene's ID.
- **Immutable.** Nothing writes to a snapshot after `snapshot.json` is written, and nothing removes a finished one.
  A new snapshot always gets a folder that does not exist (a taken ID is skipped, and ten taken IDs in a
  row is a refusal, never an overwrite). So two devices can never conflict over one: they can only both
  have made their own.
- **Written like everything else.** Through the session (`exclusive`, so it runs after any save in
  flight), into the guarded adapter (refused in a read-only workspace). Each copy is written and read
  back, and a copy that does not read back the same stops the snapshot. `snapshot.json`, which is what
  lists it, goes **last**: a stop never leaves a listing with nothing behind it (the media rule of ADR-0003).
  A snapshot that fails before it is whole takes away the copies that call wrote (they are only copies,
  and nothing lists them, so they would sync and be backed up for ever). A file that is not text Aurelia
  can read is left out of a book snapshot (it is not loaded either), so one such file never leaves every
  snapshot "still arriving". The copy is of what the author has: words typed and not yet saved are in it
  (a snapshot is never older than the screen).
- **A snapshot that does not read** (a newer Aurelia's `schemaVersion`, a damaged `snapshot.json`, or a
  manifest that names a path outside its own book: no `..`, nothing absolute, everything under
  `universes/<universe>/books/<book>/`, because a restore writes to those paths) is not listed and is left alone. One whose files have not all arrived (sync brings them one by one) is listed
  as "still arriving" and cannot be compared or restored until it is whole. Before anything is read back
  from it, every file is checked against the hash written with it; a changed file means "not as it was
  saved, so Aurelia did not use it".

## Who takes one

One function, `takeSnapshot(session, target, { name?, reason? })` in `storage/snapshots.ts`, for every
caller, so a snapshot is made the same way wherever it is asked for:

- the author, by hand ("Take snapshot", with an optional name, in the History section at the foot of the
  inspector's Scene and Book tabs) and from the command palette ("Take snapshot of this scene / book");
- a restore, first, with reason `before-restore`.

The assistant's Accept (M8) calls the same function with its own reason (`reason` is free text, so a snapshot
with a reason this version does not know is still listed). Nothing calls it that way yet: a function with no real caller is
not exported for one.

## Restore

A restore is a write like any other (compare-and-write through the save pipeline), and it never deletes.

- **A scene** is put back from a scene snapshot or from a book snapshot that holds it. Only the **writing**
  changes. The scene's details (title, status, point of view, choices, which chapter it is in) stay as
  they are now: going back to last week's words must not move the scene back to a chapter that has since
  been deleted. First, the scene as it is now is snapshotted (`Before restore`). If the words already
  read the same, nothing is written and no snapshot is made.
- **A book** puts back the writing of every scene in the snapshot that differs. A scene that is in the
  book now and **not** in the snapshot stays exactly as it is, and the result says so in words and names
  it. A scene that was deleted since and is no longer in Recently deleted comes back at its own place, with the
  chapter it needs, and that chapter's part, if those are gone too (parts, then chapters, then scenes), and
  the outline is brought up to date. **Only what a brought-back scene needs comes back:** a chapter or
  part deleted on purpose, with nothing returning into it, stays deleted. **A scene that is in Recently
  deleted is left there** and named ("Put it back first"): restoring would give it the older words and
  block Put back, which never writes over a file in its place. The
  book's own details, the records and everything else are not touched. A book in the trash is refused
  ("Put it back first"). First the whole book as it is now is snapshotted.
- **A file that cannot be written over safely is left as it is, and named:** one with two versions waiting
  (a conflict), one whose ID two files carry, one that is still saving. A scene restore refuses with that
  reason; a book restore restores the rest and names those scenes. Nothing is ever written over a
  conflict, and a file that another file has taken the place of (a deleted scene's path) is not
  overwritten either.
- **The words typed and not saved** when Restore is pressed are not lost: the "Before restore" snapshot
  holds what the author had on screen. If that snapshot cannot be made, nothing is restored. **Words typed
  between that snapshot and the write** are in no snapshot, so the write is refused when the scene no
  longer reads as it did when the snapshot was made (checked in the same step as the edit, with nothing
  awaited between): a scene restore says so, a book restore names the scene and goes on.
- **One scene that cannot be saved** in a book restore is put back as it was and named ("could not be saved
  just yet"); the others are still restored, and the outline is brought up to date either way.
- **Undo is the snapshot.** The result says "What you had is saved in History as “Before restore”";
  restoring that one goes back. There is no separate undo.

## Compare

`domain/word-diff.ts` compares two texts word by word (Myers' shortest edit script, no dependency).
The spaces before a word travel with the word, so a changed phrase is one mark, not a row of marks split
at the spaces. A spaces-only change shows as the new spacing, unmarked. If a pair needs more than 1,500
single-word edits the middle is shown as all removed, then all added: coarser, still true, and then the
word counts say "about" and the dialog says the changes are large. A 40,000-word
scene with a few edits takes milliseconds (tested).

A snapshot is compared with **the text now** or with **another snapshot** (the older one is always "older",
whichever was picked first). A scene is compared alone; a book is compared scene by scene, matched by
scene ID, listing only the scenes that differ (the rest are counted), including "only in the text now"
and "only in the snapshot". Only the writing is compared, not the details at the top.

It is drawn like the Review inbox: removed words crossed out and in the danger colour, added words
underlined and in the ok colour. **Not colour alone:** the marks are line-through and underline, a screen
reader hears "[Removed: …]" and "[Added: …]", and the dialog says in words which side each mark is
about and how many words came and went.

The Review inbox (M8) will reuse `WordDiff` for its proposals, so the two diffs read alike (today Rename
everywhere has its own, smaller list of before and after lines).

## Two nouns

Backup keeps **versions** of the whole workspace on a server; a **snapshot** is a copy of one scene or one
book that the author takes (or a restore takes) in the folder. The History section says so in one line.
A scan for backup or sync reads and hashes every snapshot file again each round: measured with 20 book
snapshots of a 150,000-word book (25 MB), a scan went from 2 ms to 26 ms in memory (the cost is the
hash, ~1 GB/s), so no hash cache was built. On a real disk the reads cost more; that is the figure to
re-measure if a scan ever feels slow, and the snapshots' own hashes in `snapshot.json` are the cache.

## Snapshots, backup versions and sync

They are the author's history, so they are backed up and synced, **as ordinary files**, with no special
code in the backup or the sync:

- **Backup and versions:** `.aurelia/snapshots/**` is in `current/`, in `backup.json` and in every
  version zip, and a restore from either brings it back (tests in `engine.test.ts`). The cost is
  accepted: every version zip holds every snapshot, so a workspace with hundreds of book snapshots makes
  big zips (a book is a few hundred KB zipped). The 413 rule of ADR-0012 covers a server that refuses a
  file. If that ever bites, the way out is the one images took (ADR-0009, "As built (M6a)"): keep the
  snapshots only in `current/` and bring them back from there. Not built, because nothing needs it yet.
- **Sync:** a snapshot is a set of new files with new names, so a round only ever pushes or pulls them;
  they never conflict, and no "Aurelia copy" is made (test in `sync.test.ts`, including two devices that
  each take one while apart: both are kept). Because the files arrive one at a time, a snapshot may be
  listed before it is whole: see "still arriving" above.
- **No delete in M7a.** A snapshot is never removed, so history only grows. A later "Remove snapshot"
  would move its folder to the trash like any other item (ADR-0003 rule 11).

## What it does not do

- It does not snapshot records (see above), the workspace file, or the media folder.
- It does not take a snapshot by itself on a timer: the hourly backup version is that. (Automatic
  snapshots before the assistant's Accept come with M8.)
- A restore does not merge: it puts the writing of a scene back whole. Comparing first shows what that
  will do.
- A book restore does not move a scene back to its old chapter or order.

## Tests

`storage/snapshots.test.ts` (layout, byte-for-byte copy, unsaved words, never overwritten, a repeated ID,
a stop before `snapshot.json`, a copy that does not read back, read-only, newer manifest, incomplete,
tampered, restore of a scene and a book, a deleted scene and chapter back, conflict, duplicate ID, a
failing save, the "Before restore" snapshot, and a property test: after random edits, snapshots and
restores, every word ever saved is still in some file), `domain/word-diff.test.ts` (read back exactly,
as many words in common as the longest common run, fuzz), `storage/snapshot-compare.test.ts`, the backup
and sync tests above, and `tests/e2e/history.spec.ts` (take, edit, compare, restore, reload; a book; the
palette; both themes and a phone with axe).
