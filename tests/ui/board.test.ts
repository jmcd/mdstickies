// @vitest-environment jsdom
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

function setup(opts: { saved?: Sticky[]; storage?: Storage | null; answers?: string[]; file?: string | null } = {}) {
  const storage = opts.storage === undefined ? new FakeStorage() : opts.storage;
  const store = new StickyStore(storage);
  for (const s of opts.saved ?? []) store.put(s);
  const answers = [...(opts.answers ?? [])];
  const deps = {
    dialog: vi.fn(async () => answers.shift() ?? 'cancel'),
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
});
afterEach(() => {
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

  it('deleting an empty note skips the dialog; non-empty asks, Cancel keeps it', async () => {
    const { store, root, deps } = setup({
      saved: [sticky({ id: 'empty', text: '  \n ' }), sticky({ id: 'full', text: 'keep me' })],
      answers: ['cancel', 'delete'],
    });
    viewOf(root, 'empty').querySelector<HTMLElement>('.sticky-delete')!.click();
    await settle();
    expect(deps.dialog).not.toHaveBeenCalled();
    expect(viewOf(root, 'empty')).toBeNull();
    expect(store.get('empty')).toBeUndefined();

    viewOf(root, 'full').querySelector<HTMLElement>('.sticky-delete')!.click();
    await settle();
    expect(deps.dialog).toHaveBeenCalledWith({
      message: 'Delete this note?',
      buttons: [{ id: 'delete', label: 'Delete', danger: true }, { id: 'cancel', label: 'Cancel' }],
      cancelId: 'cancel',
    });
    expect(viewOf(root, 'full')).not.toBeNull();
    expect(store.get('full')).toBeDefined();

    viewOf(root, 'full').querySelector<HTMLElement>('.sticky-delete')!.click();
    await settle();
    expect(viewOf(root, 'full')).toBeNull();
    expect(store.get('full')).toBeUndefined();
  });

  it('Clear board: Cancel keeps all, Clear removes all from DOM and storage', async () => {
    const { board, store, root, deps } = setup({
      saved: [sticky({ id: 'a' }), sticky({ id: 'b' })],
      answers: ['cancel', 'clear'],
    });
    button(root, 'Clear board').click();
    await settle();
    expect(deps.dialog).toHaveBeenCalledWith({
      message: "Delete all 2 notes? This can't be undone.",
      buttons: [{ id: 'clear', label: 'Clear board', danger: true }, { id: 'cancel', label: 'Cancel' }],
      cancelId: 'cancel',
    });
    expect(views(root)).toHaveLength(2);
    expect(store.loadAll()).toHaveLength(2);

    await board.clearBoard();
    expect(views(root)).toHaveLength(0);
    expect(board.stickies()).toEqual([]);
    expect(store.loadAll()).toEqual([]);
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

    const a = setup({ storage: tab(0), answers: ['delete'] });
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
