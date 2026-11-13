# ADR-0007 — The Markdown converter

- Status: accepted (2026-11-12, M4 spike)

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
  block keeps the exact Markdown it came from. Whatever is not understood — a table, a fence,
  a footnote, an HTML block, inline code, an image, a bare link — is kept as written: a
  `rawBlock` node (a block) or text marked `verbatim` (inline).
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

## Known limits

- Two marks of the `*` family with no text between (`*a***b**`) are not told apart by
  Markdown; the writer asks for a space between marked words, as prose has. A text that ends
  in `*` or `_` right before a mark's own `**` is the same case.
- HTML entities (`&amp;`) are kept as the characters typed.
- Link titles, reference links, autolinks and images are kept as written text, not as links.
- A list item that holds a raw block (a table) is written with that block indented under it,
  which can change where a lazy continuation line belongs.

## Consequences

- The golden tests (`tests/golden/`, `src/editor/markdown/golden.test.ts`) are the contract.
  A new dialect feature adds a golden file and a node, nothing else.
- Tables, footnotes and the Markdown source-mode toggle (M5) replace `rawBlock` for their own
  syntax; until then they are kept as text.
