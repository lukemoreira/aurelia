# ADR-0004 — Branching scenes (interactive fiction) in v1

- Status: accepted (owner, 2026-11-12: "build it into v1")

## Context

Aurelia is for novels, history and **game writing**. Game writers need a story that
branches: scene A leads to B or C. The spec only has a straight-line outline.

## Decision

1. A **book has a mode**: `linear` (default) or `branching`. The mode only changes
   which views are shown first; any scene in any book may have choices.
2. A scene's **choices** are structured data in its frontmatter
   (`id`, `label`, `target` scene ID, optional `note`). A scene is an **ending** when
   `ending: true` ("Mark as ending" in the inspector). See ADR-0003.
3. The **outline order** is the writing order. In a branching book the **story graph**
   (scenes = nodes, choices = edges) is the reading order.
4. The book has a **start scene** (`book.json → start`). Default: the first scene.
5. **Editor**: choices show as a "Choices" block at the end of the scene. Adding a
   choice can create the target scene in one step.
6. **Story map** view: a node graph of scenes and choices, with auto-layout, pan and
   zoom. Click a node to open the scene.
7. **Play mode**: read the book from the start scene and click choices, like a reader
   would. Shows the path taken and lets you jump back.
8. **Checks** (shown in the map and a problems list):
   - dead end: a scene with no choices that is not marked `ending`;
   - unreachable: no path from the start scene;
   - broken choice: target missing or in another book;
   - **no ending reachable from here**: a scene (for example inside a loop) from which
     no `ending` scene can be reached.
9. **Continuity over the graph.** There is no per-path enumeration: paths are unbounded
   once a book has hubs and loops. State is a fixed-point dataflow over the story graph.
   Each scene gets the set of possible states, joined over its incoming edges, and
   findings say "on every path" or "on some paths". Details in
   [ADR-0006](0006-continuity-model.md) §2.
10. **Export.** An export of a branching book uses outline order and renders a
    "Choices" list (label → scene title) at the end of each scene.

## Later (not v1)

Variables and conditions (`has_key == true`), choice effects, Ink and Twine export.
The schema keeps room: unknown keys on a choice are preserved (ADR-0003 rule 6).

## Libraries

Story-map layout: a small layered layout (dagre-style). Evaluate `@vue-flow/core`
(MIT, Vue 3 native) in M5 against a hand-made SVG view; pick the smaller one that meets
the design.
