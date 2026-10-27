// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Board, type BoardDeps } from '../../src/ui/board';
import { StickyStore, KEY_PREFIX, parseStorageEvent } from '../../src/store';
import { serializeBoard, exportFileName } from '../../src/format';
import type { Sticky } from '../../src/model';
import { FakeStorage } from '../helpers/fakeStorage';

const BANNER = "Couldn't save — your browser storage is full or unavailable. Export to keep a copy.";

function sticky(over: Partial<Sticky> = {}): Sticky {
  return {
    id: 's1', text: 'hello', x: 10, y: 20, width: 220, height: 180, color: 'yellow', z: 1,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...over,
  };
}

function setup(opts: { saved?: Sticky[]; storage?: Storage | null; answers?: string[]; file?: string | null; dialog?: BoardDeps['dialog'] } = {}) {
  const storage = opts.storage === undefined ? new FakeStorage() : opts.storage;
  const store = new StickyStore(storage);
  for (const s of opts.saved ?? []) store.put(s);
  const answers = [...(opts.answers ?? [])];
  const deps = {
    dialog: vi.fn(opts.dialog ?? (async () => answers.shift() ?? 'cancel')),
    download: vi.fn(),
    pickFile: vi.fn(async () => (opts.file === undefined ? null : opts.file)),
  } satisfies BoardDeps;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const board = new Board(root, store, deps);
  board.start();
  return { board, store, storage, deps, root };
}

const views = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.sticky')];
const viewOf = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`.sticky[data-id="${id}"]`)!;
const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('.toolbar button')].find((b) => b.textContent === label)!;
const banners = (root: HTMLElement) => root.querySelectorAll('.banner');
const toast = (root: HTMLElement) => root.querySelector<HTMLElement>('.toast')!;
const undo = (root: HTMLElement) => toast(root).querySelector<HTMLButtonElement>('.toast-action')!.click();
const settle = () => vi.advanceTimersByTimeAsync(0);

function type(root: HTMLElement, id: string, text: string) {
  const ta = viewOf(root, id).querySelector('textarea')!;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function endEdit(root: HTMLElement, id: string) {
  viewOf(root, id).querySelector('textarea')!
    .dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
}
function pointerdown(el: Element) {
  const init = { bubbles: true, cancelable: true, clientX: 0, clientY: 0 };
  el.dispatchEvent(typeof PointerEvent !== 'undefined' ? new PointerEvent('pointerdown', init) : new MouseEvent('pointerdown', init));
}

const docKeyListeners: Array<[string, EventListener]> = [];
const realAdd = document.addEventListener.bind(document);
document.addEventListener = ((type: string, fn: EventListener, o?: unknown) => {
  if (type === 'keydown' || type === 'paste') docKeyListeners.push([type, fn]);
  realAdd(type, fn, o as AddEventListenerOptions);
}) as typeof document.addEventListener;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
});
afterEach(() => {
  for (const [type, fn] of docKeyListeners.splice(0)) document.removeEventListener(type, fn); // boards from earlier tests stay alive
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Board', () => {
  it('start loads saved stickies into views', () => {
    const { board, root } = setup({ saved: [sticky({ id: 'a' }), sticky({ id: 'b', x: 500, y: 300 })] });
    expect(views(root).map((v) => v.dataset.id).sort()).toEqual(['a', 'b']);
    expect(board.stickies()).toHaveLength(2);
    expect(['New', 'Export', 'Import', 'Clear board'].every((l) => button(root, l))).toBe(true);
    const el = root.querySelector<HTMLElement>('.board')!;
    expect(el.style.minWidth).toBe(`${500 + 220 + 200}px`);
    expect(el.style.minHeight).toBe(`${300 + 180 + 200}px`);
  });

  it('New creates a sticky, saves it, and puts it in edit mode', () => {
    const { store, root } = setup({ saved: [sticky({ id: 'a', z: 7 })] });
    button(root, 'New').click();
    const created = views(root).find((v) => v.dataset.id !== 'a')!;
    const s = store.get(created.dataset.id!)!;
    expect(s).toBeDefined();
    expect(s.z).toBe(8);
    expect(s.x).toBe(Math.max(0, window.scrollX + window.innerWidth / 2 - 110));
    expect(s.y).toBe(Math.max(0, window.scrollY + window.innerHeight / 2 - 90));
    expect(created.querySelector('textarea')).not.toBeNull();
    expect(document.activeElement).toBe(created.querySelector('textarea'));
  });

  it('text edits save after 300ms debounce', () => {
    const { board, store, root } = setup();
    const s = board.newSticky();
    type(root, s.id, 'hel');
    vi.advanceTimersByTime(200);
    type(root, s.id, 'hello');
    vi.advanceTimersByTime(299);
    expect(store.get(s.id)!.text).toBe('');
    expect(board.stickies()[0].text).toBe('hello');
    vi.advanceTimersByTime(1);
    expect(store.get(s.id)!.text).toBe('hello');
  });

  it('pagehide flushes pending text immediately', () => {
    const { board, store, root } = setup();
    const s = board.newSticky();
    type(root, s.id, 'unsaved');
    window.dispatchEvent(new Event('pagehide'));
    expect(store.get(s.id)!.text).toBe('unsaved');
  });

  it('checkbox toggle persists without debounce', () => {
    const { store, root } = setup({ saved: [sticky({ id: 'a', text: '- [ ] one' })] });
    viewOf(root, 'a').querySelector<HTMLElement>('input[data-task-index="0"]')!.click();
    expect(store.get('a')!.text).toBe('- [x] one');
    expect(viewOf(root, 'a').querySelector<HTMLInputElement>('input[data-task-index="0"]')!.checked).toBe(true);
  });

  it('activating a note raises its z above all others and saves', () => {
    const { store, root } = setup({
      saved: [sticky({ id: 'a', z: 1 }), sticky({ id: 'b', z: 5 }), sticky({ id: 'c', z: 3 })],
    });
    pointerdown(viewOf(root, 'a').querySelector('.sticky-body')!);
    expect(store.get('a')!.z).toBe(6);
    expect(viewOf(root, 'a').style.zIndex).toBe('6');
  });

  it('deleting a note removes it at once without asking; Undo puts it back', async () => {
    const saved = sticky({ id: 'full', text: 'keep me', x: 40, y: 60, color: 'pink', z: 3 });
    const { store, root, deps } = setup({ saved: [saved] });
    viewOf(root, 'full').querySelector<HTMLElement>('.sticky-delete')!.click();
    await settle();
    expect(deps.dialog).not.toHaveBeenCalled();
    expect(viewOf(root, 'full')).toBeNull();
    expect(store.get('full')).toBeUndefined();
    expect(toast(root).hidden).toBe(false);
    expect(toast(root).textContent).toContain('Note deleted');

    undo(root);
    expect(viewOf(root, 'full')).not.toBeNull();
    expect(store.get('full')).toEqual(saved);
    expect(toast(root).hidden).toBe(true);
  });

  it('deleting an empty note offers no undo', () => {
    const { store, root } = setup({ saved: [sticky({ id: 'empty', text: '  \n ' })] });
    viewOf(root, 'empty').querySelector<HTMLElement>('.sticky-delete')!.click();
    expect(viewOf(root, 'empty')).toBeNull();
    expect(store.get('empty')).toBeUndefined();
    expect(toast(root).hidden).toBe(true);
  });

  it('Clear board: Cancel keeps all, Clear removes all from DOM and storage', async () => {
    const { board, store, root, deps } = setup({
      saved: [sticky({ id: 'a' }), sticky({ id: 'b' })],
      answers: ['cancel', 'clear'],
    });
    button(root, 'Clear board').click();
    await settle();
    expect(deps.dialog).toHaveBeenCalledWith({
      message: 'Delete all 2 notes?',
      buttons: [{ id: 'clear', label: 'Clear board', danger: true }, { id: 'cancel', label: 'Cancel' }],
      cancelId: 'cancel',
    });
    expect(views(root)).toHaveLength(2);
    expect(store.loadAll()).toHaveLength(2);

    await board.clearBoard();
    expect(views(root)).toHaveLength(0);
    expect(board.stickies()).toEqual([]);
    expect(store.loadAll()).toEqual([]);
    expect(toast(root).textContent).toContain('Board cleared');

    undo(root);
    expect(views(root)).toHaveLength(2);
    expect(store.loadAll().map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('Export downloads mdstickies-YYYY-MM-DD.json with serialized board', () => {
    const { board, root, deps } = setup({ saved: [sticky({ id: 'a' })] });
    button(root, 'Export').click();
    expect(deps.download).toHaveBeenCalledWith(exportFileName(new Date()), serializeBoard(board.stickies()));
    expect(deps.download.mock.calls[0][0]).toMatch(/^mdstickies-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('Import into empty board loads without asking', async () => {
    const file = serializeBoard([sticky({ id: 'x' }), sticky({ id: 'y' })]);
    const { board, store, root, deps } = setup({ file });
    await board.importBoard();
    expect(deps.dialog).not.toHaveBeenCalled();
    expect(board.stickies().map((s) => s.id).sort()).toEqual(['x', 'y']);
    expect(views(root)).toHaveLength(2);
    expect(store.loadAll().map((s) => s.id).sort()).toEqual(['x', 'y']);
  });

  describe('Import Replace / Add / Cancel', () => {
    const file = serializeBoard([sticky({ id: 'x', z: 1 }), sticky({ id: 'y', z: 2 })]);
    const existing = () => [sticky({ id: 'c', z: 4 })];
    const prompt = {
      message: 'Import 2 notes. Replace your current board or add them?',
      buttons: [
        { id: 'replace', label: 'Replace', danger: true },
        { id: 'add', label: 'Add' },
        { id: 'cancel', label: 'Cancel' },
      ],
      cancelId: 'cancel',
    };

    it('Replace swaps the board for the imported notes', async () => {
      const { board, store, root, deps } = setup({ saved: existing(), file, answers: ['replace'] });
      await board.importBoard();
      expect(deps.dialog).toHaveBeenCalledWith(prompt);
      expect(board.stickies().map((s) => s.id).sort()).toEqual(['x', 'y']);
      expect(views(root).map((v) => v.dataset.id).sort()).toEqual(['x', 'y']);
      expect(store.loadAll().map((s) => s.id).sort()).toEqual(['x', 'y']);
    });

    it('Add keeps the board and adds copies with new ids above it', async () => {
      const { board, store, root } = setup({ saved: existing(), file, answers: ['add'] });
      await board.importBoard();
      const added = board.stickies().filter((s) => s.id !== 'c');
      expect(added).toHaveLength(2);
      expect(added.some((s) => s.id === 'x' || s.id === 'y')).toBe(false);
      expect(added.map((s) => s.z).sort()).toEqual([5, 6]);
      expect(views(root)).toHaveLength(3);
      expect(store.loadAll()).toHaveLength(3);
    });

    it('Cancel changes nothing', async () => {
      const { board, store, root } = setup({ saved: existing(), file, answers: ['cancel'] });
      await board.importBoard();
      expect(board.stickies().map((s) => s.id)).toEqual(['c']);
      expect(views(root)).toHaveLength(1);
      expect(store.loadAll().map((s) => s.id)).toEqual(['c']);
    });
  });

  it('Import of invalid file shows error and changes nothing', async () => {
    const { board, store, root, deps } = setup({ saved: [sticky({ id: 'c' })], file: 'not json', answers: ['ok'] });
    await board.importBoard();
    expect(deps.dialog).toHaveBeenCalledWith({
      message: 'This file is not a valid JSON file.',
      buttons: [{ id: 'ok', label: 'OK' }],
      cancelId: 'ok',
    });
    expect(board.stickies().map((s) => s.id)).toEqual(['c']);
    expect(views(root)).toHaveLength(1);
    expect(store.loadAll().map((s) => s.id)).toEqual(['c']);
  });

  it('Import failing for a non-ImportError shows a generic dialog instead of rejecting', async () => {
    const { board, root, deps } = setup({ saved: [sticky({ id: 'c' })], answers: ['ok'] });
    deps.pickFile.mockRejectedValueOnce(new Error('read failed'));
    await board.importBoard();
    expect(deps.dialog).toHaveBeenCalledWith({
      message: "Couldn't read that file.",
      buttons: [{ id: 'ok', label: 'OK' }],
      cancelId: 'ok',
    });
    expect(views(root)).toHaveLength(1);
  });

  it('storage failure shows the banner and keeps the note in memory', () => {
    const storage = new FakeStorage();
    const { board, root } = setup({ storage });
    storage.failWrites = true;
    const s = board.newSticky();
    expect(board.stickies().map((x) => x.id)).toEqual([s.id]);
    expect(banners(root)).toHaveLength(1);
    expect(banners(root)[0].textContent).toContain(BANNER);

    board.newSticky(); // second failure doesn't stack a second banner
    expect(banners(root)).toHaveLength(1);

    root.querySelector<HTMLElement>('.banner-dismiss')!.click();
    expect(banners(root)).toHaveLength(0);
  });

  it('null storage: app still works in memory with banner on first save', () => {
    const { board, root } = setup({ storage: null });
    expect(banners(root)).toHaveLength(0);
    const s = board.newSticky();
    expect(banners(root)).toHaveLength(1);
    type(root, s.id, 'still here');
    vi.advanceTimersByTime(300);
    endEdit(root, s.id);
    expect(board.stickies()[0].text).toBe('still here');
    expect(viewOf(root, s.id).querySelector('.sticky-body')!.textContent).toContain('still here');
  });

  it('applyRemote upsert adds/updates a view; remove deletes it; clear empties board', () => {
    const { board, store, root } = setup({ saved: [sticky({ id: 'a' })] });
    board.applyRemote({ kind: 'upsert', sticky: sticky({ id: 'b', x: 900 }) });
    expect(viewOf(root, 'b').style.left).toBe('900px');
    expect(root.querySelector<HTMLElement>('.board')!.style.minWidth).toBe(`${900 + 220 + 200}px`);

    board.applyRemote({ kind: 'upsert', sticky: sticky({ id: 'b', x: 40, updatedAt: '2026-10-02T00:00:00.000Z' }) });
    expect(viewOf(root, 'b').style.left).toBe('40px');

    board.applyRemote({ kind: 'remove', id: 'b' });
    expect(viewOf(root, 'b')).toBeNull();

    // A pending text save must not resurrect anything after a remote clear.
    const s = board.newSticky();
    type(root, s.id, 'pending');
    board.applyRemote({ kind: 'clear' });
    expect(views(root)).toHaveLength(0);
    expect(board.stickies()).toEqual([]);
    store.remove('a');
    store.remove(s.id);
    vi.advanceTimersByTime(1000);
    expect(store.loadAll()).toEqual([]);
  });

  it('a window storage event is applied as a remote change', () => {
    const { root } = setup();
    const s = sticky({ id: 'r' });
    window.dispatchEvent(new StorageEvent('storage', { key: KEY_PREFIX + 'r', newValue: JSON.stringify(s) }));
    expect(viewOf(root, 'r')).not.toBeNull();
  });

  it('applyRemote upsert for the note being edited leaves the textarea alone; on edit end the newer stored version wins', () => {
    const { board, store, root } = setup();
    const s = board.newSticky();
    type(root, s.id, 'mine');
    vi.advanceTimersByTime(100);
    const theirs = { ...store.get(s.id)!, text: 'theirs', updatedAt: new Date(Date.now() + 50).toISOString() };
    store.put(theirs); // the other tab's save
    board.applyRemote({ kind: 'upsert', sticky: theirs });
    expect(viewOf(root, s.id).querySelector('textarea')!.value).toBe('mine');

    vi.advanceTimersByTime(100);
    endEdit(root, s.id);
    expect(board.stickies()[0].text).toBe('theirs');
    expect(store.get(s.id)!.text).toBe('theirs');
    expect(viewOf(root, s.id).querySelector('.sticky-body')!.textContent).toContain('theirs');
    vi.advanceTimersByTime(1000);
    expect(store.get(s.id)!.text).toBe('theirs');
  });

  describe('a pending text save never overwrites a newer stored copy', () => {
    // Our keystroke at t0, the other tab's save at t0+100 (ignored while editing), then our pending save fires.
    function race() {
      const ctx = setup();
      const s = ctx.board.newSticky();
      type(ctx.root, s.id, 'mine');
      vi.advanceTimersByTime(100);
      const theirs = { ...ctx.store.get(s.id)!, text: 'theirs', color: 'pink' as const, updatedAt: new Date().toISOString() };
      ctx.store.put(theirs);
      ctx.board.applyRemote({ kind: 'upsert', sticky: theirs });
      return { ...ctx, s, theirs };
    }

    it('when the debounce timer fires', () => {
      const { board, store, root, s, theirs } = race();
      vi.advanceTimersByTime(300);
      expect(store.get(s.id)).toEqual(theirs);
      expect(viewOf(root, s.id).querySelector('textarea')!.value).toBe('mine'); // still editing: left alone
      endEdit(root, s.id);
      expect(board.stickies()[0]).toEqual(theirs);
      expect(store.get(s.id)).toEqual(theirs);
    });

    it('when pagehide flushes', () => {
      const { store, s, theirs } = race();
      window.dispatchEvent(new Event('pagehide'));
      expect(store.get(s.id)).toEqual(theirs);
    });

    it('but typing after the remote save wins', () => {
      const { store, root, s } = race();
      vi.advanceTimersByTime(10);
      type(root, s.id, 'mine, later');
      vi.advanceTimersByTime(300);
      expect(store.get(s.id)!.text).toBe('mine, later');
    });
  });

  it('applyRemote remove for the note being edited re-saves it', () => {
    const { board, store, root } = setup();
    const s = board.newSticky();
    type(root, s.id, 'keep typing');
    store.remove(s.id); // the other tab's delete
    board.applyRemote({ kind: 'remove', id: s.id });
    expect(store.get(s.id)!.text).toBe('keep typing');
    expect(viewOf(root, s.id)).not.toBeNull();
  });

  it('two Boards on one FakeStorage converge when each forwards its changes to the other via applyRemote', async () => {
    const shared = new FakeStorage();
    const queue: Array<() => void> = [];
    const boards: Board[] = [];
    // Each "tab" sees the shared storage; its writes are delivered (later) to the other tab only.
    const tab = (self: number): Storage => ({
      get length() { return shared.length; },
      key: (i) => shared.key(i),
      getItem: (k) => shared.getItem(k),
      setItem: (k, v) => { shared.setItem(k, v); queue.push(() => deliver(self, k, v)); },
      removeItem: (k) => { shared.removeItem(k); queue.push(() => deliver(self, k, null)); },
      clear: () => shared.clear(),
    });
    const deliver = (from: number, k: string, v: string | null) => {
      const change = parseStorageEvent(k, v);
      if (change) boards[1 - from].applyRemote(change);
    };
    const pump = () => { while (queue.length) queue.shift()!(); };

    const a = setup({ storage: tab(0) });
    const b = setup({ storage: tab(1) });
    boards.push(a.board, b.board);
    const same = () => {
      const sorted = (xs: Sticky[]) => [...xs].sort((p, q) => p.id.localeCompare(q.id));
      expect(sorted(a.board.stickies())).toEqual(sorted(b.board.stickies()));
      expect(sorted(a.board.stickies())).toEqual(sorted(new StickyStore(shared).loadAll()));
    };

    const n = a.board.newSticky();
    type(a.root, n.id, 'from A');
    vi.advanceTimersByTime(300);
    endEdit(a.root, n.id);
    const m = b.board.newSticky();
    pump();
    same();
    expect(viewOf(b.root, n.id).querySelector('.sticky-body')!.textContent).toContain('from A');

    // Concurrent: B edits m while A recolours it; A's save is newer, so it wins on B's edit end.
    type(b.root, m.id, 'from B');
    vi.advanceTimersByTime(300);
    pump();
    vi.advanceTimersByTime(10);
    viewOf(a.root, m.id).querySelector<HTMLElement>('.sticky-dot--pink')!.click();
    pump();
    expect(viewOf(b.root, m.id).querySelector('textarea')!.value).toBe('from B');
    endEdit(b.root, m.id);
    pump();
    same();
    expect(b.board.stickies().find((s) => s.id === m.id)!.color).toBe('pink');

    viewOf(a.root, n.id).querySelector<HTMLElement>('.sticky-delete')!.click();
    await settle();
    pump();
    same();
    expect(viewOf(b.root, n.id)).toBeNull();

    a.board.newSticky();
    pump();
    b.deps.dialog.mockResolvedValueOnce('clear');
    await b.board.clearBoard();
    pump();
    same();
    expect(a.board.stickies()).toEqual([]);
  });
});

function ptr(target: Element, type: string, x: number, y: number, extra: { button?: number; buttons?: number; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) {
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, ...extra };
  target.dispatchEvent(
    typeof PointerEvent !== 'undefined' ? new PointerEvent(type, init) : new MouseEvent(type, init),
  );
}
const selectionBar = (root: HTMLElement) => root.querySelector<HTMLElement>('.selection-bar')!;
const boardEl = (root: HTMLElement) => root.querySelector<HTMLElement>('.board')!;
const bar = (root: HTMLElement, id: string) => viewOf(root, id).querySelector<HTMLElement>('.sticky-bar')!;
const shiftClick = (root: HTMLElement, id: string) => ptr(bar(root, id), 'pointerdown', 5, 5, { shiftKey: true });
const key = (target: EventTarget, k: string, extra: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(e);
  return e;
};
const two = () => setup({ saved: [sticky({ id: 'a' }), sticky({ id: 'b', x: 500, y: 300 })] });
const sorted = (b: Board) => b.selectedIds().sort();

describe('selection', () => {
  it('shift-clicking two notes selects both and shows "2 selected"; again deselects', () => {
    const { board, root } = two();
    expect(selectionBar(root).hidden).toBe(true);
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    expect(sorted(board)).toEqual(['a', 'b']);
    expect(selectionBar(root).hidden).toBe(false);
    expect(selectionBar(root).querySelector('.selection-count')!.textContent).toBe('2 selected');
    shiftClick(root, 'a');
    expect(board.selectedIds()).toEqual(['b']);
  });

  it('a plain click on a note clears the selection; Deselect clears it and hides the bar', () => {
    const { board, root } = two();
    shiftClick(root, 'a');
    ptr(bar(root, 'b'), 'pointerdown', 5, 5);
    ptr(bar(root, 'b'), 'pointerup', 5, 5);
    bar(root, 'b').click();
    expect(board.selectedIds()).toEqual([]);
    shiftClick(root, 'a');
    const d = [...selectionBar(root).querySelectorAll('button')].find((b) => b.textContent === 'Deselect')!;
    d.click();
    expect(board.selectedIds()).toEqual([]);
    expect(selectionBar(root).hidden).toBe(true);
  });

  it('a drag-box selects every note it touches, live', () => {
    const { board, root } = two();
    const el = boardEl(root);
    ptr(el, 'pointerdown', 0, 0);
    ptr(el, 'pointermove', 100, 100);
    expect(board.selectedIds()).toEqual(['a']);
    expect(root.querySelector('.marquee')).not.toBeNull();
    ptr(el, 'pointermove', 600, 400);
    expect(sorted(board)).toEqual(['a', 'b']);
    ptr(el, 'pointerup', 600, 400);
    expect(root.querySelector('.marquee')).toBeNull();
    expect(sorted(board)).toEqual(['a', 'b']);
  });

  it('a plain drag-box replaces the selection; a shift drag-box adds to it', () => {
    const { board, root } = two();
    const el = boardEl(root);
    shiftClick(root, 'b');
    ptr(el, 'pointerdown', 0, 0);
    ptr(el, 'pointermove', 100, 100);
    ptr(el, 'pointerup', 100, 100);
    expect(board.selectedIds()).toEqual(['a']);
    shiftClick(root, 'b');
    ptr(el, 'pointerdown', 0, 0, { shiftKey: true });
    ptr(el, 'pointermove', 100, 100, { shiftKey: true });
    ptr(el, 'pointerup', 100, 100, { shiftKey: true });
    expect(sorted(board)).toEqual(['a', 'b']);
  });

  it('a click on empty board clears the selection; a shift click does not', () => {
    const { board, root } = two();
    const el = boardEl(root);
    shiftClick(root, 'a');
    ptr(el, 'pointerdown', 300, 300, { shiftKey: true });
    ptr(el, 'pointerup', 300, 300, { shiftKey: true });
    expect(board.selectedIds()).toEqual(['a']);
    ptr(el, 'pointerdown', 300, 300);
    ptr(el, 'pointerup', 300, 300);
    expect(board.selectedIds()).toEqual([]);
  });

  it('lostpointercapture during a drag-box removes the box and the next press works', () => {
    const { board, root } = two();
    const el = boardEl(root);
    ptr(el, 'pointerdown', 0, 0);
    ptr(el, 'pointermove', 100, 100);
    ptr(el, 'lostpointercapture', 100, 100);
    expect(root.querySelector('.marquee')).toBeNull();
    expect(board.selectedIds()).toEqual(['a']);
    ptr(el, 'pointerdown', 400, 250);
    ptr(el, 'pointermove', 600, 400);
    expect(board.selectedIds()).toEqual(['b']);
    ptr(el, 'pointerup', 600, 400);
  });

  it('Ctrl+A selects all when not editing; Escape clears', () => {
    const { board, root } = two();
    const e = key(document.body, 'a', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(sorted(board)).toEqual(['a', 'b']);
    key(document.body, 'Escape');
    expect(board.selectedIds()).toEqual([]);
  });

  it('keys are ignored while a note is being edited or in a textarea', () => {
    const { board, root } = two();
    viewOf(root, 'a').querySelector<HTMLElement>('.sticky-body')!.click();
    const ta = viewOf(root, 'a').querySelector('textarea')!;
    key(ta, 'a', { ctrlKey: true });
    key(document.body, 'a', { ctrlKey: true });
    expect(board.selectedIds()).toEqual([]);
  });

  it('Escape or Ctrl+A in a textarea leave the selection alone', () => {
    const { board, root } = two();
    shiftClick(root, 'b');
    const ta = document.createElement('textarea');
    root.append(ta);
    key(ta, 'Escape');
    key(ta, 'a', { ctrlKey: true });
    expect(board.selectedIds()).toEqual(['b']);
  });

  it('starting an edit clears the selection', () => {
    const { board, root } = two();
    shiftClick(root, 'b');
    button(root, 'New').click();
    expect(board.selectedIds()).toEqual([]);
  });

  it('modifier-clicking another note ends the edit in progress and saves its text', () => {
    const { board, store, root } = two();
    viewOf(root, 'a').querySelector<HTMLElement>('.sticky-body')!.click();
    const ta = viewOf(root, 'a').querySelector('textarea')!;
    ta.focus();
    type(root, 'a', 'edited');
    shiftClick(root, 'b');
    expect(store.get('a')!.text).toBe('edited');
    expect(board.selectedIds()).toEqual(['b']);
  });

  it('a note removed by another tab drops out; a remote clear empties it', () => {
    const { board, root } = two();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    board.applyRemote({ kind: 'remove', id: 'a' });
    expect(board.selectedIds()).toEqual(['b']);
    expect(selectionBar(root).querySelector('.selection-count')!.textContent).toBe('1 selected');
    board.applyRemote({ kind: 'clear' });
    expect(board.selectedIds()).toEqual([]);
    expect(selectionBar(root).hidden).toBe(true);
  });

  it('stickies are not saved just because they were selected', () => {
    const { store, root } = two();
    shiftClick(root, 'a');
    expect(store.get('a')!.updatedAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('an already-prevented Escape or Ctrl+A leaves the selection alone', () => {
    const { board, root } = two();
    shiftClick(root, 'b');
    const prevented = (k: string, extra: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
      e.preventDefault();
      document.body.dispatchEvent(e);
    };
    prevented('Escape');
    prevented('a', { ctrlKey: true });
    expect(board.selectedIds()).toEqual(['b']);
  });

  it('pointercancel during a drag-box removes the box and the next press works', () => {
    const { board, root } = two();
    const el = boardEl(root);
    ptr(el, 'pointerdown', 0, 0);
    ptr(el, 'pointermove', 100, 100);
    ptr(el, 'pointercancel', 100, 100);
    expect(root.querySelector('.marquee')).toBeNull();
    expect(board.selectedIds()).toEqual(['a']);
    ptr(el, 'pointerdown', 400, 250);
    ptr(el, 'pointermove', 600, 400);
    expect(board.selectedIds()).toEqual(['b']);
    ptr(el, 'pointerup', 600, 400);
  });
});

describe('review fixes', () => {
  const trio = () => setup({ saved: [sticky({ id: 'a' }), sticky({ id: 'b', x: 300, y: 40, z: 2 }), sticky({ id: 'c', x: 600, y: 90, z: 3 })] });
  const dragging = (root: HTMLElement, id: string, dx: number) => {
    ptr(bar(root, id), 'pointerdown', 100, 100);
    ptr(bar(root, id), 'pointermove', 100 + dx, 100);
  };
  const up = (root: HTMLElement, id: string, dx: number) => ptr(bar(root, id), 'pointerup', 100 + dx, 100);
  const left = (root: HTMLElement) => ['a', 'b', 'c'].map((id) => viewOf(root, id)?.style.left);

  it('Escape mid group drag cancels it: previews reset, release saves nothing, selection kept', () => {
    const { board, root, store } = trio();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    const put = vi.spyOn(store, 'put');
    dragging(root, 'b', 50);
    expect(viewOf(root, 'a').style.left).toBe('60px');
    key(document.body, 'Escape');
    expect(left(root)).toEqual(['10px', '300px', '600px']);
    ptr(bar(root, 'b'), 'pointermove', 200, 100);
    expect(viewOf(root, 'a').style.left).toBe('10px');
    up(root, 'b', 150);
    expect(left(root)).toEqual(['10px', '300px', '600px']);
    expect(put).not.toHaveBeenCalled();
    expect(sorted(board)).toEqual(['a', 'b']);
    // a fresh drag afterwards works
    dragging(root, 'b', 20);
    up(root, 'b', 20);
    expect(store.get('a')!.x).toBe(30);
  });

  it('Ctrl+A and Delete mid group drag are ignored', async () => {
    const { board, root, store, deps } = trio();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    dragging(root, 'b', 50);
    const ctrlA = key(document.body, 'a', { ctrlKey: true });
    key(document.body, 'Delete');
    expect(ctrlA.defaultPrevented).toBe(true);
    expect(sorted(board)).toEqual(['a', 'b']);
    expect(deps.dialog).not.toHaveBeenCalled();
    const put = vi.spyOn(store, 'put');
    up(root, 'b', 50);
    expect(put).toHaveBeenCalledTimes(2);
    expect(store.get('c')!.x).toBe(600);
    expect(board.stickies().find((s) => s.id === 'a')!.x).toBe(60);
  });

  it('a note removed remotely mid-drag does not leave the others previewed (end, Escape, dragged note removed)', () => {
    for (const how of ['end', 'esc', 'dragger'] as const) {
      const { board, root, store } = trio();
      shiftClick(root, 'a');
      shiftClick(root, 'b');
      shiftClick(root, 'c');
      dragging(root, 'b', 50);
      const gone = how === 'dragger' ? 'b' : 'c';
      store.remove(gone);
      board.applyRemote({ kind: 'remove', id: gone });
      if (how === 'esc') key(document.body, 'Escape');
      if (how === 'end') up(root, 'b', 50);
      if (how === 'end') expect(board.stickies().find((s) => s.id === 'a')!.x).toBe(60);
      else expect(viewOf(root, 'a').style.left).toBe('10px');
      if (how !== 'dragger') expect(viewOf(root, 'b').style.left).toBe(how === 'end' ? '350px' : '300px');
    }
  });

  it('a plain click on a selected note brings it to front and clears the selection', () => {
    const { board, root } = trio();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    ptr(bar(root, 'a'), 'pointerdown', 5, 5);
    ptr(bar(root, 'a'), 'pointerup', 5, 5);
    bar(root, 'a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(board.selectedIds()).toEqual([]);
    expect(board.stickies().find((s) => s.id === 'a')!.z).toBe(4);
  });

  it('Ctrl+Shift+A and Ctrl+Alt+A do not select all', () => {
    const { board } = trio();
    key(document.body, 'a', { ctrlKey: true, shiftKey: true });
    key(document.body, 'a', { ctrlKey: true, altKey: true });
    expect(board.selectedIds()).toEqual([]);
    key(document.body, 'a', { ctrlKey: true });
    expect(board.selectedIds().length).toBe(3);
  });

  it('mousedown on empty board is default-prevented (no text selection), still ends an edit and saves', () => {
    vi.useFakeTimers();
    try {
      const { root, store } = setup({ saved: [sticky({ id: 'a' })] });
      viewOf(root, 'a').querySelector<HTMLElement>('.sticky-body')!.click();
      type(root, 'a', 'changed');
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      boardEl(root).dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      ptr(boardEl(root), 'pointerdown', 900, 900);
      expect(viewOf(root, 'a').querySelector('textarea')).toBeNull();
      expect(store.get('a')!.text).toBe('changed');
      const onNote = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      bar(root, 'a').dispatchEvent(onNote);
      expect(onNote.defaultPrevented).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('the drag-box clears any text selection when the marquee appears', () => {
    const { root } = trio();
    const spy = vi.spyOn(window.getSelection()!, 'removeAllRanges');
    ptr(boardEl(root), 'pointerdown', 900, 900);
    ptr(boardEl(root), 'pointermove', 905, 905);
    expect(spy).toHaveBeenCalled();
  });

  it('toolbar buttons do not wrap their labels and the toolbar wraps', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles.css'), 'utf8');
    expect(css).toMatch(/\.toolbar\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.selection-bar button\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('the toolbar links to the repo in a new tab', () => {
    const { root } = setup();
    const link = root.querySelector<HTMLAnchorElement>('.toolbar a.repo-link')!;
    expect(link.href).toBe('https://github.com/jmcd/mdstickies');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.querySelector('svg')).not.toBeNull();
  });
});

describe('group move', () => {
  const trio = () => setup({ saved: [sticky({ id: 'a' }), sticky({ id: 'b', x: 300, y: 40, z: 2 }), sticky({ id: 'c', x: 600, y: 90, z: 3 })] });
  const drag = (root: HTMLElement, id: string, dx: number, dy: number, end = 'pointerup') => {
    ptr(bar(root, id), 'pointerdown', 100, 100);
    ptr(bar(root, id), 'pointermove', 100 + dx, 100 + dy);
    if (end) ptr(bar(root, id), end, 100 + dx, 100 + dy);
  };
  const pos = (s: Board, id: string) => { const n = s.stickies().find((x) => x.id === id)!; return [n.x, n.y]; };

  it('dragging a selected note moves the whole selection and saves each once', () => {
    const { board, root, store } = trio();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    const put = vi.spyOn(store, 'put');
    drag(root, 'a', 50, 60);
    expect(pos(board, 'a')).toEqual([60, 80]);
    expect(pos(board, 'b')).toEqual([350, 100]);
    expect(pos(board, 'c')).toEqual([600, 90]);
    expect(board.stickies().map((s) => s.z)).toEqual([1, 2, 3]);
    expect(put).toHaveBeenCalledTimes(2);
    expect(store.get('b')!.x).toBe(350);
    expect(sorted(board)).toEqual(['a', 'b']);
  });

  it('a group drag stops at the edge together', () => {
    const { board, root } = setup({ saved: [sticky({ id: 'a', x: 5 }), sticky({ id: 'b', x: 100 })] });
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    drag(root, 'b', -20, 0);
    expect(pos(board, 'a')[0]).toBe(0);
    expect(pos(board, 'b')[0]).toBe(95);
  });

  it('a group drag cancelled by lostpointercapture snaps every note back and saves nothing', () => {
    const { board, root, store } = trio();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    const put = vi.spyOn(store, 'put');
    drag(root, 'a', 50, 60, '');
    expect(viewOf(root, 'b').style.left).toBe('350px');
    viewOf(root, 'a').dispatchEvent(new Event('lostpointercapture'));
    expect(viewOf(root, 'a').style.left).toBe('10px');
    expect(viewOf(root, 'b').style.left).toBe('300px');
    expect(put).not.toHaveBeenCalled();
    expect(pos(board, 'b')).toEqual([300, 40]);
  });

  it('a selected note removed by another tab mid-drag is skipped on drop', () => {
    const { board, root, store } = trio();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    drag(root, 'a', 50, 60, '');
    store.remove('b');
    board.applyRemote({ kind: 'remove', id: 'b' });
    expect(() => ptr(bar(root, 'a'), 'pointerup', 150, 160)).not.toThrow();
    expect(pos(board, 'a')).toEqual([60, 80]);
    expect(store.get('a')!.x).toBe(60);
    expect(store.get('b')).toBeUndefined();
    expect(board.stickies().map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('dragging an unselected note clears the selection and moves only it', () => {
    const { board, root } = trio();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    drag(root, 'c', 50, 60);
    expect(board.selectedIds()).toEqual([]);
    expect(pos(board, 'c')).toEqual([650, 150]);
    expect(pos(board, 'a')).toEqual([10, 20]);
    expect(pos(board, 'b')).toEqual([300, 40]);
  });
});

describe('selection actions', () => {
  const four = () => setup({ saved: [
    sticky({ id: 'a', x: 10, y: 20, z: 1 }),
    sticky({ id: 'b', x: 300, y: 40, z: 2, width: 300, height: 100 }),
    sticky({ id: 'c', x: 600, y: 130, z: 3 }),
    sticky({ id: 'd', x: 700, y: 500, z: 4 }),
  ] });
  const pick = (root: HTMLElement, ...ids: string[]) => ids.forEach((id) => shiftClick(root, id));
  const act = (root: HTMLElement, label: string) => {
    [...selectionBar(root).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!.click();
  };
  const geo = (store: StickyStore, id: string) => {
    const s = store.get(id)!;
    return [s.x, s.y, s.z, s.width, s.height];
  };

  it('Cascade piles the selection diagonally above everything else', () => {
    const { root, store } = four();
    pick(root, 'a', 'b', 'c');
    act(root, 'Cascade');
    expect(geo(store, 'a')).toEqual([10, 20, 5, 220, 180]);
    expect(geo(store, 'b')).toEqual([40, 50, 6, 300, 100]);
    expect(geo(store, 'c')).toEqual([70, 80, 7, 220, 180]);
    expect(geo(store, 'd')).toEqual([700, 500, 4, 220, 180]);
  });

  it('Grid lays the selection out in rows', () => {
    const { root, store } = four();
    pick(root, 'a', 'b', 'c');
    act(root, 'Grid');
    // 2 columns, cells 300x180, gap 16, origin (10, 20)
    expect(geo(store, 'a').slice(0, 2)).toEqual([10, 20]);
    expect(geo(store, 'b').slice(0, 2)).toEqual([326, 20]);
    expect(geo(store, 'c').slice(0, 2)).toEqual([10, 216]);
  });

  it('Align left and Align top use the smallest x / y', () => {
    const { root, store } = four();
    pick(root, 'b', 'c');
    act(root, 'Align left');
    expect([store.get('b')!.x, store.get('c')!.x]).toEqual([300, 300]);
    act(root, 'Align top');
    expect([store.get('b')!.y, store.get('c')!.y]).toEqual([40, 40]);
    expect(store.get('d')!.x).toBe(700);
  });

  it('Same size gives every selected note the largest size', () => {
    const { root, store } = four();
    pick(root, 'a', 'b');
    act(root, 'Same size');
    expect(geo(store, 'a').slice(3)).toEqual([220, 180]);
    expect(geo(store, 'b').slice(3)).toEqual([220, 180]);
    expect(geo(store, 'c').slice(3)).toEqual([220, 180]);
  });

  it('Front raises the selection above unselected notes', () => {
    const { root, store } = four();
    pick(root, 'a', 'b');
    act(root, 'Front');
    expect(store.get('a')!.z).toBe(5);
    expect(store.get('b')!.z).toBe(6);
    expect(store.get('d')!.z).toBe(4);
  });

  it('the colour control recolours every selected note and leaves others alone', () => {
    const { root, store, board } = four();
    pick(root, 'a', 'c');
    const palette = selectionBar(root).querySelector<HTMLButtonElement>('[aria-label="Colour selected"]')!;
    const dots = selectionBar(root).querySelector<HTMLElement>('.selection-colors')!;
    expect(dots.hidden).toBe(true);
    palette.click();
    expect(dots.hidden).toBe(false);
    expect(palette.getAttribute('aria-expanded')).toBe('true');
    dots.querySelector<HTMLButtonElement>('[aria-label="Colour pink"]')!.click();
    expect(['a', 'b', 'c', 'd'].map((id) => store.get(id)!.color)).toEqual(['pink', 'yellow', 'pink', 'yellow']);
    expect(dots.hidden).toBe(true);
    expect(sorted(board)).toEqual(['a', 'c']);
  });

  it('Escape closes the colour dots without clearing the selection; a press outside closes them too', () => {
    const { root, board } = four();
    pick(root, 'a');
    const palette = selectionBar(root).querySelector<HTMLButtonElement>('[aria-label="Colour selected"]')!;
    const dots = selectionBar(root).querySelector<HTMLElement>('.selection-colors')!;
    palette.click();
    key(palette, 'Escape');
    expect(dots.hidden).toBe(true);
    expect(board.selectedIds()).toEqual(['a']);
    key(document.body, 'Escape');
    expect(board.selectedIds()).toEqual([]);
    pick(root, 'a');
    palette.click();
    pointerdown(document.body);
    expect(dots.hidden).toBe(true);
    expect(palette.getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape on the body (focus not in the bar) closes open dots and keeps the selection', () => {
    const { root, board } = four();
    pick(root, 'a');
    const dots = selectionBar(root).querySelector<HTMLElement>('.selection-colors')!;
    selectionBar(root).querySelector<HTMLButtonElement>('[aria-label="Colour selected"]')!.click();
    key(document.body, 'Escape');
    expect(dots.hidden).toBe(true);
    expect(board.selectedIds()).toEqual(['a']);
  });

  it('Escape with the dots closed still clears the selection', () => {
    const { root, board } = four();
    pick(root, 'a');
    key(document.body, 'Escape');
    expect(board.selectedIds()).toEqual([]);
  });

  it('Deselect closes open dots', () => {
    const { root } = four();
    pick(root, 'a');
    const dots = selectionBar(root).querySelector<HTMLElement>('.selection-colors')!;
    selectionBar(root).querySelector<HTMLButtonElement>('[aria-label="Colour selected"]')!.click();
    act(root, 'Deselect');
    expect(dots.hidden).toBe(true);
  });

  it('Export selected downloads only the selected notes', () => {
    const { root, store, deps } = four();
    pick(root, 'a', 'c');
    act(root, 'Export selected');
    expect(deps.download).toHaveBeenCalledWith(
      exportFileName(new Date()),
      serializeBoard([store.get('a')!, store.get('c')!]),
    );
  });

  it('actions keep the selection', () => {
    const { root, board } = four();
    pick(root, 'a', 'b');
    for (const l of ['Cascade', 'Grid', 'Align left', 'Align top', 'Same size', 'Front', 'Export selected']) {
      act(root, l);
      expect(sorted(board)).toEqual(['a', 'b']);
    }
  });
});

describe('bulk delete', () => {
  const four = (answers: string[] = [], over: Partial<Sticky>[] = []) => setup({ answers, saved: ['a', 'b', 'c', 'd'].map((id, i) => sticky({ id, x: i * 250, ...over[i] })) });
  const pick = (root: HTMLElement, ...ids: string[]) => ids.forEach((id) => shiftClick(root, id));
  const del = (root: HTMLElement) =>
    [...selectionBar(root).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete')!.click();
  const ids = (root: HTMLElement) => views(root).map((v) => v.dataset.id).sort();

  it('Delete removes the whole selection everywhere without asking; one Undo restores them all', () => {
    const { root, store, deps, board } = four();
    pick(root, 'a', 'b', 'c');
    del(root);
    expect(deps.dialog).not.toHaveBeenCalled();
    expect(ids(root)).toEqual(['d']);
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeUndefined();
    expect(store.get('c')).toBeUndefined();
    expect(store.get('d')).toBeDefined();
    expect(board.selectedIds()).toEqual([]);
    expect(toast(root).textContent).toContain('3 notes deleted');

    undo(root);
    expect(ids(root)).toEqual(['a', 'b', 'c', 'd']);
    expect(store.loadAll()).toHaveLength(4);
  });

  it('a selection of only empty notes deletes with no undo offer', () => {
    const { root, store } = four([], [{ text: '' }, { text: '  ' }]);
    pick(root, 'a', 'b');
    del(root);
    expect(ids(root)).toEqual(['c', 'd']);
    expect(store.get('a')).toBeUndefined();
    expect(toast(root).hidden).toBe(true);
  });

  it('Backspace and Delete delete the selection when not editing, and do nothing in a textarea', async () => {
    const { root, board, deps } = four();
    pick(root, 'a', 'b');
    const ta = document.createElement('textarea');
    root.append(ta);
    key(ta, 'Delete');
    key(ta, 'Backspace');
    expect(deps.dialog).not.toHaveBeenCalled();
    expect(board.selectedIds().sort()).toEqual(['a', 'b']);
    const e = key(document.body, 'Backspace');
    expect(e.defaultPrevented).toBe(true);
    expect(ids(root)).toEqual(['c', 'd']);
    pick(root, 'c');
    key(document.body, 'Delete');
    expect(ids(root)).toEqual(['d']);
  });

  it('Delete with nothing selected does nothing', () => {
    const { root, deps } = four();
    const e = key(document.body, 'Delete');
    expect(e.defaultPrevented).toBe(false);
    expect(deps.dialog).not.toHaveBeenCalled();
    expect(ids(root)).toHaveLength(4);
  });

  it('shortcuts are ignored while a dialog is pending', async () => {
    const { root, board, deps } = setup({
      saved: ['a', 'b'].map((id) => sticky({ id })),
      file: 'not json',
      dialog: () => new Promise<string>(() => {}),
    });
    pick(root, 'a');
    void board.importBoard(); // any dialog will do; this one never answers
    await settle();
    key(document.body, 'Delete');
    key(document.body, 'Escape');
    key(document.body, 'a', { ctrlKey: true });
    expect(deps.dialog).toHaveBeenCalledTimes(1);
    expect(board.selectedIds()).toEqual(['a']);
    expect(ids(root)).toEqual(['a', 'b']);
  });

});

describe('undo delete', () => {
  const three = () => setup({ saved: ['a', 'b', 'c'].map((id, i) => sticky({ id, x: i * 250 })) });
  const remove = (root: HTMLElement, id: string) => viewOf(root, id).querySelector<HTMLElement>('.sticky-delete')!.click();
  const ids = (root: HTMLElement) => views(root).map((v) => v.dataset.id).sort();

  it('the offer lapses after 10 seconds', () => {
    const { root } = three();
    remove(root, 'a');
    vi.advanceTimersByTime(9_999);
    expect(toast(root).hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toast(root).hidden).toBe(true);
    expect(key(document.body, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(ids(root)).toEqual(['b', 'c']);
  });

  it('the timer waits while the pointer is over the toast', () => {
    const { root } = three();
    remove(root, 'a');
    toast(root).dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(60_000);
    expect(toast(root).hidden).toBe(false);
    toast(root).dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(10_000);
    expect(toast(root).hidden).toBe(true);
  });

  it('Ctrl+Z (Cmd+Z on Mac) undoes the last delete while the toast is up', () => {
    const { root, store } = three();
    remove(root, 'a');
    const e = key(document.body, 'z', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(ids(root)).toEqual(['a', 'b', 'c']);
    expect(store.get('a')).toBeDefined();
    expect(toast(root).hidden).toBe(true); // used up: a second Ctrl+Z does nothing
    expect(key(document.body, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('Ctrl+Z in a textarea is left to the textarea', () => {
    const { root } = three();
    remove(root, 'a');
    const ta = document.createElement('textarea');
    root.append(ta);
    expect(key(ta, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(ids(root)).toEqual(['b', 'c']);
  });

  it('a newer delete replaces the offer: Undo restores only the latest', () => {
    const { root } = three();
    remove(root, 'a');
    remove(root, 'b');
    undo(root);
    expect(ids(root)).toEqual(['b', 'c']);
  });

  it('Ctrl+A then Delete clears everything at once, and Undo brings it all back', () => {
    const { root, store } = three();
    key(document.body, 'a', { ctrlKey: true });
    key(document.body, 'Delete');
    expect(ids(root)).toEqual([]);
    undo(root);
    expect(ids(root)).toEqual(['a', 'b', 'c']);
    expect(store.loadAll()).toHaveLength(3);
  });

  it('a note edited before its delete comes back with its latest text, even if the save was still pending', () => {
    const { root, store, board } = setup();
    const s = board.newSticky();
    type(root, s.id, 'unsaved words');
    remove(root, s.id);
    undo(root);
    expect(store.get(s.id)!.text).toBe('unsaved words');
    expect(viewOf(root, s.id).querySelector('.sticky-body')!.textContent).toContain('unsaved words');
  });

  it('a note that is already back (another tab undid it) is left alone', () => {
    const { root, board, store } = three();
    remove(root, 'a');
    const newer = sticky({ id: 'a', text: 'edited elsewhere', updatedAt: '2026-10-26T00:00:00.000Z' });
    board.applyRemote({ kind: 'upsert', sticky: newer });
    undo(root);
    expect(board.stickies().find((s) => s.id === 'a')!.text).toBe('edited elsewhere');
    expect(store.get('a')).toBeUndefined(); // the remote write lands in its own tab's storage, not ours
  });
});

describe('search', () => {
  const trio = () => setup({ saved: [
    sticky({ id: 'a', text: 'buy milk' }),
    sticky({ id: 'b', text: 'call **Mum**', x: 300 }),
    sticky({ id: 'c', text: 'Milkshake recipe', x: 600, y: 900 }),
  ] });
  const box = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.toolbar input.search')!;
  const count = (root: HTMLElement) => root.querySelector<HTMLElement>('.search-count')!;
  const search = (root: HTMLElement, q: string) => {
    box(root).value = q;
    box(root).dispatchEvent(new Event('input', { bubbles: true }));
  };
  const dimmed = (root: HTMLElement) => views(root).filter((v) => v.classList.contains('search-miss')).map((v) => v.dataset.id);
  const key = (target: EventTarget, k: string, extra: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(e);
    return e;
  };

  it('typing dims the notes that do not match and counts the matches', () => {
    const { root } = trio();
    search(root, 'milk');
    expect(dimmed(root)).toEqual(['b']);
    expect(count(root).textContent).toBe('2 of 3');
    expect(viewOf(root, 'c').querySelector('mark.search-hit')!.textContent).toBe('Milk');
  });

  it('an empty or blank query dims nothing and hides the count', () => {
    const { root } = trio();
    search(root, 'milk');
    search(root, '  ');
    expect(dimmed(root)).toEqual([]);
    expect(count(root).hidden).toBe(true);
    expect(root.querySelector('mark.search-hit')).toBeNull();
  });

  it('Escape in the box clears the search', () => {
    const { root } = trio();
    search(root, 'mum');
    key(box(root), 'Escape');
    expect(box(root).value).toBe('');
    expect(dimmed(root)).toEqual([]);
  });

  it('Ctrl+F focuses the box instead of the browser find, even mid-edit', () => {
    const { root, board } = trio();
    board.newSticky();
    const e = key(document.activeElement!, 'f', { ctrlKey: true, metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(box(root));
  });

  it('a note whose text changes is re-checked against the search', () => {
    const { root, board } = trio();
    search(root, 'milk');
    board.applyRemote({ kind: 'upsert', sticky: sticky({ id: 'b', text: 'oat milk', x: 300, updatedAt: '2026-10-26T00:00:00.000Z' }) });
    expect(dimmed(root)).toEqual([]);
    expect(count(root).textContent).toBe('3 of 3');
  });

  it('a new note being typed into is not dimmed', () => {
    const { root, board } = trio();
    search(root, 'milk');
    const s = board.newSticky();
    expect(dimmed(root)).toEqual(['b']);
    expect(count(root).textContent).toBe('3 of 4');
    type(root, s.id, 'eggs');
    endEdit(root, s.id);
    vi.advanceTimersByTime(300);
    expect(dimmed(root).sort()).toEqual(['b', s.id].sort());
  });

  it('scrolls the first match (top, then left) into view', () => {
    const { root } = trio();
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    search(root, 'milk');
    expect(spy.mock.contexts[0]).toBe(viewOf(root, 'a'));
    search(root, 'shake');
    expect(spy.mock.contexts.at(-1)).toBe(viewOf(root, 'c'));
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });
});

describe('theme toggle', () => {
  it('sits in the toolbar just before the GitHub link', () => {
    const toggle = document.createElement('button');
    toggle.className = 'theme-toggle';
    const root = document.createElement('div');
    document.body.appendChild(root);
    new Board(root, new StickyStore(new FakeStorage()), { dialog: vi.fn(), download: vi.fn(), pickFile: vi.fn(), themeToggle: toggle }).start();
    expect(root.querySelector('.toolbar .toolbar-end > .theme-toggle + a.repo-link')).not.toBeNull(); // wrap together, at the right

  });
});

describe('keyboard shortcuts', () => {
  const pos = (board: Board, id: string) => {
    const s = board.stickies().find((n) => n.id === id)!;
    return [s.x, s.y];
  };

  it('N makes a new note and starts editing it', () => {
    const { board, root } = two();
    const e = key(document.body, 'n');
    expect(e.defaultPrevented).toBe(true);
    expect(board.stickies()).toHaveLength(3);
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    key(document.activeElement!, 'n');
    expect(board.stickies()).toHaveLength(3);
    expect(root.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('Ctrl+N is left to the browser', () => {
    const { board } = two();
    expect(key(document.body, 'n', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(board.stickies()).toHaveLength(2);
  });

  it('arrows nudge the selection 1px, Shift+arrows 10px, saving each move', () => {
    const { board, root, store } = two();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    expect(key(document.body, 'ArrowRight').defaultPrevented).toBe(true);
    key(document.body, 'ArrowDown', { shiftKey: true });
    expect(pos(board, 'a')).toEqual([11, 30]);
    expect(pos(board, 'b')).toEqual([501, 310]);
    expect([store.get('a')!.x, store.get('a')!.y]).toEqual([11, 30]);
    key(document.body, 'ArrowLeft', { shiftKey: true });
    key(document.body, 'ArrowUp');
    expect(pos(board, 'a')).toEqual([1, 29]);
  });

  it('nudging stops the whole selection at the board edge', () => {
    const { board, root } = two();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    for (let i = 0; i < 3; i++) key(document.body, 'ArrowLeft', { shiftKey: true });
    expect(pos(board, 'a')).toEqual([0, 20]);
    expect(pos(board, 'b')).toEqual([490, 300]);
  });

  it('arrows with nothing selected scroll the page as usual', () => {
    const { board } = two();
    expect(key(document.body, 'ArrowDown').defaultPrevented).toBe(false);
    expect(pos(board, 'a')).toEqual([10, 20]);
  });

  it('Ctrl+D duplicates the selection on top, offset, and selects the copies', () => {
    const { board, root, store } = setup({ saved: [sticky({ id: 'a', text: 'one', color: 'pink', z: 1 }), sticky({ id: 'b', text: 'two', x: 500, z: 5 })] });
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    expect(key(document.body, 'd', { ctrlKey: true }).defaultPrevented).toBe(true);
    const copies = board.stickies().filter((s) => s.id !== 'a' && s.id !== 'b');
    expect(copies.map((s) => [s.text, s.color, s.x, s.y, s.z]).sort()).toEqual([
      ['one', 'pink', 30, 40, 6],
      ['two', 'yellow', 520, 40, 7],
    ]);
    expect(sorted(board)).toEqual(copies.map((s) => s.id).sort());
    for (const c of copies) {
      expect(store.get(c.id)).toEqual(c);
      expect(c.createdAt).toBe('2026-10-25T12:00:00.000Z');
    }
  });

  it('Ctrl+D with nothing selected is left to the browser', () => {
    const { board } = two();
    expect(key(document.body, 'd', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(board.stickies()).toHaveLength(2);
  });

  it('Enter edits the one selected note', () => {
    const { root } = two();
    shiftClick(root, 'b');
    expect(key(document.body, 'Enter').defaultPrevented).toBe(true);
    expect(viewOf(root, 'b').querySelector('textarea')).toBe(document.activeElement);
  });

  it('Enter does nothing with two notes selected, or on a focused button', () => {
    const { root } = two();
    shiftClick(root, 'a');
    shiftClick(root, 'b');
    key(document.body, 'Enter');
    expect(root.querySelector('textarea')).toBeNull();
    shiftClick(root, 'a');
    key(button(root, 'Export'), 'Enter');
    expect(root.querySelector('textarea')).toBeNull();
  });

  it('? and the toolbar ? button list the shortcuts', () => {
    const { root, deps } = two();
    expect(key(document.body, '?', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(deps.dialog).toHaveBeenCalledTimes(1);
    const opts = deps.dialog.mock.calls[0][0];
    expect(opts.message).toBe('Keyboard shortcuts');
    for (const word of ['New note', 'Duplicate', 'Nudge', 'Search', 'Ctrl+D', 'Paste text']) expect(opts.content!.textContent).toContain(word);
    root.querySelector<HTMLButtonElement>('.toolbar .help-button')!.click();
    expect(deps.dialog).toHaveBeenCalledTimes(2);
  });

  it('shortcut keys typed into a note or the search box are just text', () => {
    const { board, root } = two();
    shiftClick(root, 'a');
    const search = root.querySelector<HTMLInputElement>('.search')!;
    for (const k of ['n', '?', 'ArrowRight', 'Enter']) key(search, k);
    expect(board.stickies()).toHaveLength(2);
    expect(pos(board, 'a')).toEqual([10, 20]);
    expect(root.querySelector('textarea')).toBeNull();
  });
});

describe('paste', () => {
  const paste = (target: EventTarget, text: string | null) => {
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text ?? '' : '') } });
    target.dispatchEvent(e);
    return e;
  };
  const newOnes = (board: Board) => board.stickies().filter((s) => s.id !== 'a' && s.id !== 'b');

  it('pasting text on the board makes a selected, rendered note on top, and saves it', () => {
    const { board, root, store } = two();
    expect(paste(document.body, '- [ ] milk\r\n- [ ] eggs').defaultPrevented).toBe(true);
    const [s] = newOnes(board);
    expect(s.text).toBe('- [ ] milk\n- [ ] eggs');
    expect(s.z).toBe(2);
    expect(store.get(s.id)).toEqual(s);
    expect(board.selectedIds()).toEqual([s.id]);
    expect(root.querySelector('textarea')).toBeNull();
    expect(viewOf(root, s.id).querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it('puts the note at the mouse pointer when it is over the board', () => {
    const { board, root } = two();
    ptr(boardEl(root), 'pointermove', 300, 200, { buttons: 0 });
    paste(document.body, 'here');
    expect(newOnes(board).map((s) => [s.x, s.y])).toEqual([[300, 200]]);
  });

  it('puts the note mid-screen when the pointer is not over the board', () => {
    const { board, root } = two();
    ptr(boardEl(root), 'pointermove', 300, 200, { buttons: 0 });
    boardEl(root).dispatchEvent(new Event('pointerleave'));
    paste(document.body, 'middle');
    expect(newOnes(board).map((s) => [s.x, s.y])).toEqual([[window.innerWidth / 2 - 110, window.innerHeight / 2 - 90]]);
  });

  it('blank text, or nothing but an image, makes no note', () => {
    const { board } = two();
    expect(paste(document.body, '  \n ').defaultPrevented).toBe(false);
    expect(paste(document.body, null).defaultPrevented).toBe(false);
    expect(board.stickies()).toHaveLength(2);
  });

  it('pasting into a note being edited or the search box is ordinary text pasting', () => {
    const { board, root } = two();
    const search = root.querySelector<HTMLInputElement>('.search')!;
    expect(paste(search, 'find me').defaultPrevented).toBe(false);
    viewOf(root, 'a').querySelector<HTMLElement>('.sticky-body')!.click();
    expect(paste(viewOf(root, 'a').querySelector('textarea')!, 'more').defaultPrevented).toBe(false);
    expect(board.stickies()).toHaveLength(2);
  });

  it('nothing happens while a dialog is open', () => {
    const { board, deps } = two();
    deps.dialog.mockReturnValueOnce(new Promise(() => {}));
    void board.clearBoard();
    paste(document.body, 'later');
    expect(board.stickies()).toHaveLength(2);
  });
});
