# ADR-0010 — Names: find and tag them automatically, rename everywhere

- Status: accepted (owner, 2026-11-12: "I want places and characters names to have an
  auto find and tag, so a name change gets easy").

## Goal

1. When the author writes "Elena" or "the Lantern Gate", Aurelia knows which character
   or place that is — without the author typing `[[links]]`.
2. Renaming a character or place updates the name in the text too, safely, in one step.
3. The manuscript files stay clean prose, readable in any editor.

## Decision

### 1. Names and aliases live on the record

Every record that can be named in text (character, place, item, faction, culture, event,
world, arc) has its `title` plus optional **aliases** in its frontmatter:

```yaml
title: Elena Vasquez
aliases:
  - { text: "Elena" }
  - { text: "Vasquez", match: ask }      # ask before tagging
  - { text: "Lena" }                     # a nickname
```

`match` is `auto` (default), `ask` or `never`. The sheet's "Names" field edits this list.

### 2. Mentions are found, not stored

Aurelia finds mentions while it indexes a scene. Nothing is written into the text.

- **Whole words**, Unicode-aware; the author's capitalisation must match (so "will" is
  never "Will"); possessives count ("Elena's", "Elena’s").
- **Longest match wins**: "Elena Vasquez" beats "Elena".
- **Scope**: a book only matches its own records and its universe's shared records.
- Mentions are **derived state** in the device index (ADR-0003 decision 6). The MCP
  server and every device get the same result from the same files, because detection is
  a pure function of the text, the names and the decisions below.

### 3. Tagged, or a suggestion

| Case | Result |
|---|---|
| One record owns the name, `match: auto` | **Tagged.** Counts for presence, backlinks, progression, search and the hover card. |
| Two records share the name ("Corin" the boy, "Corin" the river) | **Suggestion**: "Which Corin?" |
| `match: ask`, or the name is also a common word at the start of a sentence ("Will you…") | **Suggestion**: "Is this Will Ashby?" |
| Inside an explicit `[[link]]` | The link decides. |

Answering a suggestion is stored **in the folder**, so every device and the MCP server
agree:
- **"Yes, it's X"** writes an explicit link at that one place: `[[id:chr_…|Will]]`.
  Markup only where a choice was needed.
- **"Not a name"** adds the place to the scene's `ignoreNames` list
  (block ID + text + which occurrence, for example `blk-a1b2c3:Will:1`). A block gets an
  ID only when it needs one (ADR-0003 dialect).

### 4. How it looks while writing

- Writing comes first: tagged names are **not** underlined while typing. Hovering a
  name (or focusing it with the keyboard) shows the record's card, with its state at this
  scene (ADR-0006).
- Suggestions get a faint dashed underline and a small "?" until answered.
- "Show names" (palette, View menu) highlights every tagged name, coloured by type.

### 5. Find new names

The **Names** panel lists capitalised words that recur (3 or more times, not at the
start of a sentence, not in the dictionary) and are not records yet: "Greywater ·
7 times · Create place / Create character / Not a name". Nothing is created without a
click.

### 6. Rename everywhere

Renaming a record opens **"Change the name in your text too?"**:

1. A mapping per name form: "Elena Vasquez → Helena Vasquez", "Elena → Helena",
   "Lena → (keep)". The author can edit each line.
2. A preview of every place, grouped by book and scene, with the sentence around it.
   Tagged mentions are ticked; suggestions and anything uncertain are **not** ticked.
3. Possessives and capitals are kept ("Elena’s" → "Helena’s").
4. **Apply** saves a version first (ADR-0009), changes the files in one step, and can be
   undone. Explicit links keep their ID; only their visible text changes.
5. Places that were not ticked stay as they are and are listed afterwards.

## Consequences

- Schema: `aliases` on records; `ignoreNames` on scenes (ADR-0003).
- **Presence (ADR-0006) now comes from tagged mentions and explicit links**, minus the
  author's `remove` overrides. This makes the presence map useful without any extra
  work by the author.
- Milestones: detection and tagging in M3 (index); the editor display, hover cards,
  suggestions and Rename everywhere in M4; the "find new names" panel in M6.
- Performance: detection runs in the index worker, per changed scene, with one
  multi-pattern matcher (Aho–Corasick style) built from all names; budget under 50 ms for
  a 5,000-word scene with 500 names.
- Tests: golden cases for possessives, capitals, longest match, shared names, sentence
  starts, explicit links and ignored places; a rename test that changes "Elena" but not
  "Elenath" or "elena@example.com".

## As built (M3b)

- **Detection** is `src/index/names.ts`: a first-word lookup (not Aho–Corasick; measured well under the
  budget) with the longest name tried first. A name that is also a common word is asked about at a
  sentence start (a short built-in list of names that are ordinary words; it grows by editing the list).
- **"Not a name" keys.** `Will:2` is the second whole-word "Will" in the scene. A block is not
  given an ID just to answer a question (an answer is never a write into the manuscript), so the
  `blk-…:Will:1` form in the example above is not used. The count is of the word wherever it
  stands (in a link, in italics, in a list), so the editor, which reads the text on screen, and the
  index, which reads the file, number the same places, and a place turned into a link keeps its
  number. An answer hides only a name Aurelia was asking about: words added since can move a number
  onto a different, real name, and that one stays, and Rename everywhere lists it as uncertain
  rather than certain. An answer that no longer fits can only make a question come back.
- **Words.** A letter with its accents, or a digit, is part of a word; an underscore is not
  (`_Elena_` is Elena in italics). Web addresses, Markdown link addresses and email addresses are
  not read for names.
- **Notes** of a record are read for links only; names are looked for in scenes.
- **Rename everywhere** runs after the record's own rename (the title is its own step, and "Only
  rename the record" is the other answer). A name is renamed only where the record is seen from
  (a book's own record not in another book), and not in raw HTML, tables or fences, which are kept
  as written. The old names come from the record as it was; a link by name
  (`[[Elena Vasquez]]`) is matched on the old names, a link by ID changes only its label. The record's
  other names follow the changed forms in the same run. Before writing: a version is asked for first
  (in sync mode that is a round that may bring in changes from another device, so the files are
  compared after it), and a copy of every changed file is always kept in
  `.aurelia/safety/<stamp>/`; the run says "a version was saved too" only when it truly reached the
  server. Each file is compared once more just before it is written (compare-and-write through the
  session); a change from another device is deferred while the run is going; a refusal stops the
  run and reports how far it got; one Undo restores every file and the other names, leaving (and
  naming) a file typed in since.
