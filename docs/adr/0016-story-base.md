# ADR-0016 — The story base, and the assistant's guided start

- Status: accepted (owner, 2026-11-18: "an AI guided start. Objectives, history outline, main narrative,
  these things that serve to ground the lore").
- Builds on [ADR-0015](0015-assistant-on-your-server.md). Every safety rule of ADR-0008 and ADR-0015 stays.

## Decision

### The story base is part of the book, and works without Claude

- One per book, in `book.json` under `storyBase`: `objectives` (audience, genre, tone, length, themes),
  `world` (the world and its history, in outline) and `narrative` (premise, main arc, the direction of the
  ending), each plain text. It is a key of the book's own file, not a new file kind: it syncs, backs up,
  snapshots and conflicts exactly as `book.json` already does (ADR-0012, ADR-0013). The field is optional
  and unknown keys inside it are kept, so no migration and no new `schemaVersion`. A value that is not an
  object is read as no base, never a reason to refuse the book.
- **Main characters are real Character records** of the book's universe (shared by the universe), not
  text in the base. The base lists them.
- The author reads and edits it by hand on the inspector's **Book** tab, "Story base" (each section saved
  when the author leaves it, `storage/story-base-actions.ts`). No Claude needed.
- Restoring a book snapshot puts back the base's sections the snapshot has; a section written since and
  empty in the snapshot stays (as a scene that is not in a snapshot stays).

### The guided start

- "Set up the story base with the assistant": in the Assistant tab before the first message (with a line
  saying the book has no story base yet, when it has none) and on the Book tab once the assistant can read
  the book. It sends one fixed message from the author; the system prompt says how it goes: read what the
  author already wrote, then ask **one short question per reply** — objectives, then world and history,
  then narrative, then characters — and propose each area as it is done.
- Each question is one `claude -p` run, as every question is (ADR-0015); the panel carries the
  conversation.

### Grounding

- `get_story_base(bookId)`: the three sections and the main characters (id, name, their sheet's details),
  fenced as untrusted data like every other story text. With no base it says so and lets Claude offer the
  guided start. The system prompt tells Claude to read it first on every question and keep to it.

### Everything is a proposal

- `propose_story_base(bookId, objectives?, world?, narrative?)` writes a `base` proposal: each named
  section with its text as Claude read it (`before`) and its new text (`after`). Accept is refused, and
  nothing changes, when any of those sections reads otherwise now; that also refuses a second Accept.
  When it replaces text the author had, Accept takes a **"Before a suggestion"** snapshot of the book first.
- `propose_character(bookId, name, summary?, role?, age?, appearance?, background?, goal?, fear?, flaw?,
  belief?, secret?, voice?)` writes a `character` proposal. Accept makes one new Character record in the
  book's universe with those details; only those keys can be set (others are stripped when read). A name the
  universe already has (case and spaces aside) is refused by the tool and by Accept, so a second Accept
  makes no second record. Nothing is overwritten, so no snapshot.
- Both are reviewed in the Review inbox with Accept, Reject and Ask for changes; no accept-all. They are
  the book's, not a scene's, so they are not shown inside the text. A revision `replaces` only a proposal of
  the same kind for the same book.
- No direct writes, deletes or web, as before. Changing an existing character is not offered (YAGNI): the
  author edits the sheet, or asks in words.

## Tests

`src/domain/story-base.test.ts` (reading, merge, kinds), `src/storage/story-base-actions.test.ts` (by hand,
Accept with and without a snapshot, refused when changed, no second record, restore),
`server/agent/test/tools.test.ts` (the three tools, the fence), `server/agent/test/server.test.ts` (allowed
tools and the prompt), `src/components/assistant/AssistantPanel.test.ts` (the guided start's message, the
Book tab) and `tests/e2e/story-base.spec.ts`.
