# ADR-0002 — Project model: universes, books, scopes, arcs

- Status: proposed (owner to confirm)

## Context

The spec asks us to pick one model for standalone books, and to make universe vs
book ownership explicit from day one. It also lists the tree as
"Arcs → Chapters → Scenes" while describing an arc as a thread with
"books/scenes affected".

## Decision

### 1. Every book belongs to a universe

```
Workspace
└── Universe (kind: "shared" | "standalone")
    ├── Books[]            ← a standalone universe has exactly one book
    └── Shared records     ← characters, places, items, events, lore, research, arcs
```

A standalone book is a universe with `kind: "standalone"`. The UI does not show that
universe; the book appears under "Standalone books". "Turn into a series" flips the
kind to `shared` — no data moves.

Why: one ownership rule for storage, links, the index and sync. No special cases.

### 2. Owner scope on every record

Each record has `scope`:
- `universe` — shared by every book in the universe (the default for world records);
- `book:<bookId>` — private to one book (for example, a minor character).

"Promote to shared" changes the scope and moves the file. The ID does not change, so
no link breaks.

The frontmatter `scope` is the truth; the file path is only a hint. A sync client can
turn a move into delete + create, which may leave two files with one ID. **Two files
with one ID are a conflict shown to the author** (both kept, merge offered), never
picked silently ([ADR-0003](0003-file-format.md) rule 8).

Links may cross books inside one universe. Links across universes are not allowed in
v1 (the picker does not offer them).

### 3. Manuscript structure

```
Book
└── Part (optional)        "Part One", "Act II"
    └── Chapter
        └── Scene          ← the unit of writing, metadata and choices
```

### 4. Arcs are threads

An arc is a universe-scoped record (theme, purpose, objective, status, characters).
Scenes list the arcs they advance (`arcs: [id…]`). So an arc can run across books, and
the outline can colour or filter by arc. The spec's "Arcs → Chapters → Scenes" tree is
covered by Parts. An arc across books needs a book order, so `universe.md` lists
`books: [order]` in its frontmatter.

### 5. Record types (v1)

`character`, `world`, `place`, `item`, `event`, `arc`, `faction`, `culture`,
`system` (magic / technology), `lore`, `research`, `note`.
New types are added through a registry: schema, icon, sheet layout, default fields.
No other layer changes.

## Consequences

- The navigator needs a "Standalone books" group that hides the universe level.
- Moving a book to another universe is a later feature (links would cross universes).
