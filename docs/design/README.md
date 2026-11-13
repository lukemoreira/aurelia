# Aurelia — design

The screen designs live on a design canvas:
**https://claude.ai/artifact/3VYR9hu3XSczZj3FcXGQ7g** (private to the owner until shared).

The canvas source is in [`canvas/project/`](canvas/project/) — one `.dc.html` file per
artboard, plus `canvas.json` for the layout. Build the app from these files.

| Artboard | What it shows |
|---|---|
| `Welcome` | First run: choose a folder, browser storage or the sample; recent workspaces; "Reconnect folder" after permission loss |
| `Main` / `WriteDark` | The writing screen in light and dark: navigator, editor with toolbar, link hover card with "state at this scene", scene inspector with changes and an in-context continuity note |
| `Continuity` | Story health: presence map (characters × chapters), arc lanes, story time vs reading order, POV balance, setups and payoffs, findings list |
| `Character` | Character sheet, Progression tab: appearances per chapter, a scrubber, the change log and "state at this scene" |
| `Corkboard` | Planning: scene cards coloured by arc, drag to reorder, arc inspector with beats across books |
| `StoryMap` | Branching: scene graph with choices, start and endings, dead end, unreachable scene and broken choice; Play from start |
| `Assistant` | The assistant panel: connection, scope, "see exactly what" is shared, tool-call log, proposals shown as diffs in the text and in the panel |
| `ConnectAssistant` | Connect your own account: Continue with ChatGPT (desktop), use Aurelia from Claude (MCP), API key or local model |
| `ShareSheet` | Before sending: every item the assistant will see, where it goes, and a tick box to leave each one out |
| `ReviewInbox` | Every suggestion from any assistant: accept, edit, reject; "out of date" when the text changed; undo after accept |
| `AddChange` | How an author records a change (who → what happens → details), in plain words |
| `States` | Banners for lost folder access, save failed, changed on another device, newer version; empty states |
| `Phone` | Writing on a phone: navigator and scene panel open as sheets, 44 px targets |
| `Names` | Names found automatically (ADR-0010): "Show names" highlight by type, a "Will?" suggestion popover, the Names tab with found names, open questions and new names to add |
| `RenameEverywhere` | Rename a character: map each name form, preview every place (uncertain ones unticked), version saved first, one undo |
| `Backup` | Backup and versions: browser protection status, copy to Google Drive / OneDrive / Nextcloud, version list with restore (ADR-0009). **Built so far:** the card for "Your server" only; Google Drive and OneDrive are one honest line ("come later"), never shown as working. Gold is a border only (the card when backup is on); a warning box inside it, as in the "ask" state, is then the only thing that stands out. `StatusBar` with `backup=none` is live: where a server exists and the workspace is only in this browser, the chip says "Only in this browser — turn on backup" in warn on warn-soft and opens this screen |
| `Brand` | Logo, colour tokens for both themes, type, components, principles |
| `TopBar`, `Navigator`, `StatusBar`, `CommandPalette` | Shared building blocks used by the screens |

## Tokens

The token values are in every artboard's script as `AURELIA_TOKENS` and on the `Brand`
board. In the app they become CSS variables in `src/styles/tokens.css` (M0).

- `ok` (light) is `#2F6B3E`. The older `#3D7A4A` failed AA on chrome.
- `field` (`#968B78` light, `#6A6A78` dark) is the border of every input: 3:1 against
  the surface, as WCAG 1.4.11 needs.
- Focus is a 2 px outline in `ink`, offset 2 px. Never gold.

## Build notes (from the 2026-11-12 design review)

- **Plain words, never code names.** Change kinds show as "Relationship", "Learns",
  "Gains item", "Set-up"… The raw names (`relation`, `knows`) never reach the UI.
- **One exception to plain words:** the Files dialog's "could not be read" line leads with plain words, then keeps the parser's line or field, because an author who edits files by hand needs it.
- **Findings are "Error / Warning / Note"**, always as a word, never colour alone.
- **Presence map and progression bars are real tables** in the app (`<table>` with row and
  column headers, text in every cell for screen readers). The "Table view" button shows
  the same data as a plain list.
- **Long books**: Continuity, Corkboard and Character scroll by a chapter range with
  sticky row headers; rows are virtualised. Design for 120 chapters and 200 characters.
- **Hover previews also open on keyboard focus.** They are non-modal popovers, not dialogs.
- **No opacity to dim text.** "Later in the story" is a label, not a fade.
- **Gold marks what matters now** (the current item, the primary action, the caret). Data
  colours (POV, arcs) use the character or arc colour.
- **The "Continue with ChatGPT" button** uses OpenAI's official artwork. The design
  shows a neutral placeholder. In the browser build the ChatGPT card shows "Available in
  the desktop app".
- Radii: 8 controls · 12 cards · 16 dialogs. Controls 32 px with a mouse, 44 px on touch.
