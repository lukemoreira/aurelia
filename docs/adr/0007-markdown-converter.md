# ADR-0007 — The Markdown converter

- Status: accepted (2026-11-12, M4 spike); tables, footnotes and the source mode added (M5)

## Context

The editor is Tiptap 3 (ADR-0001) and the file is Markdown (ADR-0003). Something has to turn
one into the other, and the file format sets two hard rules on it:

1. **Opening a scene and not editing it changes no byte**, and an edit changes only the
   block that was edited (rule 6: unknown syntax is kept; AGENTS.md rule 1: never lose words).
2. Everything in the dialect round-trips: the golden files in `tests/golden/`.

The spike was to pick between `@tiptap/markdown` (the official extension, built on `marked`)
and `prosemirror-markdown` (built on `markdown-it`).

## What was measured

Both were run, as shipped, over the twelve golden files of the dialect as first written (`tests/golden/`:
paragraphs, headings, marks, lists, quote and callout, scene break, wiki links, HTML, tables
and footnotes, block IDs, escapes, breaks). Exact output = parse then write, byte for byte.

| | `@tiptap/markdown` + StarterKit + task list | `prosemirror-markdown` default schema |
|---|---|---|
| Files written back exactly | 3 of 12 (headings, lists, block IDs) | 1 of 12 (headings) |
| Raw HTML | **rendered**: `<script>`, `<div>`, `<img>` dropped, `<U>` became underline | kept as text, but a block's lines were joined into one and `<u>` is not understood |
| Tables and footnotes | table **dropped**; footnote lines kept but escaped | table rows **joined into one line**; footnote lines joined |
| Code blocks | rewritten (an indented one became a fence) | rewritten |
| `[[wiki links]]`, `[^1]` | escaped (`\[\[Elena\]\]`) | escaped |
| `<`, `>`, `&` in text | turned into entities (`&lt;`) | escaped |
| Scene break | `---`, not `* * *` | `---` |
| Strikethrough, task lists, `<u>`, callouts | strike and tasks yes; `<u>` as `++x++`; callouts no | none of them |
| Source of an unknown inline construct | `raw` on every token | none (block line ranges only) |

Neither is faithful as it ships, and neither could be made to be by configuration: the
dialect needs the *source text of what is not understood* and of every block that was not
touched. Size, from a Vite build of each entry (minified, gzip in brackets):

| | |
|---|---|
| `marked` | 49.7 kB (13.2 kB) |
| `markdown-it` | 120.2 kB (44.0 kB) |
| `markdown-it` + `prosemirror-markdown` | 294.9 kB (104.8 kB) |
| `@tiptap/markdown` + `@tiptap/core` | 399.4 kB (106.6 kB) — the core is needed anyway |

Licences: `marked`, `markdown-it`, `prosemirror-markdown` and `@tiptap/markdown` are all MIT.

## Decision

**`marked`** — the parser `@tiptap/markdown` is built on — **used directly**, with Aurelia's own
code on each side of it (`src/editor/markdown/`, about 400 lines with comments):

- `parse.ts`: `marked`'s tokens → Tiptap JSON. Every top-level token carries its `raw`, so each
  block keeps the exact Markdown it came from. Whatever is not understood — a fence,
  an HTML block, inline code, an image, a bare link — is kept as written: a
  `rawBlock` node (a block) or text marked `verbatim` (inline). Tables and footnotes were kept
  that way until M5, and are nodes now (below).
- `render.ts`: nodes → Markdown in the dialect's own form (`- `, `**`, `*`, `~~`, `<u>`,
  `* * *`, `> [!note] Title`). Text is escaped only where it would otherwise read as Markdown;
  `[[wiki links]]`, `![[embeds]]`, `[^1]` and `^blk-…` are written as typed.
- `body.ts`: the rule that matters. Each block remembers its source (`src`) and a fingerprint of
  what it held (`sig`). A block that still holds that is written back as its source, so a text
  nobody edited is its old text, and an edit rewrites only its own block, keeping the blank
  lines it had.

Not `@tiptap/markdown`: its manager would have been overridden for every node (HTML, tables,
text escaping, empty paragraphs, scene breaks), and its default of parsing raw HTML into the
document is the opposite of ADR-0003's "never rendered". Not `prosemirror-markdown`: the
heavier parser gives no source for inline constructs, so "kept as written" would be a guess.
`@tiptap/markdown` is therefore **not** a dependency.

The converter needs no screen: `schema` is built with `getSchema`, so the golden, fuzz and
performance tests run as plain functions.

## Measured result

- 13 of 13 golden files (12 in the dialect's own form, one written by another app) are
  written back **byte for byte** when nothing is edited; the 12 are also what the editor writes
  when every block is written afresh.
- A seeded fuzz of 30,000 random paragraphs with marks, four seeds, reads back what was typed
  (the characters Markdown reads: `* _ [ ] < > # - + . ~ \` & ! | ^ \` and line breaks).
- Speed (Node + happy-dom, `PERF_REPORT=1 npx vitest run src/editor/perf.test.ts`):
  100 scenes / 150,000 words into the editor model **~50 ms**; one 1,500-word scene opened
  **~2 ms**; a 20,000-word scene opened **~12–17 ms**; a keystroke in it (the change, the
  text written out, the words counted) **median ~2.5 ms, p95 ~3–4 ms**; a 20,000-word scene
  written out again after one edit **~2.5–4 ms**. In Chromium the same scene's keystroke to
  the next frame is within a frame or two (the end-to-end test budget is p95 < 60 ms).

## What the design settles

- **Empty paragraphs are not written.** Markdown has no empty paragraph, and a cursor on a
  fresh line must not change the file.
- **Block IDs** (`^blk-a1b2c3`) are text at the end of their block, kept as typed. They are not
  attributes yet: nothing reads them until M3, and inventing visible IDs is forbidden.
- **A thematic break** in any form (`---`, `***`, `___`) is a scene break; it is written as
  `* * *` only where the author made or edited it.
- **A list beside a list of its own kind** takes a marker that differs from its neighbours'
  (`-`, `*`, `+`; `.` or `)`), whatever marker a neighbour was read with, or the two would
  read back as one list. A list kept as read keeps its own marker.
- **A list written with blank lines between its items stays loose**; a checkbox is written
  once (a loose item's box sits in its first paragraph in `marked`'s tokens).
- **An item starts on its marker's line whatever its first block is** (`- # Heading`,
  `1. > quote`, a fence, a nested list).
- **A hard break** ends no paragraph (`\` there is a backslash), is two spaces after a bare
  address (the address would swallow a backslash), and is a space in a heading, which is one
  line (a setext heading that ran over two lines is written on one).
- **Marks and punctuation.** `**hello.**She` does not read back as bold (CommonMark's flanking
  rules), so punctuation that ends a mark before a letter, or begins one after a letter, is
  written outside it: `**hello**.She`. A mark that holds only punctuation next to a word is
  written without the mark.
- **Line endings.** A text whose lines all end in CRLF is read as LF, and each block's source
  gets its CRLF back: it is written back as read, even under frontmatter with LF. A mix of the
  two is not kept as read (nothing is lost; the blocks are written afresh).
- **Padding.** Two blocks kept as read are written touching only if they still read as two
  blocks; a block written afresh always has a blank line before it.
- **A text the workspace did not take** (the editor was read-only or settling as it was typed)
  stays on screen, is not replaced by an outside change, and is sent again when the editor can
  write.
- **A checklist with an ordinary item** in it is a bullet list with its checkboxes kept as text.
- **A callout's title** is a string on the node; it is shown and kept, and has no editing
  field yet.
- **Headings** are drawn one level down (`#` as `<h2>`), so the scene's title is the page's
  only `<h1>`; the file's level is kept in `data-level`.
- **A scene that ends in a table, a footnote, a fence or a scene break** has an empty
  paragraph after it to type in (not written).

### Tables, footnotes and the source mode (M5)

- **A table** is `table` > `tableRow` > `tableHeader` / `tableCell` (`@tiptap/extension-table`, MIT,
  on `prosemirror-tables`, which `@tiptap/pm` already carried). A cell holds one paragraph: words
  and marks, no line break (a break in a cell is a space when written). The first row is the header
  and only it (a plain cell moved into it by deleting the row above becomes a header again), and the
  alignment of a column is the `align` of its cells (`:--`, `:-:`, `--:`). Merged cells have no
  Markdown, so none can be made, and a pasted table's `colspan` and `rowspan` are dropped with its
  paragraphs and lists (`flattenPastedCells`).
- **An untouched table is written back as read, whatever its form** (no outer pipes, no padding, a
  short row). A changed one is written tidy: every cell padded into its column (to the widest cell, but
  not past 40 characters, so one long cell does not stretch the rest), a `|` in a cell as `\|`, the
  rule row from the alignment. Nothing in a cell is read as the start of a line, so `-`, `#` and
  `|-` are not escaped there.
- **A table is kept as written when `marked` would drop something of it**: a row with more cells
  than the header (the extra cells are lost by `marked`, so such a row is not read as a table). The
  cells are counted the way `marked` splits them (an unescaped `|` ends one, in a code span too).
- **A footnote** is two nodes. `footnoteRef` is an inline atom with a `label` (`[^1]`, `[^note]`:
  word characters and `-`); `footnoteDef` is a top-level block with a `label` and `block+` content
  (the document is `(block | footnoteDef)+`, so a note cannot stand in a quote or a list; a
  definition there is a block kept as written, as before). The label is the file's own and is
  **never renamed on its own**. The number drawn beside a reference is its place among the
  references (the same label, the same number); a note is numbered like its reference, and a note
  nothing refers to by its label. Only "Renumber footnotes" (the bar, offered only when the labels
  differ from the text's order) writes 1, 2, 3 into the references and notes, then the unused notes.
  A new footnote takes one more than the largest number in use.
- **A note is written** as `[^1]: first line`, every further line indented four spaces, blocks
  parted by a blank line (so several paragraphs, a list or code are indented under it). A note
  whose first line would start with a space (code) starts on the next line. Several notes in one
  paragraph in a file are several blocks, each with its own text as source; written again they are
  parted by a blank line. A definition that does not start its line, or has a label outside
  `[\w-]+`, stays kept as written.
- **A note is read the way a footnote parser reads it, not the way `marked` splits it.** `marked`
  reads `[^1]: word` as a link definition and sets the lazy lines after it apart, and lists and links
  differently after a blank line. So the lines of a note are taken together; each note is read again
  on its own, and if that gives anything other than the same one note, the whole group stays a
  block kept as written. And `marked` keeps all link definitions of a file in one table, so a
  footnote's line that looks like one made every `[^1]` in the file read as a link: footnote labels
  are left out of that table.
- **A reference** is written as typed (like a wiki link); text after it that would make it a link
  (`(`) or a note (`:` at the start of a line) is escaped. It carries the marks around it.
- **Source mode** is a per-scene switch ("Markdown source", above the text) to a plain monospace area
  holding the scene's body (the details at the top of the file are not in it). What is typed is what
  is saved, through the same `editScene` path; nothing is sent until a key is pressed, so switching
  either way writes nothing, and the editor that comes back reads the text again. A file whose lines
  all end in CRLF gets CRLF back when it is typed in; a file that mixes the two is saved with LF
  from the first key. Another scene opens as written text again.
- **Renaming everywhere** now reaches names in table cells and notes (they are text like any
  other); fences, raw HTML and link definitions are still left as written.

## Known limits

- Two marks of the `*` family with no text between (`*a***b**`) are not told apart by
  Markdown; the writer asks for a space between marked words, as prose has. A text that ends
  in `*` or `_` right before a mark's own `**` is the same case.
- HTML entities (`&amp;`) are kept as the characters typed.
- Link titles, reference links, autolinks and images are kept as written text, not as links.
- A mark that begins right after a bare address with no space (`http://x.y**bold**`) is part
  of the address, as GFM reads it; text there is written as it is read, never escaped.
- A list item that holds a raw block (a fence) is written with that block indented under it,
  which can change where a lazy continuation line belongs.
- A table or a footnote inside a quote, a callout or a list item is part of that block's text,
  and a footnote definition there is kept as written; only top-level ones are nodes.
- A note whose lazy line `marked` sets apart in a way the note's own reading does not agree with, a
  footnote definition straight after a list in a quote or a callout, and the other odd corners of the
  fuzz below are not made worse by tables and footnotes (the same seeds find as many without them).
- A pasted table with a cell that spans columns is a table of single cells, so its later cells can
  stand one place to the left.

## Consequences

- The golden tests (`tests/golden/`, `src/editor/markdown/golden.test.ts`) are the contract.
  A new dialect feature adds a golden file and a node, nothing else.
- Tables, footnotes and the Markdown source mode (M5) replaced `rawBlock` for their own syntax:
  `tests/golden/tables.md` and `footnotes.md` (the tidy form, written again as read) and
  `foreign/tables-loose.md` and `foreign/footnotes-loose.md` (other apps' forms, written back byte
  for byte) are in the contract. The seeded fuzz generates both (tables with alignment, escaped
  pipes, marks, short and loose rows; notes of one line, several lines, paragraphs and lists, and
  several to a paragraph) and "types" into a cell or a note; on 120,000 files it finds one case in
  20,000, all in corners the editor before found as often (8 on the same files, before tables and footnotes existed).
