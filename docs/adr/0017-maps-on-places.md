# ADR-0017 — Maps on places

- Status: accepted (owner, 2026-11-25: "a map with pins — pick a map picture from your gallery, put pins on it, each pin is
  one of your Place records, click a pin to open that place and see the scenes set there, a pin can open a smaller map").
  The decisions below are the plan's own where the owner did not say; the owner can overrule any of them.
- Builds on [ADR-0003](0003-file-format.md) (unknown keys are kept) and [ADR-0009](0009-browser-storage-and-backup.md)
  (images are kept as imported). Not the **Story map**, the branching graph of a book (the Map view in the top bar): this is the
  **Map** tab of a place or world.

## Decision

### A map belongs to a place or world

- No new record type and no new file. A place or world record has two optional frontmatter keys, so it syncs, backs up,
  snapshots and conflicts exactly as the record's file already does, and no migration or `schemaVersion` is needed
  (`recordSchema` is a loose object):
  - `map`: the ID of a gallery image (`med_…`) used as the map. It is not `image`, which stays the picture *of* the place.
  - `pins`: a list of `{ place, x, y }`. `place` is the ID of a place or world, `x` and `y` are fractions 0..1 of the
    picture's width and height (not pixels, so the pin stays put whatever size the picture is drawn at).
- Read leniently, never a reason to refuse the file: an entry whose ID is not a place, whose number is not a number, or
  that is not an object is left out; a position outside 0..1 is clamped into it; a place pinned twice keeps its first pin;
  `pins` that is not a list, or a `map` that is not an image ID, reads as none. Keys a later version adds to a pin are kept.
  **Nothing read-and-dropped is lost by a save:** a save works on the `pins` list as the file has it, so an entry that was
  left out when read (a kind of pin a later version wrote, a bad ID, a second pin of one place) is written back as it was.
  A save changes only the entry it touches: other pins keep their stored values, unrounded and unclamped. Removing a place's
  pin also removes a hidden second pin of the same place, or that one would show instead. A `pins` that is not a list is
  replaced by the first pin saved.
- A position this version writes has four decimal places. A pin to a place that is no longer in the universe (deleted, in Recently
  deleted) is **not shown but kept** in the file, so restoring the place brings its pin back. A map whose picture is gone
  says so ("This map's picture is gone. Choose another picture.") and keeps its pins.
- Taking the map away takes **all** its pins with it (asked first, in words). Changing the picture keeps them.
- One pin per place per map: adding a place that is already pinned moves its pin. A place is not pinned on its own map.

### What a pin opens

- **Scenes set here** are the scenes whose `location` is the pinned place **or any place inside it**, at any depth (the
  hierarchy of `places.ts`, which already cuts loops and ignores missing parents). A scene set in a place inside says which
  one. Only scenes of the universe's books are listed, by title.
- "Open place" opens the record. "Open its map" shows only when that place has a map with a picture, and opens that
  record on its Map tab (`?tab=map` on the World route). A place whose parent has a map shows "Inside <Parent> — open its map".

### Editing

- **View** is the default; **Edit pins** is a toggle. Every finished action is **one write** through the record edit path
  (`setDetails`, one file): a drop, the end of a drag, a run of arrow keys (saved 500 ms after the last key). Each
  write is worked out inside the session's turn (`storage/place-map-actions.ts`) from the file as it is then, so a change made
  meanwhile (another device, a reload) is kept, and it is made on the record the action started on, even when another record's
  map has been opened since: a nudge still waiting is saved before the record changes. A write that is refused (another tab holds
  the folder, the place was deleted meanwhile) says why and is not announced as done. A place is not pinned on its own map.
- Dropping: pick a place from "Add pin" (places inside this one first, then the others of the universe; those already
  pinned say so) or from "Not on the map yet:", then click or tap the map. With the keyboard, "Drop it in the middle" puts it at
  the centre of what is on screen and moves focus to the pin; arrow keys move a focused pin by 1 % (Shift: 5 %).
- A plain list of the pinned places is always beside the map: it is the way to reach every pin without a pointer.

### How it is drawn

- Pointer events only, no new dependency: zoom 1× (the picture fits whole) to 8×, buttons, Ctrl or ⌘ with the wheel (a plain
  wheel scrolls the page), a trackpad's pinch (a wheel with Ctrl), drag to pan with the main mouse button, two-finger pinch.
  The frame is as tall as the picture is for its width (up to about 70 % of the screen), and takes a vertical swipe as a page
  scroll until it is zoomed in. A click in the margin beside the picture drops nothing. The arithmetic is `domain/map-view.ts`, tested without a DOM.
- Pins are placed in % of the picture and scaled back by the zoom, so they stay the same size on screen. They are drawn in
  fixed colours (a dark outline and a light halo, `--pin-*` in `tokens.css`, the same in both themes) so they read on any
  picture; the open pin is also bigger. Names show beside the pins and can be switched off (then only for the pin that is
  hovered, focused or open); a name goes on the left of its pin in the right part of the picture. The tiles of a
  real map are not used: this is the author's own picture, and nothing leaves the device.
- The assistant does not read or propose maps or pins (they are not text in the manuscript or the story base).

## Left out

- A pin that shows a different symbol or colour, labels that avoid each other, pins on a world's map for things that are not
  places, scene pins, and a route or distance between pins.
