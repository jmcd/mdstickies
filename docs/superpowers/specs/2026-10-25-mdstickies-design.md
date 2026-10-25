# mdstickies — Design

Date: 2026-10-25

## Intent

A personal, single-user web app for quickly jotting things you want to come
back to — checklists, code snippets, and loose bits of text — as "post-it"
notes on a board. Notes are written in Markdown and shown rendered whenever
you aren't editing them. Everything lives in your own browser; there is no
server, no account, and no sync.

## Goals

- A free-form board: stickies can be dragged anywhere, like a real wall, and
  stay where they're put.
- Edit in Markdown; see it rendered as soon as the sticky loses focus.
- Checklists are first-class: ticking a checkbox in the rendered view toggles
  it and updates the note's Markdown, without entering edit mode.
- Code snippets look like code (monospace, syntax highlighted).
- Notes survive closing the browser (browser storage, saved automatically).
- Export all stickies as a downloaded file; import such a file back in.
- Clear the whole board, with confirmation.

## Non-goals

- Multiple users, accounts, sharing, or a backend.
- Sync across machines or browsers (export/import is the manual route).
- Dark mode, tags, search, multiple boards — not now.

## Anti-goals

- Losing notes. Any action that destroys data (delete note, clear board,
  import-replace) must ask first, and normal editing must never drop text.
- A pasted note executing script: rendered HTML must be sanitised.
- Feeling heavy. It should open instantly and feel like paper, not an app.

## Behaviour

### Board

- One page, a toolbar along the top: **New**, **Export**, **Import**,
  **Clear board**.
- The board behaves like a wall: stickies are absolutely positioned and can be
  dragged anywhere by grabbing them (outside the text when editing).
- The board grows as notes are dragged beyond its right/bottom edge and
  scrolls normally. Positions are never negative.
- The sticky you click or drag comes to the front (z-order is persisted).

### A sticky

- **New** creates a sticky near the centre of the visible area and puts it
  straight into edit mode.
- **Editing:** focusing a sticky shows a plain textarea with its raw Markdown.
- **Rendered:** when the sticky loses focus, its Markdown is rendered (GitHub-
  flavoured: headings, emphasis, lists, task lists, links, tables, fenced code
  blocks). Clicking the rendered body re-enters edit mode — except clicks on a
  checkbox (toggle, below) or a link (opens in a new tab).
- **Checkbox toggle:** clicking the Nth task-list checkbox in the rendered view
  flips the Nth task marker (`[ ]` ↔ `[x]`) in the source Markdown, re-renders,
  and saves. Task markers inside code blocks must not be counted or changed.
- **Code:** fenced code blocks are monospaced and syntax highlighted.
- **Colour:** five pastel colours (yellow default), chosen from a small row of
  colour dots on the sticky.
- **Resize:** drag the bottom-right corner; size is remembered. Sensible
  minimum size.
- **Delete:** a small × on the sticky. Asks for confirmation unless the note
  is empty.

### Saving

- State is saved to `localStorage` automatically on every change (text edits
  may be debounced briefly, but must also be flushed on blur and before the
  page unloads). No Save button.
- On load, the saved board is restored exactly: text, position, size, colour,
  stacking order.

### Multiple tabs

The board may be open in several tabs or windows at once, and they must stay
in sync. A change in one tab (new, edit, move, resize, colour, delete, clear,
import) appears in the others without a reload, and no tab may overwrite
another tab's changes by saving its own stale copy.

- Saving and merging work per sticky, not as a whole-board overwrite: each
  sticky's `updatedAt` decides which version is newer. Other tabs learn of
  changes via the `storage` event (or `BroadcastChannel`; builder's choice).
- *Designer's call:* if another tab changes a sticky that is currently being
  edited (focused) in this tab, this tab keeps its local text while the
  sticky is focused, and the newest `updatedAt` wins once both have saved.
  If another tab deletes a sticky this tab is editing, the local edit keeps
  it alive (it is re-saved), so typed text is never discarded.
- Clear board and import-replace in one tab clear the board in all tabs.

### Export / Import

- **Export** downloads `mdstickies-YYYY-MM-DD.json` containing every sticky.
- **Import** opens a file picker for such a file. If the board is not empty,
  the user is asked to choose **Replace** (current board is discarded),
  **Add** (imported notes are added alongside; they get fresh ids so nothing
  collides), or **Cancel**. If the board is empty, it just loads.
- An invalid or unrecognised file shows a clear error and changes nothing.

### Clear board

- **Clear board** asks for confirmation, then removes every sticky.

Confirmations use an in-page dialog (not `window.confirm`), so the three-way
import choice and the others share one look.

## Data format

Persisted and exported in the same shape:

```json
{
  "app": "mdstickies",
  "version": 1,
  "stickies": [
    {
      "id": "uuid",
      "text": "## Today\n- [x] Review PR\n- [ ] Ship release",
      "x": 120, "y": 80,
      "width": 220, "height": 180,
      "color": "yellow",
      "z": 3,
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ]
}
```

`version` lets later changes migrate older files. Import validates the shape
and rejects anything it doesn't understand.

## Constraints and technical decisions (builder's call, made during design)

- **Vite + TypeScript, plain DOM, no UI framework.** One board with a few dozen
  notes doesn't need React; Vite gives a fast dev server and a static build.
- **marked** for GFM rendering, **DOMPurify** to sanitise its output,
  **highlight.js** for code blocks.
- **Vitest** for tests, focused on: checkbox-to-Markdown toggling (including
  code-block edge cases), export/import validation and merge/replace, and
  storage round-trip.
- Output is static files. **Deployed publicly to GitHub Pages**; anyone can
  use it, each person's notes living only in their own browser. Development
  is local with a simple server (Vite dev server / `vite preview`); opening
  `index.html` from `file://` is not a target.
- Because GitHub Pages serves from a repo sub-path (`/<repo>/`), the build
  must use a relative or configured base path so assets load there.
  *Designer's call:* deploy via a GitHub Actions workflow that builds and
  publishes on push to `main`.
- Modern evergreen desktop browsers are the target.
- Tests also cover multi-tab merging (two simulated tabs, concurrent edits,
  delete-while-editing).

## Left to the builder

- Visual styling beyond "pastel paper notes with a soft shadow" (fonts, exact
  colours, toolbar look, whether stickies have a slight tilt).
- Default sticky size, minimum size, debounce timing.
- Drag/resize implementation (pointer events recommended).
- Project layout and module boundaries.
