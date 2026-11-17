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

## Built in M5b (decisions the first version left open)

- **Where the stored fields sit.** A `location` change names the place in `with`; a payoff names its
  set-up in `of`; a change may carry the `quote` it was marked on. A relationship's `value` is
  "was → now" and is read as what follows the last arrow. A scene may be `flashback` or
  `flashForward`; a calendar may carry `era` and `months`, which only decide how a key is written
  out ("14 Thaw 412 TR, 18:00").
- **State per fact.** The dataflow keeps, for every fact (a person's status, an item's holders,
  one thing a person has learned…), the set of values it has on the paths that reach a scene. For a
  rule about one fact this is exact; none of the checks relates two facts.
- **Presence** also counts a scene's point of view. A person named in the text but unticked is
  "Mentioned": spoken of, not there.
- **A flash-forward's changes stay in its own scene.** They show what will be true later and apply at
  their story time, so they hold in the flash-forward itself and in no scene after it in reading
  order (a prologue that shows a death raises nothing on the chapters that follow). A flashback's
  changes carry on as before: what it reveals is known to the reader from there.
- **Unreachable scenes** (a branching book) start from the empty state, and a scene a reader can get
  to hears only from scenes a reader can get to, so what an orphan scene does is never taken for
  something that happened on a path from the start. Scenes of no chapter ("Unfiled") are not read
  after the last chapter: each starts from nothing, and they are not counted as chapters.
- **The fingerprint carries the evidence** (the scenes that make the death, the holders of the item,
  whether a link is missing or ambiguous), so a mark of "intended" does not hide a new or worse
  problem of the same kind. A set-up written by hand without an ID is told apart by what it says.
- **A main character** has the point of view in at least two chapters, or is on the page in a fifth of
  them. A thread that goes quiet after its last beat is an arc that has ended, not a silent one.
- **Marking intended** is allowed for every finding except a choice to nowhere, Errors included
  (a ghost may walk on purpose).
- **Thresholds.** A thread is silent after 6 chapters with no beat and no scene advancing it; a main
  character (point of view somewhere, or on the page in a fifth of the chapters) has been away after
  8.
- **Not yet:** a time order across flashbacks in a branching book beyond a scene and its direct way in.

## Built in M6b

- **Progression** (character sheet tab): `progression(model, who)` reads the one model. A table of chapters
  (scenes and words they are on the page for, point of view, changes), a scrubber over reading order that
  shows `stateRows` at the scene it rests on ("on some paths" in a branching book), and the change log
  (changes about them, including another person's relationship that points at them; arcs, set-ups and
  pay-offs are about the story, not a person).
- **Whole universe**: each book of the universe is read from the end state of the book before it
  (`universeModels`, `endState`; a branching book's end is the join of its reachable scenes with no way
  on), so a death in book one is a finding in book two. `mergeModels` lays the books end to end for the
  views; a finding is marked intended in its own book's `book.json`.
- **Age and dates**: from the sheet's `born` and a scene's time in one calendar. Before birth is an Error;
  older than `maxAge` (default 120, per character) is a Warning. Age is a range when a date is coarse.
- **Timeline**: one calendar at a time, grouped by era, year, month or day; times in another calendar and
  scenes with no time are listed apart; dated events show too.
- **BCE**: see ADR-0003 (signed years).
