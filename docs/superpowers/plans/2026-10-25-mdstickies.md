# mdstickies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, single-page web app with a free-form board of draggable Markdown sticky notes that render when they lose focus, are saved in `localStorage`, stay in sync across tabs, and can be exported, imported and cleared.

**Architecture:** Pure logic modules (`model`, `markdown`, `format`, `store`) are framework-free and unit-tested in Node. The UI is plain DOM: `StickyView` owns one note's element, `Board` owns the collection, toolbar, persistence and cross-tab sync, and `dialog` provides in-page confirmations. Persistence uses one `localStorage` key per sticky so tabs never overwrite each other's whole board.

**Tech Stack:** Vite, TypeScript (strict), marked, DOMPurify, highlight.js, Vitest + jsdom. Node 22 / npm 9 are available in the sandbox.

**Spec:** `docs/superpowers/specs/2026-10-25-mdstickies-design.md`

## Global Constraints

- No UI framework; plain DOM + TypeScript strict mode.
- Rendered Markdown is always passed through DOMPurify before reaching the DOM.
- Data shape (persisted and exported): `{ app: "mdstickies", version: 1, stickies: Sticky[] }`, each sticky `{ id, text, x, y, width, height, color, z, createdAt, updatedAt }` with ISO-8601 timestamps.
- Export file name: `mdstickies-YYYY-MM-DD.json` (local date).
- Five pastel colours, `yellow` default: `yellow`, `pink`, `blue`, `green`, `purple`.
- Every destructive action (delete non-empty note, clear board, import replace) confirms first via the in-page dialog, never `window.confirm`.
- Text edits saved debounced (300 ms) and flushed on blur and on `pagehide`.
- Positions are never negative.
- Build must load from a GitHub Pages sub-path: Vite `base: './'`.
- Target: evergreen desktop browsers, served over http(s); `file://` is not a target.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Storage unavailable or full** (Safari private mode, quota exceeded): the app keeps working in memory and shows a visible "Couldn't save" banner instead of throwing. Test in Task 4 and Task 7.
2. **Task markers that aren't tasks**: `[ ]` inside fenced code, `~~~` fences, nested and blockquoted lists, `[X]` uppercase. Toggling the Nth rendered checkbox must change exactly the Nth real task. Test in Task 2.
3. **Malicious or junk note content**: `<script>`, `onerror=` attributes, `javascript:` links, raw `<input>` tags. They must not execute, and raw inputs must not shift checkbox numbering. Test in Task 2.
4. **Tab closed mid-typing** within the debounce window: the text is still saved. Test in Task 7.
5. **Malformed import files**: not JSON, wrong `app`, `version: 2`, a sticky with a missing or wrongly typed field, an unknown colour, negative positions. Reject with a clear message and change nothing, except that negative positions are clamped to 0. Test in Task 3.

---

## File Structure

```
index.html                 app shell (mount point #app)
vite.config.ts             base './', vitest config (jsdom env for tests/ui)
tsconfig.json
package.json
.gitignore                 node_modules, dist, .superpowers/
.github/workflows/deploy.yml
src/main.ts                bootstrap: create store, Board, start()
src/styles.css
src/model.ts               Sticky type, colours, sizes, createSticky, touch
src/markdown.ts            renderMarkdown, toggleTask
src/format.ts              serializeBoard, exportFileName, parseBoardFile, prepareAdd, ImportError
src/store.ts               StickyStore, parseStorageEvent, resolveRemote
src/ui/dialog.ts           showDialog
src/ui/stickyView.ts       StickyView
src/ui/board.ts            Board (toolbar, collection, persistence, sync)
src/ui/files.ts            downloadFile, pickFile
tests/*.test.ts            node tests for pure modules
tests/ui/*.test.ts         jsdom tests for UI
```

---

### Task 1: Scaffold and model

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/main.ts` (placeholder), `src/model.ts`
- Test: `tests/model.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'] as const;
  export type StickyColor = (typeof COLORS)[number];
  export interface Sticky {
    id: string; text: string;
    x: number; y: number; width: number; height: number;
    color: StickyColor; z: number;
    createdAt: string; updatedAt: string; // ISO-8601
  }
  export const DEFAULT_SIZE = { width: 220, height: 180 };
  export const MIN_SIZE = { width: 140, height: 100 };
  export function createSticky(at: { x: number; y: number; z: number }, now?: Date): Sticky;
  export function touch(s: Sticky, changes: Partial<Omit<Sticky, 'id' | 'createdAt'>>, now?: Date): Sticky;
  ```

- [ ] **Step 1: Initialise the repo and project**

`git init`, then `npm init -y` and `npm i -D vite typescript vitest jsdom @types/node` and `npm i marked dompurify highlight.js` (latest versions; add `@types/dompurify` only if the installed DOMPurify lacks bundled types). Scripts: `dev: vite`, `build: tsc --noEmit && vite build`, `preview: vite preview`, `test: vitest run`. `vite.config.ts` sets `base: './'` and `test.environmentMatchGlobs: [['tests/ui/**', 'jsdom']]` (or the per-file `// @vitest-environment jsdom` comment if that option is gone in the installed Vitest). `.gitignore`: `node_modules`, `dist`, `.superpowers/`.

- [ ] **Step 2: Write the failing test** (`tests/model.test.ts`)

```ts
test('createSticky uses defaults', () => {
  const now = new Date('2026-10-25T10:00:00.000Z');
  const s = createSticky({ x: 10, y: 20, z: 3 }, now);
  expect(s).toMatchObject({ text: '', x: 10, y: 20, z: 3, color: 'yellow', width: 220, height: 180,
    createdAt: now.toISOString(), updatedAt: now.toISOString() });
  expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
});
test('createSticky clamps negative positions to 0', () => {
  expect(createSticky({ x: -5, y: -1, z: 0 })).toMatchObject({ x: 0, y: 0 });
});
test('touch applies changes and strictly advances updatedAt even within the same ms', () => {
  const now = new Date('2026-10-25T10:00:00.000Z');
  const s = createSticky({ x: 0, y: 0, z: 0 }, now);
  const t = touch(s, { text: 'hi' }, now);
  expect(t.text).toBe('hi');
  expect(Date.parse(t.updatedAt)).toBe(now.getTime() + 1);
  expect(s.text).toBe(''); // immutable
});
test('touch clamps x/y and enforces MIN_SIZE', () => {
  const s = touch(createSticky({ x: 0, y: 0, z: 0 }), { x: -9, width: 10, height: 10 });
  expect(s).toMatchObject({ x: 0, width: 140, height: 100 });
});
```

- [ ] **Step 3: Run** `npx vitest run tests/model.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/model.ts`.** Use `crypto.randomUUID()`. `touch` sets `updatedAt = max(now, prev + 1 ms)` so updates always compare as strictly newer.

- [ ] **Step 5: Run** `npx vitest run tests/model.test.ts` and then `npm run build`. Expected: tests PASS, build succeeds.

- [ ] **Step 6: Commit** `chore: scaffold vite app and sticky model`.

---

### Task 2: Markdown rendering and checkbox toggling

**Files:**
- Create: `src/markdown.ts`
- Test: `tests/markdown.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  /** GFM -> sanitised HTML. Each task checkbox is <input type="checkbox" data-task-index="N"> (0-based,
   *  document order), `checked` when done, NOT disabled. Every other <input> is removed. Links get
   *  target="_blank" rel="noopener noreferrer". Fenced code is highlighted with highlight.js. */
  export function renderMarkdown(text: string): string;
  /** Flip the index-th task marker ([ ] <-> [x]); returns text unchanged if index is out of range. */
  export function toggleTask(text: string, index: number): string;
  ```

- [ ] **Step 1: Write the failing tests** (`tests/markdown.test.ts`; parse output with jsdom's `JSDOM` or use the `// @vitest-environment jsdom` comment)

```ts
test('renders GFM basics', () => {
  const html = renderMarkdown('# Hi\n\n**b** _i_\n\n| a |\n|---|\n| 1 |');
  expect(html).toContain('<h1'); expect(html).toContain('<strong>b</strong>'); expect(html).toContain('<table');
});
test('task checkboxes are numbered, enabled, and reflect state', () => {
  const doc = parse(renderMarkdown('- [ ] a\n- [x] b\n  - [X] c'));
  const boxes = [...doc.querySelectorAll('input[type=checkbox]')];
  expect(boxes.map(b => b.getAttribute('data-task-index'))).toEqual(['0', '1', '2']);
  expect(boxes.map(b => (b as HTMLInputElement).hasAttribute('checked'))).toEqual([false, true, true]);
  expect(boxes.some(b => b.hasAttribute('disabled'))).toBe(false);
});
test('code is highlighted', () => {
  expect(renderMarkdown('```js\nconst a = 1\n```')).toContain('hljs');
});
test('sanitises script, handlers and javascript: links', () => {
  const html = renderMarkdown('<script>x()</script><img src=x onerror="x()">[l](javascript:x())');
  expect(html).not.toMatch(/<script|onerror|javascript:/i);
});
test('raw <input> tags are stripped and do not shift numbering', () => {
  const doc = parse(renderMarkdown('<input type="checkbox">\n\n- [ ] real'));
  const boxes = doc.querySelectorAll('input');
  expect(boxes.length).toBe(1); expect(boxes[0].getAttribute('data-task-index')).toBe('0');
});
test('links open in a new tab', () => {
  expect(renderMarkdown('[a](https://x.y)')).toMatch(/target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"/);
});

test('toggleTask flips the Nth task', () => {
  expect(toggleTask('- [ ] a\n- [ ] b', 1)).toBe('- [ ] a\n- [x] b');
  expect(toggleTask('- [X] a', 0)).toBe('- [ ] a');
});
test('toggleTask skips markers inside ``` and ~~~ fences', () => {
  const src = '```\n- [ ] not\n```\n~~~\n- [ ] not\n~~~\n- [ ] yes';
  expect(toggleTask(src, 0)).toBe(src.replace('- [ ] yes', '- [x] yes'));
});
test('toggleTask handles nested, ordered, * and + bullets, and blockquotes', () => {
  const src = '1. [ ] a\n   * [ ] b\n> + [ ] c';
  expect(toggleTask(src, 2)).toBe('1. [ ] a\n   * [ ] b\n> + [x] c');
});
test('toggleTask out of range returns input unchanged', () => {
  expect(toggleTask('- [ ] a', 5)).toBe('- [ ] a');
});
test('toggle index matches rendered checkbox count (parity corpus)', () => {
  for (const src of CORPUS) // inline array covering every case above plus `- []`, `-[ ]`, `- [ ]` with no text
    expect(countTasks(src)).toBe(parse(renderMarkdown(src)).querySelectorAll('input').length);
});
```
(`countTasks` is a test helper: toggle each index until text stops changing.)

- [ ] **Step 2: Run** `npx vitest run tests/markdown.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/markdown.ts`.** Use `marked` with GFM. Override the `checkbox` renderer to emit the numbered input, with a counter that resets on each `renderMarkdown` call. Use a `highlight.js` code renderer (`hljs.highlight` for a known language, otherwise `highlightAuto`). Use a DOMPurify `uponSanitizeElement` hook that removes any `input` without `data-task-index`, and an `afterSanitizeAttributes` hook that adds `target`/`rel` to `a`. Configure DOMPurify once at module load.

  `toggleTask` scans line by line. It tracks fence state: a line whose content, after optional `>` prefixes and up to 3 spaces, starts with ```` ``` ```` or `~~~` opens a fence, and the same fence character closes it. Outside fences, match:
  ```ts
  /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=\s|$)/
  ```
  Count the matches. At the target count, replace the marker character: a space becomes `x`, and `x` or `X` becomes a space. If the parity test disagrees with marked on an edge case, adjust the regex to match marked's behaviour, because marked's rendering is the source of truth.

- [ ] **Step 4: Run** `npx vitest run tests/markdown.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: markdown rendering with numbered task checkboxes and toggleTask`.

---

### Task 3: Export/import file format

**Files:**
- Create: `src/format.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Consumes: `Sticky`, `COLORS`, `MIN_SIZE` from `src/model.ts`.
- Produces:
  ```ts
  export class ImportError extends Error {}
  export function serializeBoard(stickies: Sticky[]): string;            // pretty JSON, {app, version: 1, stickies}
  export function exportFileName(now?: Date): string;                    // 'mdstickies-YYYY-MM-DD.json', local date
  export function parseBoardFile(json: string): Sticky[];                // throws ImportError with a user-readable message
  export function prepareAdd(current: Sticky[], imported: Sticky[], now?: Date): Sticky[]; // fresh ids, z above current max (order preserved), updatedAt = now
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('round-trips', () => { const s = [sample()]; expect(parseBoardFile(serializeBoard(s))).toEqual(s); });
test('file name uses local date', () => { expect(exportFileName(new Date(2026, 0, 5))).toBe('mdstickies-2026-01-05.json'); });
test.each([
  ['not json', 'nope', /not a valid/i],
  ['wrong app', JSON.stringify({ app: 'x', version: 1, stickies: [] }), /not an mdstickies file/i],
  ['newer version', JSON.stringify({ app: 'mdstickies', version: 2, stickies: [] }), /newer version/i],
  ['missing field', fileWith({ ...sample(), text: undefined }), /invalid sticky/i],
  ['bad type', fileWith({ ...sample(), x: '1' }), /invalid sticky/i],
  ['unknown colour', fileWith({ ...sample(), color: 'teal' }), /invalid sticky/i],
  ['duplicate ids', fileWith(sample(), sample()), /duplicate/i],
])('rejects %s', (_n, json, msg) => { expect(() => parseBoardFile(json)).toThrow(ImportError); expect(() => parseBoardFile(json)).toThrow(msg); });
test('clamps negative positions and undersize dimensions', () => {
  expect(parseBoardFile(fileWith({ ...sample(), x: -10, y: -2, width: 5 }))[0]).toMatchObject({ x: 0, y: 0, width: 140 });
});
test('prepareAdd gives fresh ids and stacks above current', () => {
  const cur = [{ ...sample(), z: 7 }]; const imp = [{ ...sample(), z: 1 }, { ...sample(), id: 'b', z: 0 }];
  const out = prepareAdd(cur, imp);
  expect(out.every(s => s.id !== cur[0].id && s.id !== 'b')).toBe(true);
  expect(out.map(s => s.z)).toEqual([9, 8]); // relative order kept, all above 7
});
```

- [ ] **Step 2: Run** `npx vitest run tests/format.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/format.ts`.** Validate by hand: no schema library is needed for one shape. Timestamps must parse with `Date.parse`.
- [ ] **Step 4: Run** `npx vitest run tests/format.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: board export/import format with validation`.

---

### Task 4: Per-sticky storage and cross-tab merge rules

**Files:**
- Create: `src/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `Sticky` from `src/model.ts`. Validation of a single stored sticky: export `isSticky(v: unknown): v is Sticky` from `src/format.ts` (add it there and use it inside `parseBoardFile`).
- Produces:
  ```ts
  export const KEY_PREFIX = 'mdstickies:v1:sticky:';
  export const CLEARED_KEY = 'mdstickies:v1:cleared';       // value: ISO timestamp of last clear
  export class StorageFailure extends Error {}
  export class StickyStore {
    constructor(storage: Storage | null);                    // null => storage unavailable; reads return [], writes throw StorageFailure
    loadAll(): Sticky[];                                     // skips corrupt entries
    get(id: string): Sticky | undefined;
    put(s: Sticky): void;                                    // throws StorageFailure on quota/unavailable
    remove(id: string): void;
    clearAll(): void;                                        // removes all sticky keys, then writes CLEARED_KEY
  }
  export type RemoteChange =
    | { kind: 'upsert'; sticky: Sticky }
    | { kind: 'remove'; id: string }
    | { kind: 'clear' };
  export function parseStorageEvent(key: string | null, newValue: string | null): RemoteChange | null;
  export type Resolution = 'apply' | 'ignore' | 'resave-local';
  export function resolveRemote(local: Sticky | undefined, change: RemoteChange, editingId: string | null): Resolution;
  ```
- Rules for `resolveRemote` (spec, Multiple tabs):
  - `clear` → always `apply`.
  - `upsert` of the sticky being edited → `ignore` (the local edit is saved later with a newer `updatedAt`).
  - `upsert` otherwise → `apply` if there's no local copy or the remote `updatedAt` is newer, else `ignore`.
  - `remove` of the sticky being edited → `resave-local`.
  - `remove` otherwise → `apply`.
- `parseStorageEvent` rules:
  - `key === null` (another tab called `storage.clear()`) → `clear`.
  - `CLEARED_KEY` → `clear`.
  - A key with `KEY_PREFIX` and a value → `upsert`, but only if the value parses and passes `isSticky`; otherwise `null`.
  - A key with `KEY_PREFIX` and a `null` value → `remove`.
  - Any other key → `null`.

- [ ] **Step 1: Write the failing tests.** Use a `FakeStorage` implementing `Storage` over a `Map`, with a `failWrites` flag that throws a `DOMException('QuotaExceededError')`.

```ts
test('put/get/loadAll round-trip, one key per sticky', ...);           // storage has key KEY_PREFIX+id
test('loadAll skips corrupt entries and foreign keys', ...);
test('put throws StorageFailure when quota exceeded', ...);
test('null storage: loadAll is [], put throws StorageFailure', ...);
test('clearAll removes sticky keys only and writes CLEARED_KEY', ...);
test('two stores on one storage do not clobber each other', () => {
  const st = new FakeStorage(); const a = new StickyStore(st), b = new StickyStore(st);
  a.put(s1); b.put(s2); expect(new StickyStore(st).loadAll().map(s => s.id).sort()).toEqual([s1.id, s2.id].sort());
});
test.each([...])('parseStorageEvent %s', ...);     // one row per rule above
test.each([
  ['clear',                     undefined, { kind: 'clear' },                 null,  'apply'],
  ['upsert new',                undefined, { kind: 'upsert', sticky: newer }, null,  'apply'],
  ['upsert newer',              older,     { kind: 'upsert', sticky: newer }, null,  'apply'],
  ['upsert older',              newer,     { kind: 'upsert', sticky: older }, null,  'ignore'],
  ['upsert while editing',      older,     { kind: 'upsert', sticky: newer }, ID,    'ignore'],
  ['remove',                    older,     { kind: 'remove', id: ID },        null,  'apply'],
  ['remove while editing',      older,     { kind: 'remove', id: ID },        ID,    'resave-local'],
])('resolveRemote %s', (_n, local, change, editing, want) => expect(resolveRemote(local, change, editing)).toBe(want));
```

- [ ] **Step 2: Run** `npx vitest run tests/store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/store.ts`.** In `main.ts` (Task 7), detect storage by wrapping `window.localStorage` access in try/catch; this module just accepts `Storage | null`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: per-sticky localStorage store and cross-tab merge rules`.

---

### Task 5: In-page dialog

**Files:**
- Create: `src/ui/dialog.ts`, dialog styles in `src/styles.css`
- Test: `tests/ui/dialog.test.ts` (jsdom)

**Interfaces:**
- Produces:
  ```ts
  export interface DialogButton { id: string; label: string; danger?: boolean }
  export function showDialog(opts: { message: string; buttons: DialogButton[]; cancelId: string }): Promise<string>;
  ```
  Uses a `<div role="dialog" aria-modal="true">` with a backdrop. Resolves with the clicked button's id. Escape or a backdrop click resolves with `cancelId`. The first non-danger button gets focus. The dialog removes itself afterwards.

- [ ] **Step 1: Write the failing tests:** `resolves with clicked button id`, `Escape resolves cancelId`, `backdrop click resolves cancelId`, `removes itself from the DOM after resolving`, `renders buttons in order with labels`.
- [ ] **Step 2: Run** `npx vitest run tests/ui/dialog.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/ui/dialog.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: in-page confirmation dialog`.

---

### Task 6: StickyView (one note's element)

**Files:**
- Create: `src/ui/stickyView.ts`, sticky styles in `src/styles.css`
- Test: `tests/ui/stickyView.test.ts` (jsdom)

**Interfaces:**
- Consumes: `Sticky`, `COLORS`, `MIN_SIZE` (model); `renderMarkdown`, `toggleTask` (markdown).
- Produces:
  ```ts
  export interface StickyViewCallbacks {
    onChange(id: string, changes: Partial<Pick<Sticky, 'text' | 'x' | 'y' | 'width' | 'height' | 'color'>>, opts: { debounce: boolean }): void;
    onActivate(id: string): void;        // pointerdown / focus anywhere on the note -> Board brings to front
    onEditStart(id: string): void;
    onEditEnd(id: string): void;         // focus left the note
    onDeleteRequest(id: string): void;   // Board decides whether to confirm
  }
  export class StickyView {
    readonly el: HTMLElement;            // .sticky, absolutely positioned, data-id
    constructor(sticky: Sticky, cb: StickyViewCallbacks);
    update(sticky: Sticky): void;        // apply position/size/colour/z; re-render body unless editing (textarea value untouched while editing)
    edit(): void;                        // switch to textarea, focus it, caret at end
    get editing(): boolean;
  }
  ```
- Structure: a top bar (`.sticky-bar`: drag handle area, colour dots, × button), a body (`.sticky-body`: rendered HTML, or a `<textarea>` when editing), and a resize handle at the bottom right (`.sticky-resize`).

- [ ] **Step 1: Write the failing tests**

```ts
test('renders markdown when not editing', ...);                       // body innerHTML contains <h2> for '## x'
test('click on rendered body enters edit mode with raw text', ...);   // textarea.value === sticky.text, onEditStart called
test('typing calls onChange({text}, {debounce:true})', ...);
test('focusout to outside the note ends editing and renders the latest text', ...); // onEditEnd called; body shows rendered input text
test('focusout to a control inside the note keeps editing', ...);     // e.g. clicking a colour dot (relatedTarget inside el)
test('Escape in textarea ends editing', ...);
test('clicking a rendered checkbox calls onChange with toggled text and does not enter edit mode', () => {
  // sticky.text '- [ ] a\n- [ ] b'; click input[data-task-index="1"]
  // expect onChange(id, { text: '- [ ] a\n- [x] b' }, { debounce: false }); expect(view.editing).toBe(false)
});
test('clicking a link does not enter edit mode', ...);
test('colour dot click calls onChange({color})', ...);
test('× calls onDeleteRequest', ...);
test('dragging the bar moves the note and reports x/y once on pointerup, clamped >= 0', ...); // dispatch pointerdown/move/up
test('rendered body drag beyond 4px moves instead of entering edit mode', ...);
test('resize handle reports width/height, not below MIN_SIZE', ...);
test('update() while editing does not overwrite the textarea', ...);
```

- [ ] **Step 2: Run** `npx vitest run tests/ui/stickyView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use pointer events with `setPointerCapture`. During a drag or resize, move `el.style` live and call `onChange` once on `pointerup` with `{ debounce: false }`. Decide between a click and a drag on the rendered body with a 4 px threshold. Edit mode ends on `focusout` when `relatedTarget` is outside `el`. Checkbox clicks: call `preventDefault()`, then `onChange` with `toggleTask(text, index)`. Board then calls `update()` with the new sticky, and that re-renders the note.
- [ ] **Step 4: Run** `npx vitest run tests/ui/stickyView.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sticky view with edit/render, checkbox toggle, drag, resize, colour, delete`.

---

### Task 7: Board, toolbar, persistence, sync, app shell

**Files:**
- Create: `src/ui/board.ts`, `src/ui/files.ts`, `src/styles.css` (board and toolbar styles)
- Modify: `src/main.ts`, `index.html`
- Test: `tests/ui/board.test.ts` (jsdom)

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  // files.ts
  export function downloadFile(name: string, content: string): void;   // Blob + temporary <a download>
  export function pickFile(): Promise<string | null>;                   // hidden <input type=file accept=".json,application/json">; null if cancelled
  // board.ts
  export interface BoardDeps {
    dialog: typeof showDialog; download: typeof downloadFile; pickFile: typeof pickFile; now?: () => Date;
  }
  export class Board {
    constructor(root: HTMLElement, store: StickyStore, deps: BoardDeps);
    start(): void;                    // render toolbar + board, load from store, listen for 'storage' and 'pagehide'
    newSticky(): Sticky;              // centre of visible area, z = max+1, enters edit mode
    exportBoard(): void;
    importBoard(): Promise<void>;
    clearBoard(): Promise<void>;
    applyRemote(change: RemoteChange): void;  // used by the storage listener; called directly in tests
    flush(): void;                    // write any pending debounced text now
    stickies(): Sticky[];
  }
  ```
- Behaviour:
  - **Toolbar:** buttons **New**, **Export**, **Import**, **Clear board**.
  - **Saving:**
    - Every `onChange` goes through `touch()`, then `store.put()` immediately, or after 300 ms for text.
    - `onActivate` raises the note to the front: `z = max + 1`, which is saved.
    - `onEditEnd` flushes the note. Then, if `store.get(id)` is newer than the local copy, it adopts the stored version (the spec's "newest wins once both have saved").
  - **Save failures:** a `StorageFailure` shows a dismissible banner: "Couldn't save — your browser storage is full or unavailable. Export to keep a copy." The note stays in memory.
  - **Delete:** an empty note (`text.trim() === ''`) is removed without asking. Otherwise the dialog asks "Delete this note?" with **Delete** (danger) and **Cancel**.
  - **Clear board:** asks "Delete all N notes? This can't be undone." with **Clear board** (danger) and **Cancel**, then calls `store.clearAll()`.
  - **Export:** calls `download(exportFileName(), serializeBoard(stickies()))`.
  - **Import:**
    - A parse error shows the dialog with the `ImportError` message and an **OK** button, and changes nothing.
    - On an empty board, the imported notes are loaded directly.
    - Otherwise the dialog asks "Import N notes. Replace your current board or add them?" with **Replace** (danger), **Add** and **Cancel**.
    - Replace: `clearAll()`, then put each imported sticky.
    - Add: `prepareAdd`, then put each one.
  - **Remote changes:** `applyRemote` follows `resolveRemote`, with `editingId` set to the id of the note currently being edited.
    - `apply`: upsert or remove the view, or clear everything.
    - `resave-local`: `store.put(local)`.
  - **Board size:** the board grows to `max(viewport, furthest note right/bottom edge + 200px)`.
  - **Page close:** on `pagehide`, call `flush()`.
  - **`main.ts`:** gets `localStorage` inside a try/catch (falling back to `null`), creates `new Board(document.getElementById('app')!, new StickyStore(storage), { dialog: showDialog, download: downloadFile, pickFile })` and calls `.start()`.

- [ ] **Step 1: Write the failing tests.** Use a `FakeStorage` and fake deps: `dialog` resolves with a preset answer, `download` records its arguments, and `pickFile` resolves with preset JSON. Use fake timers.

```ts
test('start loads saved stickies into views', ...);
test('New creates a sticky, saves it, and puts it in edit mode', ...);
test('text edits save after 300ms debounce', ...);
test('pagehide flushes pending text immediately', ...);                         // Review Focus 4
test('checkbox toggle persists without debounce', ...);
test('activating a note raises its z above all others and saves', ...);
test('deleting an empty note skips the dialog; non-empty asks, Cancel keeps it', ...);
test('Clear board: Cancel keeps all, Clear removes all from DOM and storage', ...);
test('Export downloads mdstickies-YYYY-MM-DD.json with serialized board', ...);
test('Import into empty board loads without asking', ...);
test('Import Replace / Add / Cancel', ...);                                     // three cases
test('Import of invalid file shows error and changes nothing', ...);
test('storage failure shows the banner and keeps the note in memory', ...);    // Review Focus 1
test('null storage: app still works in memory with banner on first save', ...);
test('applyRemote upsert adds/updates a view; remove deletes it; clear empties board', ...);
test('applyRemote upsert for the note being edited leaves the textarea alone; on edit end the newer stored version wins', ...);
test('applyRemote remove for the note being edited re-saves it', ...);
test('two Boards on one FakeStorage converge when each forwards its changes to the other via applyRemote', ...);
```

- [ ] **Step 2: Run** `npx vitest run tests/ui/board.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `files.ts`, `board.ts`, `main.ts`, `index.html` (`<div id="app">` and the module script) and `styles.css`. For styles: pastel paper notes with a soft shadow, a clear focus outline while editing, a monospace textarea, and `pre code` styled by a highlight.js theme imported in `main.ts` (e.g. `highlight.js/styles/github.css`).
- [ ] **Step 4: Run** `npm test` and `npm run build`. Expected: all PASS, build succeeds.
- [ ] **Step 5: Manual check.** Run `npm run dev -- --host 0.0.0.0` (the user publishes the port from the host with `sbx ports claude-mdstickies --publish 5173:5173/tcp`). Check each of these in a browser:
  - Create a note, edit it, click away and see it render.
  - Tick a checkbox.
  - Drag and resize a note.
  - Reload and see the notes come back.
  - Open a second tab, edit in one tab and see the change in the other.
  - Export, Clear and Import.
- [ ] **Step 6: Commit** `feat: board with toolbar, persistence, cross-tab sync, export/import/clear`.

---

### Task 8: GitHub Pages deployment

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`

- [ ] **Step 1: Write the workflow.** Trigger on `push` to `main` and on `workflow_dispatch`. Permissions: `pages: write`, `id-token: write` and `contents: read`. Job steps:
  1. `actions/checkout`
  2. `actions/setup-node` (Node 22, npm cache)
  3. `npm ci`
  4. `npm test`
  5. `npm run build`
  6. `actions/configure-pages`
  7. `actions/upload-pages-artifact` (path `dist`)
  8. `actions/deploy-pages` (deploy job with the `github-pages` environment)
- [ ] **Step 2: Verify the build works from a sub-path.** Run `npm run build && grep -E '(src|href)="/' dist/index.html`. Expected: no matches, so all asset URLs are relative. Then serve `dist` under a sub-path (`mkdir -p /tmp/claude-1000/pages && cp -r dist /tmp/claude-1000/pages/mdstickies && npx serve /tmp/claude-1000/pages` or `python3 -m http.server`). Check that `/mdstickies/` loads and its assets return 200 (`curl -sI`).
- [ ] **Step 3: Write `README.md`.** Include what the app is, `npm i` / `npm run dev` / `npm test`, and the GitHub Pages setup (Settings → Pages → Source: GitHub Actions). Add a note that notes live only in the visitor's own browser.
- [ ] **Step 4: Commit** `ci: deploy to GitHub Pages`.
