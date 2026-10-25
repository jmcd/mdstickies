# mdstickies: Multi-select. Design

Date: 2026-10-25

Builds on `2026-10-25-mdstickies-design.md`. Everything there still holds
unless this document says otherwise.

## Intent

Boards get messy. Notes pile up on top of each other, related notes end up
different sizes and colours, and getting rid of a handful means deleting them
one at a time, because the only bulk option is **Clear board**. This feature
lets you select several notes at once and act on them together: tidy them up,
make a related group look consistent, or delete some (but not all) of them.

## Goals

- Select several notes with a drag-box on empty board, or with a modifier-click.
- Act on the selection in one step:
  - **Cascade**: stack them in a diagonal pile.
  - **Colour**: recolour them all.
  - **Delete**: remove them all with one confirmation.
  - **Grid**: lay them out in tidy rows where every note can be read.
  - **Align left** / **Align top**: line up their left edges or top edges.
  - **Same size**: give them all the same width and height.
  - **Bring to front**: lift the group above every other note.
  - **Export selected**: download just these notes as a file.
- Drag any selected note to move the whole group.

The user asked for cascade, colour and delete. The rest were suggestions they
accepted.

## Non-goals

- Undo. Destructive actions confirm first, as they already do.
- Touch or tablet gestures. Desktop browsers stay the target.
- Persisting the selection, or sharing it between tabs. The selection belongs
  to one tab and is lost on reload.
- Resizing a group by dragging. The corner handle still resizes only its own
  note; **Same size** covers the group case.
- Named groups or tags.

## Anti-goals

- Losing notes. Deleting several notes must ask first (unless they're all
  empty, matching single delete). Ctrl/Cmd+A followed by Delete must never
  silently wipe the board.
- Getting in the way of single-note use. Clicking, editing, ticking
  checkboxes, dragging and resizing one note must work exactly as they do
  today when nothing is selected, and must not need a modifier key.
- Text being selected or a note entering edit mode by accident while you
  drag a box or modifier-click.

## Behaviour

### Selecting

- **Drag-box:** pressing on empty board and dragging draws a translucent
  rectangle. Every note the rectangle touches (any overlap, not full
  containment) is selected, and the selection updates live as you drag.
  A plain drag replaces the current selection. With Shift or Ctrl/Cmd held,
  the box adds to the current selection.
- **Modifier-click:** Shift-click or Ctrl/Cmd-click on a note toggles it in or
  out of the selection. It does not enter edit mode, tick a checkbox, follow
  a link, start a drag, or bring the note to the front.
  *My call:* on a Mac the modifiers are Shift and Cmd. Ctrl-click there keeps
  opening the context menu, so the recent right-click fix stays as it is.
- **Editing and selecting don't overlap.** *My call:* starting a drag-box or
  modifier-clicking a note ends any edit in progress, the normal way (focus
  leaves the textarea, text is saved). Entering edit mode clears the selection.
  Inside the textarea of the note being edited, Shift-click keeps its normal
  text meaning (extend the text selection) and doesn't toggle the note.
- **Select all:** Ctrl/Cmd+A while no note is being edited selects every note.
  While editing, it keeps its normal meaning (select all text).
- **Clearing:** a plain click on empty board, Esc (when not editing), or a
  plain click on any note clears the selection. A plain click on a note then
  does what it does today: it brings the note to the front and enters edit
  mode, ticks a checkbox, or opens a link.
- Selected notes show a clear outline in the accent colour, distinct from the
  edit outline.
- A note that is deleted, or removed by another tab, drops out of the
  selection. A remote **Clear board** or import-replace empties it.
- *My call:* a single selected note still counts as a selection, so the
  actions below work on one note too. This matters for Delete and Export when
  the drag-box catches one note.

### Moving a group

- Pressing on a selected note's bar or body without a modifier and dragging
  moves every selected note by the same amount. If that drag would push any
  note below zero, the whole group stops at the edge together, so the notes
  keep their shape relative to each other.
- A press on a selected note that doesn't become a drag (released under the
  drag threshold) is a plain click: it clears the selection, as above.
- Dragging an *unselected* note (no modifier) clears the selection and moves
  just that note, as today.
- The group's stacking order doesn't change while it moves. *My call:* a press
  that starts a group drag doesn't bring that note to the front; only a plain
  click (or a single-note drag) does, as today.
- *My call:* a selected note's own controls (the ×, the colour dots and the
  resize corner) act on **that note only**, never the whole group, so a slip
  on one × can't delete several notes. They don't clear the selection; a note
  deleted this way just drops out of it. Group actions live only in the
  selection bar and the keyboard shortcuts.

### Selection bar

- While one or more notes are selected, a second group of controls appears in
  the toolbar after the existing buttons, starting with a count ("3 selected")
  and a way to clear the selection. It disappears when the selection is empty.
- Controls: **Cascade**, **Grid**, **Align left**, **Align top**,
  **Same size**, **Front**, a **Colour** control (the same five colours as on a
  note, opened from a palette button), **Export**, and **Delete**.
- *My call:* every action keeps the notes selected afterwards, except Delete,
  so you can try Cascade, then Grid, then a colour without reselecting.
- **Delete** and **Backspace** delete the selection when no note is being
  edited (same confirmation as the button).

### Actions

Every action that changes notes saves each changed note through the normal
per-note save path, so other tabs pick the changes up and the usual
"newest `updatedAt` wins" rule applies. Because editing and selecting don't
overlap, no selected note is being edited when an action runs.

- **Cascade.** *My call:* notes keep their current front-to-back order. The
  backmost note goes at the top-left corner of the selection's bounding box
  (smallest x, smallest y); each next note is offset 30px right and 30px down,
  so every note's top bar stays visible. They're then stacked in that order
  above every other note on the board. Sizes are unchanged.
- **Grid.** *My call:* notes are ordered by reading position (top to bottom,
  then left to right, by their top-left corner). They're placed in rows of
  `ceil(sqrt(n))` columns, starting at the top-left of the bounding box. Every
  cell is the size of the largest selected note, with a 16px gap, so nothing
  overlaps whatever the note sizes. Sizes are unchanged.
- **Align left / Align top.** Every selected note's x (or y) is set to the
  smallest x (or y) in the selection. Notes may end up overlapping; that's
  expected, and Cascade or Grid fixes it.
- **Same size.** *My call:* every selected note takes the width and height of
  the largest selected note (by area), so no note shrinks and hides its text.
  Notes stay anchored at their top-left corner.
- **Front.** The selection is lifted above every unselected note, keeping its
  own front-to-back order.
- **Colour.** Every selected note takes the chosen colour.
- **Export.** Downloads the selected notes in the same file format and with
  the same file name as **Export**, so **Import → Add** brings them back.
- **Delete.** If any selected note has text, asks "Delete N notes? This can't
  be undone." with **Delete** (danger) and **Cancel**. If every selected note
  is empty, deletes without asking, as single delete does.

## Constraints

- Same stack as today: Vite + TypeScript, plain DOM, no UI framework, Vitest.
  No new dependencies.
- Pure layout maths (cascade, grid, align, same size, front, and the
  edge clamp for group moves) lives in plain functions that take and return
  sticky data, with unit tests. The UI tests cover selecting (box, modifier
  click, select all, clearing), group move, bulk delete confirmation, and the
  keyboard shortcuts not firing while a note is being edited.
- The single-note behaviour fixed in recent commits (right-click and lost
  pointer capture leaving a gesture armed, checkbox presses, edit outline)
  must keep working. The existing tests must pass unchanged.

## Left to the builder

- Look of the selection outline, the drag-box and the selection bar, within
  the existing toolbar style.
- Whether the selection bar's buttons use text, icons or both (text is fine).
- How the Board and StickyView split the work, and how a note's press is
  routed to "toggle", "group move" or "single move".
- Auto-scrolling the board when a drag-box or group move reaches the window
  edge (nice to have, not required).
- Whether Grid and Cascade grow the board when they push notes past its edge
  (they must still never place a note at a negative position).
