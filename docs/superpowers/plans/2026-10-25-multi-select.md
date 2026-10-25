# Multi-select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select several stickies (drag-box, modifier-click, Ctrl/Cmd+A) and move, arrange, recolour, export or delete them together.

**Architecture:** Pure layout maths lives in a new `src/arrange.ts` (sticky data in, `{id, changes}` updates out). `StickyView` learns three things: show a selected state, report modifier-clicks and plain clicks, and hand a selected note's drag to the Board instead of moving itself. `Board` owns the selection (`Set<string>`), the drag-box, the keyboard shortcuts and a selection bar in the toolbar, and applies every update through its existing `change(id, changes, false)` path, so saving and multi-tab sync are unchanged.

**Tech Stack:** Vite + TypeScript, plain DOM, Vitest + jsdom. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-25-multi-select-design.md` (builds on `docs/superpowers/specs/2026-10-25-mdstickies-design.md`)

## Global Constraints

- No new dependencies; plain DOM, no framework.
- Existing tests must pass **unchanged**: every new `StickyViewCallbacks` member is optional, and no existing toolbar label or class changes.
- Selection is per-tab, never persisted or broadcast.
- Modifiers: Shift everywhere; Cmd (`metaKey`) on Mac, Ctrl (`ctrlKey`) elsewhere. Mac Ctrl-click is not a select modifier.
- Cascade offset **30px**; grid gap **16px**; grid columns **`ceil(sqrt(n))`**.
- Bulk delete copy: `Delete N notes? This can't be undone.` with buttons **Delete** (danger) and **Cancel**.
- Positions are never negative.
- Run `npm test` and `npm run build` (typecheck) after each task.

## Review Focus

1. **Shortcuts while a dialog is open:** pressing Delete/Backspace, Esc or Ctrl/Cmd+A while the bulk-delete (or any Board) dialog is pending must do nothing to the selection. Test in Task 6.
2. **Another tab removes selected notes while the delete dialog is up:** only the notes still present are deleted, and nothing throws. Test in Task 6.
3. **A selected note is removed remotely in the middle of a group drag:** the drag ends and commits only the notes still present. Test in Task 4.
4. **A drag-box that ends without a pointerup** (pointercancel or lostpointercapture) leaves no box on screen, and the next press works normally. Test in Task 3.
5. **Typing in a note never triggers a shortcut:** Backspace/Delete/Esc/Ctrl+A with focus in a textarea keep their text meaning and leave the selection alone. Test in Task 3.

---

### Task 1: Layout maths (`src/arrange.ts`)

**Files:**
- Create: `src/arrange.ts`
- Test: `tests/arrange.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Geometry = Partial<Pick<Sticky, 'x' | 'y' | 'width' | 'height' | 'z'>>;
  export type Layout = Array<{ id: string; changes: Geometry }>;
  export interface Rect { x: number; y: number; width: number; height: number }
  export const CASCADE_OFFSET = 30;
  export const GRID_GAP = 16;
  export function cascade(sel: Sticky[], topZ: number): Layout;
  export function grid(sel: Sticky[]): Layout;
  export function alignLeft(sel: Sticky[]): Layout;
  export function alignTop(sel: Sticky[]): Layout;
  export function sameSize(sel: Sticky[]): Layout;
  export function toFront(sel: Sticky[], topZ: number): Layout;
  export function clampDelta(sel: Sticky[], dx: number, dy: number): { dx: number; dy: number };
  export function touches(r: Rect, s: Sticky): boolean;
  export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect;
  ```
  `topZ` is the board's current maximum z. Functions never mutate input. Empty `sel` returns `[]` (or `{dx, dy}` unchanged).

- [ ] **Step 1: Write the failing tests** in `tests/arrange.test.ts`, using a local `sticky(over)` factory like the one in `tests/ui/board.test.ts`:
  - `cascade keeps back-to-front order, starts at the bounding box corner, offsets 30px, stacks above topZ`: notes `a(z2, x100,y50)`, `b(z1, x300,y10)`, `c(z5, x40,y200)`, topZ 9 → `b {x40,y10,z10}`, `a {x70,y40,z11}`, `c {x100,y70,z12}`, in that order.
  - `grid orders by reading position and uses ceil(sqrt(n)) columns with the largest width/height as the cell`: 5 notes, widths up to 300, heights up to 200, min x 20, min y 30 → 3 columns; the 4th in reading order lands at `{x:20, y:30+200+16}`; the 2nd at `{x:20+300+16, y:30}`. Reading order sorts by `y`, then `x`.
  - `alignLeft sets every x to the minimum x; alignTop every y to the minimum y` (other fields absent from `changes`).
  - `sameSize gives everyone the width and height of the largest-area note (first wins a tie)`.
  - `toFront lifts the selection above topZ keeping its own order`: z 4, 1, 7 with topZ 7 → 9, 8, 10 respectively.
  - `clampDelta stops the whole group at the edge`: notes at x 5 and x 100, dx -20 → dx -5; dy unaffected when positive.
  - `touches is any overlap, edges touching do not count`: rect `{0,0,10,10}` vs note at x10 → false, x9 → true.
  - `normalizeRect handles a box dragged up-left`: `(50,60,10,20)` → `{x10,y20,width40,height40}`.

- [ ] **Step 2: Run and see them fail.** `npx vitest run tests/arrange.test.ts`: fails, module not found.

- [ ] **Step 3: Implement `src/arrange.ts`** to the interfaces above. For grid: sort a copy by `(y, x)`, `cols = Math.ceil(Math.sqrt(n))`, `cellW = max width`, `cellH = max height`, origin `(min x, min y)`, note `i` at `(origin.x + (i % cols) * (cellW + GRID_GAP), origin.y + floor(i / cols) * (cellH + GRID_GAP))`. For cascade: sort by `z` ascending, origin as grid, `z = topZ + 1 + i`.

- [ ] **Step 4: Run.** `npx vitest run tests/arrange.test.ts`: PASS. `npm run build`: no type errors.

- [ ] **Step 5: Commit** `feat: add layout maths for multi-select actions`.

---

### Task 2: StickyView selection hooks

**Files:**
- Create: `src/ui/keys.ts`
- Modify: `src/ui/stickyView.ts`, `src/styles.css`
- Test: `tests/ui/stickyView.test.ts` (new `describe('selection')` block appended; existing tests untouched), `tests/ui/keys.test.ts`

**Interfaces:**
- Produces in `src/ui/keys.ts`:
  ```ts
  export const IS_MAC: boolean; // /Mac|iPhone|iPad/.test(navigator.platform)
  export function isSelectModifier(e: MouseEvent | KeyboardEvent, mac?: boolean): boolean; // shift || (mac ? meta : ctrl)
  export function isPrimaryShortcut(e: KeyboardEvent, mac?: boolean): boolean;              // mac ? meta : ctrl
  ```
- Produces on `StickyViewCallbacks` (all **optional**):
  ```ts
  onToggleSelect?(id: string): void;
  onPlainClick?(id: string): void;
  onGroupMove?(id: string, dx: number, dy: number, phase: 'move' | 'end' | 'cancel'): void;
  ```
- Produces on `StickyView`:
  ```ts
  setSelected(selected: boolean): void; // toggles class 'selected'
  get selected(): boolean;
  preview(dx: number, dy: number): void; // sets left/top to sticky.x+dx, sticky.y+dy without reporting
  ```

Behaviour to implement:
- **Modifier press** (`button === 0`, `isSelectModifier(e)`, target not inside this note's own textarea): call `onToggleSelect`, `preventDefault()`, do **not** call `onActivate`, start no gesture. The click that follows (it carries the same modifier) is `preventDefault()`ed and ignored, so it never edits, ticks a checkbox or follows a link.
- **Selected note, plain press** on bar or body: no `onActivate` on pointerdown. A move gesture past the threshold calls `onGroupMove(id, dx, dy, 'move')` on every pointermove instead of moving its own style; pointerup calls `'end'` with the final delta; `cancelGesture` calls `'cancel'`. The view doesn't move itself; the Board calls `preview()` on each selected view. Resize on a selected note behaves as today (that note only, and it activates).
- **Plain click** that isn't on a dot/palette/× and isn't the click ending a drag or a modifier toggle: call `onPlainClick(id)` first, then carry on as today (edit, checkbox, link).
- CSS: `.sticky.selected { outline: 2px dashed var(--accent); outline-offset: 2px; }` (distinct from the solid edit outline). Keep `.sticky.editing` rules as they are.

- [ ] **Step 1: Write the failing tests.** `tests/ui/keys.test.ts`: `isSelectModifier` true for shift on both platforms, metaKey only on mac, ctrlKey only off mac; `isPrimaryShortcut` likewise. In `tests/ui/stickyView.test.ts`, a `describe('selection')` whose own `make` adds `onToggleSelect`, `onPlainClick`, `onGroupMove` mocks:
  - `shift-press toggles selection without activating, dragging or editing`: `ptr(body, 'pointerdown', …, {shiftKey})` then a shift click → `onToggleSelect('s1')` once, `onActivate` not called, no textarea.
  - `ctrl-press on a checkbox toggles selection and leaves the text alone` (mac=false env; jsdom's `navigator.platform` is empty, so ctrl counts) → `onChange` not called.
  - `shift-click inside the editing textarea does not toggle` → `onToggleSelect` not called.
  - `setSelected adds and removes the selected class`.
  - `dragging a selected note reports group moves, not its own move`: setSelected(true), pointerdown bar at (0,0), move to (30,40), up at (30,40) → `onGroupMove` called with `('s1',30,40,'move')` then `('s1',30,40,'end')`; `onChange` not called; `onActivate` not called; `el.style.left` still `100px`.
  - `lostpointercapture during a group drag reports cancel`.
  - `preview moves the element without reporting`: `preview(5,-10)` → left `105px`, top `40px`, `onChange` not called.
  - `a plain click reports onPlainClick before entering edit`; `a click ending a drag does not report onPlainClick`; `dot, palette and × clicks do not report onPlainClick`.
  - `the selected outline is drawn from .sticky.selected`: stylesheet matches `/\.sticky\.selected\s*\{[^}]*outline/`.
  (Extend the local `ptr` helper's `extra` to accept `shiftKey`, `ctrlKey`, `metaKey`.)

- [ ] **Step 2: Run and see them fail.** `npx vitest run tests/ui`: the new tests fail; the existing ones still pass.

- [ ] **Step 3: Implement** `src/ui/keys.ts` and the StickyView changes above.

- [ ] **Step 4: Run.** `npm test` all pass; `npm run build` clean.

- [ ] **Step 5: Commit** `feat: let a sticky show selection and report modifier clicks and group drags`.

---

### Task 3: Board selection: toggle, drag-box, shortcuts, selection bar shell

**Files:**
- Modify: `src/ui/board.ts`, `src/styles.css`
- Test: `tests/ui/board.test.ts` (new `describe('selection')` block)

**Interfaces:**
- Consumes: Task 2's callbacks and `setSelected`; Task 1's `touches`, `normalizeRect`; `isSelectModifier`, `isPrimaryShortcut`.
- Produces on `Board`:
  ```ts
  selectedIds(): string[];                 // public, for tests
  private selected = new Set<string>();
  private setSelection(ids: Iterable<string>): void; // updates views, bar and count
  private selectedStickies(): Sticky[];
  private ask(opts: Parameters<BoardDeps['dialog']>[0]): Promise<string>; // wraps deps.dialog, tracks this.dialogOpen
  ```
  Toolbar: after the existing buttons, a `<div class="selection-bar">` that is `hidden` while the selection is empty, containing `<span class="selection-count">N selected</span>` and a **Deselect** button. Tasks 5 and 6 add buttons to it. Route every existing `deps.dialog` call through `ask()` too.

Behaviour:
- `onToggleSelect(id)`: end any edit (blur the active textarea so the normal focusout path saves), then add/remove `id`.
- `onPlainClick(id)` and `onEditStart`: clear the selection.
- **Drag-box:** `pointerdown` on `boardEl` where `e.target === boardEl` and `button === 0`. End any edit. Remember the base selection (current set if `isSelectModifier(e)`, else empty). Coordinates are board-relative: `clientX - boardEl.getBoundingClientRect().left` (same for y). After 4px of movement, show `<div class="marquee">` positioned from `normalizeRect`, and on each move set the selection to base ∪ every note `touches` the rect. Pointerup without movement: plain → clear selection; modifier → leave it. `pointercancel`, `lostpointercapture`, or a move with `buttons === 0` remove the box and keep the selection as it stands.
- **Keys** (listener on `document`): ignore when `this.dialogOpen`, when `this.editingId !== null`, or when the event target is an `input`/`textarea`. `isPrimaryShortcut(e) && e.key === 'a'` → select all, `preventDefault`. `Escape` → clear. (Delete/Backspace come in Task 6.)
- `removeLocal` drops the id from the selection; `clearLocal` empties it.
- CSS: `.marquee { position: absolute; border: 1px solid var(--accent); background: rgba(37, 99, 235, 0.1); pointer-events: none; z-index: 999; }` (keep it under the dialog's 1000). `.selection-bar { display: flex; gap: 8px; align-items: center; margin-left: 16px; }` with `.selection-bar button` reusing the toolbar button look. `.board` needs `user-select: none` only while a box is being dragged (toggle a `selecting` class).

- [ ] **Step 1: Write the failing tests.** Add helpers for `ptr(target, type, x, y, extra)` (as in the StickyView tests) and `selectionBar(root)`. Tests:
  - `shift-clicking two notes selects both and shows "2 selected"`; shift-clicking one again deselects it.
  - `a plain click on a note clears the selection`; `Deselect clears it and hides the bar`.
  - `a drag-box selects every note it touches`: notes at (10,20) and (500,300), drag from (0,0) to (100,100) → only the first; extend to (600,400) → both (live, before pointerup); `.marquee` exists during, is removed after.
  - `a plain drag-box replaces the selection; a shift drag-box adds to it`.
  - `a click on empty board clears the selection; a shift click on empty board does not`.
  - `lostpointercapture during a drag-box removes the box and the next press works` (Review Focus 4).
  - `Ctrl+A selects all when not editing, and does nothing while a note is being edited` (Review Focus 5); `Escape clears the selection`; `Escape or Ctrl+A in a textarea leave the selection alone`.
  - `starting an edit clears the selection`; `modifier-clicking another note ends the edit in progress and saves its text`.
  - `a note removed by another tab drops out of the selection`; `a remote clear empties it` (use `board.applyRemote`).
  - `stickies are not saved just because they were selected`: store's `updatedAt` unchanged after selecting.

- [ ] **Step 2: Run and see them fail.** `npx vitest run tests/ui/board.test.ts`: new tests fail, old pass.

- [ ] **Step 3: Implement** as above.

- [ ] **Step 4: Run.** `npm test`, `npm run build`.

- [ ] **Step 5: Commit** `feat: select stickies with modifier-click, drag-box and Ctrl/Cmd+A`.

---

### Task 4: Group move

**Files:**
- Modify: `src/ui/board.ts`
- Test: `tests/ui/board.test.ts`

**Interfaces:**
- Consumes: `onGroupMove` (Task 2), `StickyView.preview`, `clampDelta` (Task 1).

Behaviour: on `'move'`, clamp the delta with `clampDelta(selectedStickies(), dx, dy)` and `preview()` each selected view. On `'end'`, clamp again and `change(id, { x: s.x + dx, y: s.y + dy }, false)` for each selected note **still in `this.notes`**, then `resize()`. On `'cancel'`, `preview(0, 0)` each. z is not changed.

- [ ] **Step 1: Write the failing tests:**
  - `dragging a selected note moves the whole selection and saves each once`: two selected notes at (10,20) and (300,40), drag one by (50,60) → stored at (60,80) and (350,100); z unchanged; unselected note untouched.
  - `a group drag stops at the edge together`: notes at x 5 and 100, drag by -20 → x 0 and 95.
  - `a group drag cancelled by lostpointercapture snaps every note back and saves nothing`.
  - `a selected note removed by another tab mid-drag is skipped on drop` (Review Focus 3): start a group drag, `applyRemote({kind:'remove', id})` for the other note, finish → no throw, the remaining note saved at its new position, the removed one not re-created in the store.
  - `dragging an unselected note clears the selection and moves only it`.

- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run `npm test`, `npm run build`.**

- [ ] **Step 5: Commit** `feat: drag a selection to move it as a group`.

---

### Task 5: Arrange, colour and export actions

**Files:**
- Modify: `src/ui/board.ts`, `src/styles.css`
- Test: `tests/ui/board.test.ts`

**Interfaces:**
- Consumes: Task 1's `cascade`, `grid`, `alignLeft`, `alignTop`, `sameSize`, `toFront`; `serializeBoard`, `exportFileName`; `COLORS`.
- Produces: `private applyLayout(layout: Layout): void` (calls `change(id, changes, false)` per entry, skipping ids no longer present).

Selection-bar buttons, in this order after the count, with these exact labels: **Cascade**, **Grid**, **Align left**, **Align top**, **Same size**, **Front**, a colour control, **Export selected**, then (Task 6) **Delete**, then **Deselect** last. The colour control is a palette button (`aria-label="Colour selected"`, `aria-expanded`, reuse `PALETTE_ICON` by exporting it from `stickyView.ts`) that reveals five `.sticky-dot sticky-dot--{color}` buttons (`aria-label="Colour {color}"`) in a `hidden` container. Picking one sets every selected note's `color` and closes the dots. Esc or a press outside closes them. Every action keeps the selection.

`topZ` for cascade and front is `this.maxZ()`.

- [ ] **Step 1: Write the failing tests** (one per button, asserting stored values through `store.get`, which proves they were saved):
  - `Cascade piles the selection diagonally above everything else` (spot-check against the Task 1 example).
  - `Grid lays the selection out in rows`; `Align left` / `Align top`; `Same size`; `Front raises the selection above unselected notes`.
  - `the colour control recolours every selected note and leaves others alone`.
  - `Export selected downloads only the selected notes` → `deps.download` called with `exportFileName(now)` and `serializeBoard([...selected])`.
  - `actions keep the selection`.

- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run `npm test`, `npm run build`.**

- [ ] **Step 5: Commit** `feat: cascade, grid, align, same size, front, colour and export for a selection`.

---

### Task 6: Bulk delete, shortcuts, README

**Files:**
- Modify: `src/ui/board.ts`, `README.md`
- Test: `tests/ui/board.test.ts`

**Interfaces:**
- Produces: `private async deleteSelected(): Promise<void>`, wired to the **Delete** bar button and to `Delete`/`Backspace` under the Task 3 key guard.

Behaviour: if any selected note has non-blank text, `ask()` with `Delete ${n} notes? This can't be undone.` (singular `Delete this note?` when n is 1, to match single delete), buttons `{id:'delete', label:'Delete', danger:true}`, `{id:'cancel', label:'Cancel'}`, `cancelId:'cancel'`. On anything but `'delete'`, stop. Then for each id captured at ask time that is still in `this.notes`: `removeLocal(id)` and `store.remove(id)`; then `resize()`. All-empty selections delete without asking.

README: add a short "Selecting several notes" section (drag a box on empty board, Shift or Ctrl/Cmd-click, Ctrl/Cmd+A; actions appear in the toolbar; Delete/Backspace deletes them).

- [ ] **Step 1: Write the failing tests:**
  - `Delete asks once for the whole selection, then removes them everywhere` (answers `['delete']`): dialog message `Delete 3 notes? This can't be undone.`; views and store entries gone; unselected note kept.
  - `cancelling bulk delete keeps everything`.
  - `a selection of empty notes deletes without asking`.
  - `Backspace and Delete delete the selection when not editing, and do nothing in a textarea`.
  - `shortcuts are ignored while a dialog is pending` (Review Focus 1): dialog mock returns a never-resolving promise; press Delete then Escape then Ctrl+A → `deps.dialog` called once, `selectedIds()` unchanged.
  - `notes removed by another tab while the dialog is up are skipped` (Review Focus 2): resolve the dialog after `applyRemote({kind:'remove'})` for one selected id → the rest deleted, no throw.
  - `Ctrl+A then Delete still asks before clearing the board` (spec anti-goal).

- [ ] **Step 2: Run, see them fail.** **Step 3: Implement + README.** **Step 4: Run `npm test`, `npm run build`.**

- [ ] **Step 5: Commit** `feat: delete a selection with one confirmation`.
