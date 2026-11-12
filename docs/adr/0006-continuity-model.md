# ADR-0006 — Continuity: character progression, scene links and story checks

- Status: accepted in principle (owner, 2026-11-12: "tracking character progression,
  scene links and other difficult metrics to keep the storyline consistent is
  important to me"). Details to confirm in the M5 design review.

## Context

Long stories break in quiet ways: a character who died walks into chapter 30, two
scenes on the same night put one person in two cities, a sword is lost and then
drawn again, an arc goes silent for ten chapters. Authors catch these by memory or
by spreadsheets. Aurelia already knows the scenes, their story time, their
characters, places and arcs — so it can track this **without AI**.

## Decision

### 1. Scenes record *state changes*, not just presence

A scene can carry a short list of changes. Each change has a subject (a record), a
kind and a value:

```yaml
changes:
  - { who: chr_8f3k2m9q1x, kind: knows,     value: "Her mother is alive" }
  - { who: chr_8f3k2m9q1x, kind: condition, value: "Injured — left hand" }
  - { who: chr_8f3k2m9q1x, kind: relation,  with: chr_1c5v8n2b6z, value: rival → uneasy ally }
  - { who: chr_8f3k2m9q1x, kind: holds,     item: itm_3k9d2f7h1q }          # gains an item
  - { who: chr_1c5v8n2b6z, kind: status,    value: dead }
  - { who: chr_8f3k2m9q1x, kind: trait,     value: "Stops trusting the Guild" }
  - { who: arc_9t3r6y1u0e, kind: beat,      value: "Debt is called in" }
  - { kind: setup,  id: stp_3m7c1v9x2b, value: "The key under the lantern" }
  - { kind: payoff, of: stp_3m7c1v9x2b }
```

Kinds in v1: `status` (alive / dead / missing / gone), `condition`, `location`
(when it differs from the scene's location), `knows`, `relation`, `holds` /
`loses`, `trait`, `goal`, `beat` (arc), `setup` / `payoff`. Unknown kinds are
kept (ADR-0003 rule 6). Setup IDs are random like every other ID (`stp_` + 10 random
characters).

Changes are **manual**. The author adds them from the scene inspector ("+ Change") or
by selecting text and choosing "Mark as change". Nothing is guessed silently.

**The UI never shows the raw kind names.** It uses plain labels:

| Kind | Label in the UI |
|---|---|
| `status` | Alive / dead / missing |
| `condition` | Condition |
| `knows` | Learns |
| `relation` | Relationship |
| `holds` / `loses` | Gains item / Loses item |
| `trait` | Belief or trait |
| `goal` | Goal |
| `beat` | Arc moves on |
| `setup` / `payoff` | Set-up / Pay-off |

Finding severities in the UI are **Error / Warning / Note**.

### 2. State is computed, never stored twice

`stateAt(record, scene)` folds changes in **reading order** — outline order, and in a
branching book graph order. The character sheet's "Progression" view, the inspector and
the checks all read this one function.

**Story time is not the fold order.** It is only an input to the time checks (time
order, two places at once). Reason: a flashback in Ch. 20 that reveals an earlier death
must not turn every earlier appearance of that character into a finding. The reader
meets the story in reading order, so state is built in reading order.

**Branching books: no per-path enumeration.** Paths are unbounded once a book has hubs
and loops. Instead, `stateAt` is a **fixed-point dataflow over the scene graph**: each
scene gets the **set of possible states**, joined over its incoming edges (the start
scene begins with the empty state). A state domain built from the book's own changes is
finite and the join only grows, so the computation stops.

Findings are therefore **three-valued**:

- **on every path** — every state in the set breaks the rule;
- **on some paths** — at least one state does, and at least one does not;
- none.

### 3. Story time is optional but powerful

A scene's `time` is a **sortable key with granularity** in a named calendar (Gregorian
with BCE, or a custom calendar on the universe): `412`, `412-03`, `412-03-14`,
`412-03-14T18:00`. An optional `until` makes a span. A free-text `label` ("dusk") is
display only. A scene may be marked `flashback` / `flash-forward`. Scenes without a time
are still ordered by the outline. Times in different calendars are not compared.
See ADR-0003.

### 4. Continuity checks (rule-based, offline, explainable)

Each check says what it found, where, and why. Checks never change text.

| Check | Example finding |
|---|---|
| Appears after death or exit | "Tomas Brandt is dead since Ch. 12, but appears in Ch. 15 · Scene 2." (on every path / on some paths in a branching book) |
| Two places at once | "Elena is in Saltmarch and in Greywater at 14 Thaw, 412 TR, 18:00." |
| Time order | "Ch. 9 happens before Ch. 8 in story time and is not marked as a flashback." |
| Age and dates | "Corin is 9 in this scene, but the sheet says he is 'the eldest son, 30'." |
| Item in two hands | "The Lantern Key is held by Elena and by the Warden in Ch. 11." |
| Setup without payoff | "The key under the lantern (Ch. 3) is never paid off." |
| Silent arc | "The Debt has no beat for 9 chapters." |
| Long absence | "Mirela (major) has not appeared for 14 chapters." |
| Broken or dead links | "[[Old Harbor]] points to a deleted place." |
| Branching | dead ends, unreachable scenes, broken choices and **no ending reachable from here** (ADR-0004). The state checks above use the three-valued result from §2. |

**Two places at once** fires only when both scenes have **equal full-precision times**
(`412-03-14T18:00` and `412-03-14T18:00`). Coarser overlaps (a date against a time, or a
span) are "possible" and shown collapsed.

**Presence.** A character is *present* in a scene when the text names them — a tagged
mention found automatically ([ADR-0010](0010-name-mentions.md)) or an explicit
`[[link]]` — unless the author unticks them. `characters:` in the frontmatter stores only
the overrides (`add`, `remove`; ADR-0003). The checks and the presence map use this one
rule. `changes` stay manual.

**Dismissed findings.** Every finding has a **fingerprint**: check id + sorted subject
IDs + scene IDs. "Mark intended" stores the fingerprint in `book.json →
dismissedFindings`. So every device and the MCP server (ADR-0008) hide the same
findings. Every input to a finding lives in the folder.

### 5. Metrics (shown in the Continuity view)

- **Presence map**: characters × chapters (who is on the page where; POV marked).
- **Arc lanes**: each arc's beats across chapters and books (the book order is in
  `universe.md → books`).
- **POV balance**: words and scenes per POV character.
- **Story time vs. reading order**: a chart that shows jumps, flashbacks and gaps.
- **Pacing**: words per scene and chapter against targets.
- **Scene links**: for any scene, its characters, places, items, arcs, links in and
  links out; for any record, every scene it is linked to.

## Later (not v1)

- **Knows before learning**: "Elena refers to her mother being alive before Ch. 14, where
  she learns it." This needs a tagged-mention syntax; the dialect has none. Revisit with
  the AI checks.
- AI checks (M8 and later) can *add* findings (for example "eye colour differs"), shown
  in the same list but labelled as AI and never treated as certain.

## Consequences

- The scene schema gets `changes`, `flashback`, `ending`, the presence overrides and the
  richer `time` (ADR-0003 updated).
- The index keeps a per-scene table of changes so `stateAt` and checks are fast.
- Checks run in a Web Worker, off the typing path, and re-run only for touched scenes.
- The domain, index and continuity layers are plain TypeScript, so the MCP server runs
  the same checks in Node (ADR-0008).
