import { alignLeft, alignTop, cascade, clampDelta, grid, normalizeRect, sameSize, toFront, touches, type Layout } from '../arrange';
import { COLORS, createSticky, touch, DEFAULT_SIZE, type Sticky } from '../model';
import { exportFileName, ImportError, parseBoardFile, prepareAdd, serializeBoard } from '../format';
import { parseStorageEvent, resolveRemote, StorageFailure, type RemoteChange, type StickyStore } from '../store';
import type { showDialog } from './dialog';
import type { downloadFile, pickFile } from './files';
import { IS_MAC, isPrimaryShortcut, isSelectModifier } from './keys';
import { PALETTE_ICON, StickyView } from './stickyView';

export interface BoardDeps {
  dialog: typeof showDialog;
  download: typeof downloadFile;
  pickFile: typeof pickFile;
  now?: () => Date;
}

const TEXT_DEBOUNCE_MS = 300;
const BOARD_MARGIN = 200;
const DRAG_THRESHOLD = 4;
const REPO_URL = 'https://github.com/jmcd/mdstickies';
const GITHUB_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';
const BANNER_TEXT = "Couldn't save — your browser storage is full or unavailable. Export to keep a copy.";

type Changes = Partial<Omit<Sticky, 'id' | 'createdAt'>>;

const isNewer = (a: Sticky, b: Sticky): boolean => Date.parse(a.updatedAt) > Date.parse(b.updatedAt);

export class Board {
  private readonly notes = new Map<string, Sticky>();
  private readonly views = new Map<string, StickyView>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private editingId: string | null = null;
  private dialogs = 0;
  private readonly selected = new Set<string>();
  private readonly selectionBar = document.createElement('div');
  private readonly selectionCount = document.createElement('span');
  private readonly colourDots = document.createElement('div');
  private colourWrap: HTMLElement | null = null;
  private readonly colourButton = document.createElement('button');
  // Ids captured on the first move of a group drag: the selection can change or shrink mid-drag.
  private groupDrag: { dragId: string; ids: string[]; cancelled: boolean } | null = null;
  private box: { x: number; y: number; base: Set<string>; el: HTMLElement | null } | null = null;
  private readonly boardEl = document.createElement('div');
  private readonly banner = document.createElement('div');
  private readonly now: () => Date;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: StickyStore,
    private readonly deps: BoardDeps,
  ) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const tools: Array<[string, () => void]> = [
      ['New', () => this.newSticky()],
      ['Export', () => this.exportBoard()],
      ['Import', () => void this.importBoard()],
      ['Clear board', () => void this.clearBoard()],
    ];
    for (const [label, run] of tools) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', run);
      toolbar.append(b);
    }

    this.selectionBar.className = 'selection-bar';
    this.selectionBar.hidden = true;
    this.selectionCount.className = 'selection-count';
    this.selectionBar.append(this.selectionCount);
    const actions: Array<[string, () => void]> = [
      ['Cascade', () => this.applyLayout(cascade(this.selectedStickies(), this.maxZ()))],
      ['Grid', () => this.applyLayout(grid(this.selectedStickies()))],
      ['Align left', () => this.applyLayout(alignLeft(this.selectedStickies()))],
      ['Align top', () => this.applyLayout(alignTop(this.selectedStickies()))],
      ['Same size', () => this.applyLayout(sameSize(this.selectedStickies()))],
      ['Front', () => this.applyLayout(toFront(this.selectedStickies(), this.maxZ()))],
    ];
    for (const [label, run] of actions) this.selectionBar.append(this.barButton(label, run));
    this.selectionBar.append(this.colourControl(), this.barButton('Export selected', () => this.exportSelected()));
    this.selectionBar.append(this.barButton('Delete', () => void this.deleteSelected()));
    this.selectionBar.append(this.barButton('Deselect', () => this.setSelection([])));
    toolbar.append(this.selectionBar);

    const repo = document.createElement('a');
    repo.className = 'repo-link';
    repo.href = REPO_URL;
    repo.target = '_blank';
    repo.rel = 'noopener noreferrer';
    repo.title = 'mdstickies on GitHub';
    repo.innerHTML = `${GITHUB_ICON}<span>GitHub</span>`;
    toolbar.append(repo);

    this.banner.className = 'banner';
    this.banner.setAttribute('role', 'alert');
    const msg = document.createElement('span');
    msg.textContent = BANNER_TEXT;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'banner-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => this.banner.remove());
    this.banner.append(msg, dismiss);

    this.boardEl.className = 'board';
    this.root.replaceChildren(toolbar, this.boardEl);

    // A press on empty board must not start a text selection; blurEdit() ends edits explicitly.
    this.boardEl.addEventListener('mousedown', (e) => { if (e.target === this.boardEl) e.preventDefault(); });
    this.boardEl.addEventListener('pointerdown', (e) => this.boxStart(e));
    this.boardEl.addEventListener('pointermove', (e) => this.boxMove(e));
    this.boardEl.addEventListener('pointerup', () => this.boxEnd(true));
    this.boardEl.addEventListener('pointercancel', () => this.boxEnd(false));
    this.boardEl.addEventListener('lostpointercapture', () => this.boxEnd(false));
    document.addEventListener('keydown', (e) => this.onKey(e));

    for (const s of this.store.loadAll()) this.upsertView(s);
    this.resize();

    window.addEventListener('storage', (e) => {
      const change = parseStorageEvent(e.key, e.newValue);
      if (change) this.applyRemote(change);
    });
    window.addEventListener('pagehide', () => this.flush());
  }

  stickies(): Sticky[] {
    return [...this.notes.values()];
  }

  selectedIds(): string[] {
    return [...this.selected];
  }

  newSticky(): Sticky {
    const x = window.scrollX + window.innerWidth / 2 - DEFAULT_SIZE.width / 2;
    const y = window.scrollY + window.innerHeight / 2 - DEFAULT_SIZE.height / 2;
    const s = createSticky({ x, y, z: this.maxZ() + 1 }, this.now());
    this.upsertView(s);
    this.resize();
    this.save(s);
    this.views.get(s.id)!.edit();
    return s;
  }

  exportBoard(): void {
    this.deps.download(exportFileName(this.now()), serializeBoard(this.stickies()));
  }

  async importBoard(): Promise<void> {
    let imported: Sticky[];
    try {
      const json = await this.deps.pickFile();
      if (json === null) return;
      imported = parseBoardFile(json);
    } catch (e) {
      const message = e instanceof ImportError ? e.message : "Couldn't read that file.";
      await this.ask({ message, buttons: [{ id: 'ok', label: 'OK' }], cancelId: 'ok' });
      return;
    }
    if (this.notes.size > 0) {
      const answer = await this.ask({
        message: `Import ${imported.length} notes. Replace your current board or add them?`,
        buttons: [
          { id: 'replace', label: 'Replace', danger: true },
          { id: 'add', label: 'Add' },
          { id: 'cancel', label: 'Cancel' },
        ],
        cancelId: 'cancel',
      });
      if (answer === 'replace') this.clearEverywhere();
      else if (answer === 'add') imported = prepareAdd(this.stickies(), imported, this.now());
      else return;
    }
    for (const s of imported) {
      this.upsertView(s);
      this.save(s);
    }
    this.resize();
  }

  async clearBoard(): Promise<void> {
    if (this.notes.size === 0) return;
    const answer = await this.ask({
      message: `Delete all ${this.notes.size} notes? This can't be undone.`,
      buttons: [{ id: 'clear', label: 'Clear board', danger: true }, { id: 'cancel', label: 'Cancel' }],
      cancelId: 'cancel',
    });
    if (answer !== 'clear') return;
    this.clearEverywhere();
    this.resize();
  }

  applyRemote(change: RemoteChange): void {
    const id = change.kind === 'upsert' ? change.sticky.id : change.kind === 'remove' ? change.id : null;
    const local = id === null ? undefined : this.notes.get(id);
    const resolution = resolveRemote(local, change, this.editingId);
    if (resolution === 'ignore') return;
    if (resolution === 'resave-local') {
      if (local) this.saveNow(local);
      return;
    }
    if (change.kind === 'clear') this.clearLocal();
    else if (change.kind === 'remove') this.removeLocal(change.id);
    else {
      this.cancelPending(change.sticky.id);
      this.upsertView(change.sticky);
    }
    this.resize();
  }

  flush(): void {
    for (const id of [...this.pending.keys()]) this.flushOne(id);
  }

  // --- selection ---

  private async ask(opts: Parameters<BoardDeps['dialog']>[0]): Promise<string> {
    this.dialogs++;
    try {
      return await this.deps.dialog(opts);
    } finally {
      this.dialogs--;
    }
  }

  private selectedStickies(): Sticky[] {
    return [...this.selected].map((id) => this.notes.get(id)).filter((s): s is Sticky => !!s);
  }

  private setSelection(ids: Iterable<string>): void {
    this.selected.clear();
    for (const id of ids) if (this.notes.has(id)) this.selected.add(id);
    for (const [id, v] of this.views) v.setSelected(this.selected.has(id));
    this.selectionBar.hidden = this.selected.size === 0;
    this.selectionCount.textContent = `${this.selected.size} selected`;
    if (this.selected.size === 0) this.setColourOpen(false);
  }

  private barButton(label: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', run);
    return b;
  }

  private colourControl(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'selection-colour';
    const palette = this.colourButton;
    palette.type = 'button';
    palette.className = 'selection-palette';
    palette.setAttribute('aria-label', 'Colour selected');
    palette.setAttribute('aria-expanded', 'false');
    palette.innerHTML = PALETTE_ICON;
    palette.addEventListener('click', () => this.setColourOpen(this.colourDots.hidden === true));
    const dots = this.colourDots;
    dots.className = 'selection-colors';
    dots.hidden = true;
    for (const color of COLORS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `sticky-dot sticky-dot--${color}`;
      dot.setAttribute('aria-label', `Colour ${color}`);
      dot.addEventListener('click', () => {
        for (const s of this.selectedStickies()) this.change(s.id, { color }, false);
        this.setColourOpen(false);
      });
      dots.append(dot);
    }
    wrap.append(palette, dots);
    this.colourWrap = wrap;
    return wrap;
  }

  private readonly onColourOutside = (e: Event): void => {
    if (!this.colourWrap?.contains(e.target as Node)) this.setColourOpen(false);
  };

  private setColourOpen(open: boolean): void {
    if (!this.colourDots.hidden === open) return;
    this.colourDots.hidden = !open;
    this.colourButton.setAttribute('aria-expanded', String(open));
    if (open) document.addEventListener('pointerdown', this.onColourOutside, true);
    else document.removeEventListener('pointerdown', this.onColourOutside, true);
  }

  private applyLayout(layout: Layout): void {
    for (const { id, changes } of layout) this.change(id, changes, false); // change() skips ids no longer present
    this.resize();
  }

  private exportSelected(): void {
    const sel = this.selectedStickies();
    if (sel.length) this.deps.download(exportFileName(this.now()), serializeBoard(sel));
  }

  private toggleSelect(id: string): void {
    this.blurEdit();
    const next = new Set(this.selected);
    if (!next.delete(id)) next.add(id);
    this.setSelection(next);
  }

  private blurEdit(): void {
    if (this.editingId !== null && document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.boardEl.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private boxStart(e: PointerEvent): void {
    if (e.target !== this.boardEl || e.button !== 0) return;
    this.boxEnd(false);
    this.blurEdit();
    const [x, y] = this.local(e);
    this.box = { x, y, base: isSelectModifier(e) ? new Set(this.selected) : new Set(), el: null };
    try { this.boardEl.setPointerCapture?.(e.pointerId); } catch { /* synthetic or released pointer */ }
  }

  private boxMove(e: PointerEvent): void {
    const box = this.box;
    if (!box) return;
    if (e.buttons === 0) return this.boxEnd(false);
    const [x, y] = this.local(e);
    if (!box.el && Math.hypot(x - box.x, y - box.y) < DRAG_THRESHOLD) return;
    if (!box.el) {
      box.el = document.createElement('div');
      box.el.className = 'marquee';
      this.boardEl.append(box.el);
      this.boardEl.classList.add('selecting');
      getSelection()?.removeAllRanges();
    }
    const r = normalizeRect(box.x, box.y, x, y);
    Object.assign(box.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    const hit = this.stickies().filter((s) => touches(r, s)).map((s) => s.id);
    this.setSelection([...box.base, ...hit]);
  }

  private boxEnd(up: boolean): void {
    const box = this.box;
    if (!box) return;
    this.box = null;
    box.el?.remove();
    this.boardEl.classList.remove('selecting');
    if (up && !box.el && box.base.size === 0) this.setSelection([]);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || this.dialogs > 0 || this.editingId !== null) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (this.groupDrag) { // a drag in progress owns the selection: Esc cancels it, select-all/delete wait
      if (e.key === 'Escape') this.cancelGroupDrag();
      if (e.key === 'Escape' || e.key === 'Delete' || e.key === 'Backspace' || (isPrimaryShortcut(e) && e.key.toLowerCase() === 'a')) e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && !this.colourDots.hidden) { // close open colour dots first, wherever focus is
      e.preventDefault();
      this.setColourOpen(false);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected.size > 0) {
      e.preventDefault(); // Backspace can navigate back in some browsers
      void this.deleteSelected();
    } else if (isPrimaryShortcut(e) && !e.shiftKey && !e.altKey && !(IS_MAC && e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.setSelection(this.notes.keys());
    } else if (e.key === 'Escape') {
      this.setSelection([]);
    }
  }

  // --- local changes ---

  private change(id: string, changes: Changes, debounce: boolean): void {
    const cur = this.notes.get(id);
    if (!cur) return;
    const next = touch(cur, changes, this.now());
    this.notes.set(id, next);
    this.views.get(id)!.update(next);
    this.resize();
    if (!debounce) return this.saveNow(next);
    this.cancelPending(id);
    this.pending.set(id, setTimeout(() => this.flushOne(id), TEXT_DEBOUNCE_MS));
  }

  private activate(id: string): void {
    const cur = this.notes.get(id);
    if (!cur) return;
    const others = this.stickies().filter((s) => s.id !== id);
    if (others.every((s) => s.z < cur.z)) return; // already on top
    this.change(id, { z: this.maxZ() + 1 }, false);
  }

  private endEdit(id: string): void {
    if (this.editingId === id) this.editingId = null;
    const local = this.notes.get(id);
    if (!local) return;
    // Compare before flushing: writing our older pending text first would overwrite the newer stored note.
    const stored = this.store.get(id);
    if (stored && isNewer(stored, local)) {
      this.cancelPending(id);
      this.upsertView(stored);
      this.resize();
    } else {
      this.flushOne(id);
    }
  }

  private groupMove(id: string, dx: number, dy: number, phase: 'move' | 'end' | 'cancel'): void {
    if (phase === 'move' && (!this.groupDrag || this.groupDrag.dragId !== id)) {
      this.groupDrag = { dragId: id, ids: [...this.selected], cancelled: false };
    }
    const drag = this.groupDrag;
    if (!drag) return;
    if (phase !== 'move') this.groupDrag = null;
    if (drag.cancelled) return; // Esc already reset the previews
    const sel = drag.ids.map((i) => this.notes.get(i)).filter((s): s is Sticky => !!s);
    const d = phase === 'cancel' ? { dx: 0, dy: 0 } : clampDelta(sel, dx, dy);
    if (phase !== 'end') {
      for (const s of sel) this.views.get(s.id)?.preview(d.dx, d.dy);
      return;
    }
    for (const s of sel) this.change(s.id, { x: s.x + d.dx, y: s.y + d.dy }, false);
    this.resize();
  }

  private cancelGroupDrag(): void {
    const drag = this.groupDrag;
    if (!drag || drag.cancelled) return;
    drag.cancelled = true; // the pointerup that follows is then ignored
    for (const i of drag.ids) this.views.get(i)?.preview(0, 0);
  }

  private async requestDelete(id: string): Promise<void> {
    const s = this.notes.get(id);
    if (!s) return;
    if (s.text.trim() !== '') {
      const answer = await this.ask({
        message: 'Delete this note?',
        buttons: [{ id: 'delete', label: 'Delete', danger: true }, { id: 'cancel', label: 'Cancel' }],
        cancelId: 'cancel',
      });
      if (answer !== 'delete' || !this.notes.has(id)) return;
    }
    this.removeLocal(id);
    this.store.remove(id);
    this.resize();
  }

  private async deleteSelected(): Promise<void> {
    const sel = this.selectedStickies();
    const n = sel.length;
    if (n === 0) return;
    const ids = sel.map((s) => s.id);
    if (sel.some((s) => s.text.trim() !== '')) {
      const answer = await this.ask({
        message: n === 1 ? 'Delete this note?' : `Delete ${n} notes? This can't be undone.`,
        buttons: [{ id: 'delete', label: 'Delete', danger: true }, { id: 'cancel', label: 'Cancel' }],
        cancelId: 'cancel',
      });
      if (answer !== 'delete') return;
    }
    for (const id of ids) {
      if (!this.notes.has(id)) continue; // removed elsewhere while the dialog was up
      this.removeLocal(id);
      this.store.remove(id);
    }
    this.resize();
  }

  // --- views and memory ---

  private upsertView(s: Sticky): void {
    this.notes.set(s.id, s);
    const existing = this.views.get(s.id);
    if (existing) return existing.update(s);
    const view = new StickyView(s, {
      onChange: (id, changes, { debounce }) => {
        if ('x' in changes && this.selected.size > 0 && !this.selected.has(id)) this.setSelection([]); // dragging an unselected note drops the selection
        this.change(id, changes, debounce);
      },
      onGroupMove: (id, dx, dy, phase) => this.groupMove(id, dx, dy, phase),
      onActivate: (id) => this.activate(id),
      onEditStart: (id) => { this.editingId = id; this.setSelection([]); },
      onToggleSelect: (id) => this.toggleSelect(id),
      onPlainClick: (id) => { this.activate(id); this.setSelection([]); },
      onEditEnd: (id) => this.endEdit(id),
      onDeleteRequest: (id) => void this.requestDelete(id),
    });
    this.views.set(s.id, view);
    this.boardEl.append(view.el);
  }

  private removeLocal(id: string): void {
    this.cancelPending(id);
    if (this.editingId === id) this.editingId = null;
    if (this.groupDrag?.dragId === id) { // its pointerup will never arrive: drop the drag and reset the others
      this.cancelGroupDrag();
      this.groupDrag = null;
    }
    this.views.get(id)?.el.remove();
    this.views.delete(id);
    this.notes.delete(id);
    if (this.selected.delete(id)) this.setSelection([...this.selected]);
  }

  private clearLocal(): void {
    for (const id of [...this.notes.keys()]) this.removeLocal(id);
    this.editingId = null;
    this.setSelection([]);
  }

  private clearEverywhere(): void {
    this.clearLocal();
    this.guard(() => this.store.clearAll());
  }

  private maxZ(): number {
    return this.stickies().reduce((m, s) => Math.max(m, s.z), 0);
  }

  private resize(): void {
    let right = 0;
    let bottom = 0;
    for (const s of this.notes.values()) {
      right = Math.max(right, s.x + s.width);
      bottom = Math.max(bottom, s.y + s.height);
    }
    this.boardEl.style.minWidth = `${right + BOARD_MARGIN}px`;
    this.boardEl.style.minHeight = `${bottom + BOARD_MARGIN}px`;
  }

  // --- persistence ---

  private cancelPending(id: string): void {
    clearTimeout(this.pending.get(id));
    this.pending.delete(id);
  }

  // Newest updatedAt wins: never write a pending copy over a newer stored one (a remote save we ignored mid-edit).
  private flushOne(id: string): void {
    const pending = this.pending.has(id);
    this.cancelPending(id);
    const s = this.notes.get(id);
    if (!pending || !s) return;
    const stored = this.store.get(id);
    if (!stored || !isNewer(stored, s)) return this.save(s);
    if (this.editingId === id) return; // endEdit adopts it
    this.upsertView(stored);
    this.resize();
  }

  private saveNow(s: Sticky): void {
    this.cancelPending(s.id);
    this.save(s);
  }

  private save(s: Sticky): void {
    this.guard(() => this.store.put(s));
  }

  private guard(write: () => void): void {
    try {
      write();
    } catch (e) {
      if (!(e instanceof StorageFailure)) throw e;
      if (!this.banner.isConnected) this.root.insertBefore(this.banner, this.boardEl);
    }
  }
}
