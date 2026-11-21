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

## As built (M6a)

- **Find new names** is `WorkspaceIndex.newNames(bookId)` over `src/index/new-names.ts`: a capitalised
  word (a capital and a small letter after it) that stands 3 or more times in the book's scenes, not at
  the start of a sentence or a block or right after an opening quote (a full stop after "Mr", "Mrs",
  "Ms", "Dr", "St" or "Prof" is not a sentence end), not inside a link, code or address, not a day,
  a month or a title like "Sir", and not any word of any name a record already has (so "Vasquez" is
  not offered once "Elena Vasquez" exists). Single words only. It reads the open book's scenes, not
  other books' and not record notes. It is a pure function of the files, so every device agrees.
- **"Not a name" for this panel** is kept in `book.json` as `notNames: ["Greywater"]` (exact word),
  not in a scene's `ignoreNames` — that list answers one place a record was suggested, this answers a
  word the library does not know. Nothing is written into a scene or its text; Undo puts the list back.
- **Create character / Create place** makes a record shared by the universe (a standalone book's
  universe is the book's own). The word is then a name and leaves the list; no alias is added.
- The panel is in World (›New names, with a count) and in the Names tab of the inspector (the design's
  "New names in this book"). After typing it is worked out again after a 0.7 s pause.

## Amendment (2026-11-18): short forms of a character's name

Owner: "Would like to see shortened versions of name being recognized. Example Archie for
Archibald, Tommy for Tommy Kent." Chosen: automatic.

- A **character** is also found by the short forms of its title (`shortForms` in
  `src/index/names.ts`): a nickname in quotes (straight or curly double quotes, or single quotes
  around a whole word), the first name and the last name. `“Archie” Archibald Collins` is also
  Archie, Archibald and Collins; `Thomas "Tommy" Kent` is Tommy, Thomas and Kent; `Major Dempsey`
  is Dempsey. A rank or a way of addressing someone (Mr, Dr, Professor, Major, Corporal, Sir, Ser,
  Grandma, DCI, Queen…) is stripped at the front and a suffix (Jr, Sr, II, III) at the end; a
  lowercase particle (de, van, von), an initial and a single letter are never one, and nothing
  after "of" is. A last name that is also such a word gives no last name (`Martin Luther King Jr.`
  is Martin only, never "Luther"). A one-word title gives nothing. Other record types get none.
- They are worked out with the rest of a scope's names (`WorkspaceIndex.formsFor`), once per change
  to names or titles, never stored. Rules, so nothing is guessed:
  - A short form that is any record's own title or alias (not a `never` one) is left to that name.
  - A short form two or more characters share is asked about for each (`ask`, "Which Collins?").
    One that is also an ordinary word (the common-words list, which gained young, little, long,
    white, black, brown, green, grey, gray, hill, wood, stone, old, big and man) is asked about too.
  - Names are compared as the matcher compares them, by exact text: a place titled `Jose` does not
    take "José" from `José Garcia`.
  - The author's answers win: an alias of that character with `match: never` turns the short form
    off (another character may still have it, and then has it alone); "Not a name" answers a place
    as it does for any name. A `never` alias that is the record's own title (a short form stopped,
    then the title renamed to it) is ignored, so it never silences the title. A `never` alias is
    not a name a `[[link]]` resolves by.
- **Find new names** does not offer them: every word of a known name was already left out.
- *Replaced by the amendment of 2026-11-20:* **Rename everywhere** is unchanged: it renames the title and the typed aliases only, never a
  short form (the next title gives its own). Accepted as designed: renaming `Archibald Collins` to
  `Archibald Smith` leaves the plain "Collins" mentions as written, untagged, or tagged to another
  character with that last name.
- A character's page lists them under Other names ("Also found as", with "asks first" when the
  form is asked about in any book that sees the record); "Stop finding Archie" adds
  the alias `{ text: "Archie", match: never }` through the sheet's alias writer, so the answer is in
  the record's file and every device and the MCP server agree.

## Amendment (2026-11-20): rename everywhere renames short forms too

Owner: "I want to be able to rename characters by renaming all instances, also dealing with
characters with the same first name." For a name two characters share, the owner chose: **Guess by
scene**. This replaces the 2026-11-18 rule that Rename everywhere never renames a short form.

- **Short forms are forms.** For a character, the short forms of its OLD title are found and
  offered like the typed names (`planRename` in `src/index/rename.ts`), by the index's rules: one
  that is any record's title or (non-`never`) alias is left to that name; one this record turned
  off with a `never` alias is not read; one another character also has is shared, so asked; an
  ordinary word is asked. They are not stored as aliases. Other record types get none.
- **What one becomes is paired by role** (`proposeForms`, with `nameRoles` beside `shortForms` in
  `src/index/names.ts`): the old first name becomes the new first name, the last the last, a
  nickname the nickname, when each side has exactly one of that role. One word left after a rank is
  the last name. Without a partner the word-for-word map is used, and without that the form is kept.
  `Elena Vasquez` → `Helena Marie Vasquez` makes "Elena" "Helena" and keeps "Vasquez". Every form
  is shown in the dialog and stays editable. For a character, a typed alias that is one of these
  words is paired the same way.
- **Guess by scene.** A place that is uncertain only because the name is shared is judged by the
  file it is in (a scene, or a record's notes). The file *names* a record when it has a certain
  mention of it (a tagged name only that record owns: its title, an unshared alias or short form)
  or a link that resolves to it (for the renamed record, also a link by an old name, which may now
  read as missing). If the file names this record and none of the other owners, the place is a
  **guess**: ticked, with "Probably Elena Vasquez: this scene names Elena Vasquez, not Elena
  Moreau." ("this note" in a record's notes). If it names only another owner, it stays unticked:
  "Uncertain — this scene names Elena Moreau." If it names both or neither, it stays unticked with
  the shared wording. A record's notes name their own record; a name kept as written (raw HTML,
  a fence) names no one. There is never a guess for a name that is an ordinary word (anywhere;
  at a sentence start it says "it may be an ordinary word"), for a name the author set to `ask`,
  or inside a title in quotes. The index is built after the rename, so a short form the new
  title now shares with another character still names that character here. A place whose new
  name is another record's title or typed alias (not one of its short forms) is never ticked
  ("Uncertain — Rook is also another record’s name"), except a link's label, which never changes
  what the link points to. An unshared short form that is an ordinary word says "it may be an
  ordinary word", not that the author asked. The common-words list gained river, hunter, sky,
  storm, pierce and sterling. The
  dialog's filter "To check" lists the uncertain places and the guesses; "Tick all" ticks the
  certain places and the guesses.
