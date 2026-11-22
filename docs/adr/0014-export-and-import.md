# ADR-0014 — Export and import

- Status: accepted (M7b, 2026-11-17)

## Context

An author has to get a book out of Aurelia (to an editor, an agent, a reader, a printer) and
writing in (from another tool, an old folder, a Twine story). Both must be safe and plain:

- an export is a **copy**: it never changes a file of the workspace;
- an import only ever makes a **new book**: it never touches one that is there;
- the same book and settings give the same file, byte for byte, so a changed file means a changed book;
- what could not be carried over is said, in words, before and after.

## Decisions

### Export

1. **One reading of the text.** An export reads a scene with the editor's own converter
   (`parseMarkdown`, [ADR-0007](0007-markdown-converter.md)), so a table, a footnote or a callout means
   in a file what it means on screen. `src/export/blocks.ts` turns those nodes into a few plain blocks
   (paragraph, heading, quote, list, table, code, break) that every format writes out.
2. **What is left out, kept or changed.**
   - Order is the outline's, part by part, chapter by chapter ([ADR-0003](0003-file-format.md) rule 3).
     Scenes filed in no chapter ("Unfiled") are not part of the manuscript and are not exported; the Export
     dialog says how many there are.
   - A link to a record is the name a reader sees (`[[id:chr_…|Elena]]` is "Elena"; `[[id:chr_…]]` is the
     record's title). Block IDs (`^blk-…`) mean something only to Aurelia and are removed.
   - Raw HTML, and whatever the converter keeps "as written", is **text**: shown, never rendered or run. A
     fenced block is code. An HTML comment (`<!-- note -->`) is for the author: it is left out of Word, EPUB
     and PDF (the Markdown bundle keeps it, as it keeps all the text). A link is kept only when its address is
     a valid `http`, `https` or `mailto` URL, written as the URL parser writes it; any other is its words.
   - A footnote is numbered by its first reference in the scene; a reference with no note stays as typed;
     a note nothing refers to is kept as a paragraph at the end of the scene, so no words are dropped.
   - Characters XML cannot hold (stray control characters) are removed from DOCX and EPUB.
3. **A branching book** ([ADR-0004](0004-branching-scenes.md) point 10) exports in outline order, and a
   scene with choices ends with a **Choices** list: each choice's label, an arrow and the title of the
   scene it leads to. It applies to any scene that has choices, whatever the book's mode. Every choice
   appears; one that leads to a scene that is gone says "a scene that is no longer here", and one that leads to
   a scene that exists but is not in this export (another book, or in no chapter) says "a scene that is not in
   this export", never that scene's own title. In the
   EPUB and the print view the title is a link to that scene.
4. **Formats**, each a function of the book and the profile and nothing else:
   - **Markdown bundle** (`.zip`): `Book/[Part/]Chapter/Scene.md`, each folder and file named by its place and
     title (`01 Arrival/02 The Old Bridge.md`), so a file browser lists them in reading order. A scene
     file has its title, and the real titles of its book, part and chapter (a folder name cannot always be
     them), in YAML at the top, and its text as written (links to records as names; code, spans and indented
     blocks left alone), with the Choices as a list at the end. Aurelia's own import reads this layout back. Layout settings do not apply.
   - **DOCX**, by hand in OOXML on the stored zip writer: `[Content_Types].xml`, `_rels/.rels`,
     `docProps/core.xml`, `word/document.xml`, its rels, `styles.xml`, `numbering.xml`, `footnotes.xml`,
     `settings.xml`. Real heading styles, real Word footnotes, real lists (each ordered list its own
     numbering, so each starts where it says), tables with a header row and column alignment, external
     hyperlinks. Page size, font, size and line spacing come from the profile.
   - **EPUB 3**, by hand: `mimetype` first and stored (no extra field), `META-INF/container.xml`,
     `content.opf`, `nav.xhtml` (parts hold their chapters), `style.css`, a title page and one XHTML file per
     chapter. Footnotes are `<aside epub:type="footnote">` notes at the end of their chapter, so a reading
     app can show them as pop-ups. No NCX (EPUB 3 does not need one).
   - **PDF**, with no PDF library: Export opens a **print view** (the book as one page of HTML, a sheet of
     paper on screen) and the author presses Print and chooses "Save as PDF". The print stylesheet is generated
     from the profile (`@page` size, font, size, line spacing; a chapter starts a page); while the view is
     open the rest of the app is `inert`, the tab is named after the book (so the saved file is), and under
     `@media print` only the book is shown.
5. **Repeatable.** The same book and profile give the same bytes, in every format, on any machine on any
   day. Nothing reads a clock, a random number or the machine's zone:
   - every zip entry carries one stamp, the zip's own epoch (1 January 1980, 00:00), read in UTC
     (`FIXED_ZIP_STAMP`, `zipFiles(files, stamp, true)`; the default of `zipFiles` is still the local time,
     which backups use);
   - entries are in a fixed order (DOCX: the order of its parts; EPUB: `mimetype` first, then the rest;
     Markdown: sorted by path);
   - the EPUB identifier is `urn:aurelia:<book id>`; its `dcterms:modified` (required) is a fixed
     `1980-01-01T00:00:00Z`, the same stamp, because a date the file was made on would change with the day. A
     reading app may therefore show 1980 as the "modified" date; the file system's own date is the real one;
   - tests export twice, in three time zones, and compare bytes; golden files hold the DOCX `document.xml` and
     the EPUB package and first chapter of a small fixture.
6. **Export profiles**: named, saved settings. They live in one workspace file,
   **`.aurelia/export-profiles.json`**, so every book of the workspace can use them and a backup or a sync
   carries them (like the rest of `.aurelia/`, it is not read as content when a workspace is loaded):
   `{ "schemaVersion": 1, "profiles": [ { "id": "exp_…", "name", "format", "titlePage", "subtitle", "author",
   "chapterTitles", "sceneTitles", "separator", "language", "pageSize", "font", "fontSize", "spacing" } ] }`.
   - A setting that is missing or unreadable reads as its default; **keys the file or a profile has that
     this version does not know are kept** when it is written again (ADR-0003 rule 6).
   - A file that cannot be read (or whose `profiles` is not a list) is left exactly as it is (nothing is
     written over it), an entry with no ID is kept as written, and a file whose
     `schemaVersion` is newer than this version's is read but never written (AGENTS.md rule 1).
   - `language` must be a language tag of the BCP 47 shape (`en`, `fr-CA`); anything else is read as `en`,
     and the dialog says so before an e-book is made, since `dc:language` and `xml:lang` need a real tag.
   - The **Standard** profile is always offered, is never written over, and is not in the file until someone
     saves changes to it as a new profile. Profile IDs use
     the `exp` prefix ([ADR-0003](0003-file-format.md) rule 2). Saving reads the file as it is on disk and puts
     the one profile in (`writeDerived`), so settings saved on another device are not lost. The sample
     workspace has no files: its profiles last until the tab closes.
   - Title and subtitle are per profile: the title is the book's own; subtitle and author are in the profile.
     A different book that needs a different author is a different profile.

### Import

7. **Always a new book, always with a preview and a report.** Reading a file writes nothing; the plan
   (`ImportPlan`: a title, chapters, scenes, choices, a start) and its **report** (what could not be read, and
   why; what was read another way) are shown, with an editable name, before anything is made. In an open
   workspace the book goes into the current shared universe, or becomes a book of its own (as "New book" does).
   From the Welcome screen it makes a **new workspace in this browser** that holds the book alone.
   A book of its own gets its universe first (listing it, as "New book" does), then its files, content first
   (the book, its chapters, its scenes, each saved before the next), then the line in `aurelia.json`; a book in a
   shared universe is listed last. So a stop never leaves a book in no universe, and a retry never makes a
   second. A test stops at every write.
8. **Sources.** Several `.md` / `.markdown` / `.txt` files; a folder (`<input webkitdirectory>`, which Chrome,
   Edge, Safari and Firefox all have); a `.zip`; a Twine story as Twee 3 (`.tw`, `.twee`) or Twine 2 published
   HTML. Anything else is listed in the report ("Not a Markdown or text file"); hidden folders (`.git`,
   `.obsidian`) are named; files an operating system adds (`.DS_Store`, `__MACOSX`) are skipped without a line.
9. **Markdown mapping.** A folder is a chapter (a folder in a folder: a chapter named by its last folder; files
   in the top folder: "Chapter 1"); a file is a scene; order is natural ("2" before "10", `Intl.Collator`
   numeric) folder by folder. A scene's title is the `title:` of its details, else its first heading (a `#` or
   `##` on the first line, which is then not repeated in the text), else its file name (number in front and
   extension taken off). Other details at the top of a file are **not kept** (a key such as `pov` could break the
   scene's file) and are named in the report, one line for each file; `chapter` (which Aurelia's own export writes)
   names the chapter, and `book` is not needed. The details are details only when they are a mapping: a file that
   opens with a scene break (`---`) is all text. A first heading too long to be a title stays in the text. Details
   that are not YAML stay as the first lines of the text. A
   byte order mark and Windows line endings are read as plain text; a file that is not UTF-8 is listed.
10. **Zips from other tools** are deflated. The browser inflates them itself
    (`DecompressionStream('deflate-raw')`): no library. A zip is not trusted: sizes are checked before and
    while inflating (a zip that says "small" and inflates huge is stopped), the CRC of every file is checked,
    a name that climbs out of its folder, a password protected entry and a compression the browser has no
    name for are each listed and skipped, zip64 is refused, and the one folder all entries share (the one
    "Compress folder" makes) is taken off and names the book.
11. **Limits**, with a plain message: 2,000 files and 50 MB at once, and 5 MB for any one file (a file over it
    is listed, the rest goes on; too much altogether stops the import before anything is read). They count what
    would be read (Markdown, text, Twine, zips), not the objects of a hidden folder, an operating system's files
    or images, in a folder or in a zip.
12. **Twine.** Passages become the scenes of one chapter ("Passages") of a **branching** book; the start is
    `StoryData`'s `start`, else the published HTML's `startnode`, else the passage named "Start", else the
    first. Links are read as Twine reads them: `[[a|b]]` first, then the rightmost `->`, then the leftmost `<-`,
    then `[[target]]`; a setter (`[[a|b][$x to 1]]`) is dropped and named. A line made only of links is the
    choices (not repeated in the text); a link inside a sentence stays as its label; a link to a passage that
    is not in the story is only its words and is named. A passage with no links and no macros is marked as an
    ending (and the report says so). **Macros and variables** (`(set:)`, `<<if>>`, `$gold`) stay as the text they
    are and are named, passage by passage: ADR-0004 has no conditions yet. Passages that hold a story format's
    code or settings (`StoryInit`, tags `script`, `stylesheet`, `widget`, `init`, `startup`…) are not scenes
    and are listed; tags are not kept (named); positions are not kept (the map lays itself out). The HTML is
    read with `DOMParser` and `textContent`: it is data, never inserted into a page and never run. The first
    story of an archive is read; the others are listed.

## Not done (later)

- Ink and Twine **export** ([ADR-0004](0004-branching-scenes.md) "Later").
- Export of one chapter or one scene, and of a whole universe.
- A cover image, a table of contents page in DOCX and PDF, running heads and page numbers (the browser's print
  dialog adds its own).
- Import of DOCX, EPUB or Scrivener projects; import of records (characters, places) and of images.
- Import into an existing book. An import is a new book; moving scenes between books is the outline's job.
- A language other than English for the words an export adds ("Choices", "Notes", "Chapter 3").

## Consequences

- `src/export/` and `src/import/` are plain TypeScript (no Vue): the formats, the converter, the Twine
  parser and the zip reader are unit-tested as functions. The dialogs are thin (`useExportDialog`,
  `useImportDialog`).
- The golden files in `tests/golden/export/` are the contract for the DOCX and EPUB writers. `UPDATE_GOLDEN=1
  npx vitest run src/export` writes them again after a deliberate change.
- A new part of the dialect gets a block in `blocks.ts` and a case in each writer, or it is kept as text.
- 2026-11-21: a book's **cover art** (`book.json` `cover`, an image of the media gallery) is the EPUB's cover
  (manifest item `cover-image`, the EPUB 2 `<meta name="cover">`, a cover page first in the spine; an AVIF is left out,
  it is no EPUB image type) and the first page of the print view. DOCX and the Markdown bundle do not carry it. It is read
  once before the export (`readCover`); an image that is deleted, missing or unreadable means an export with no cover,
  byte for byte the export there was.
