import { clipboardData, notesFromClipboard, readClipboard, writeClipboard, type ClipboardContents, type CopyKind } from '../clipboard';
import { alignLeft, alignTop, cascade, clampDelta, grid, normalizeRect, sameSize, toFront, touches, type Layout } from '../arrange';
import { COLORS, createSticky, touch, DEFAULT_SIZE, type Sticky } from '../model';
import { exportFileName, ImportError, parseBoardFile, prepareAdd, serializeBoard } from '../format';
import { parseStorageEvent, resolveRemote, StorageFailure, type RemoteChange, type StickyStore } from '../store';
import type { showDialog } from './dialog';
import type { downloadFile, pickFile } from './files';
import { IS_MAC, isPrimaryShortcut, isSelectModifier } from './keys';
import { closeMenus, Menu } from './menu';
import { StickyView } from './stickyView';
import { Toast } from './toast';

export interface BoardDeps {
  dialog: typeof showDialog;
  download: typeof downloadFile;
  pickFile: typeof pickFile;
  themeToggle?: HTMLElement;
  writeClipboard?: (data: Record<string, string>) => Promise<void>;
  readClipboard?: () => Promise<ClipboardContents>;
  now?: () => Date;
}

const TEXT_DEBOUNCE_MS = 300;
const BOARD_MARGIN = 200;
const DRAG_THRESHOLD = 4;
const UNDO_MS = 10_000;
const DUPLICATE_OFFSET = 20;
const NUDGE = { small: 1, large: 10 };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const SHORTCUTS: Array<[string, string]> = [
  ['N', 'New note'],
  ['Click', 'Select a note'],
  ['Double-click', 'Edit a note'],
  ['Enter', 'Edit the selected note'],
  ['Esc', 'Stop editing · clear the selection'],
  [`Shift+click, ${MOD}click`, 'Add a note to the selection (or drag a box on the board)'],
  [`${MOD}A`, 'Select all'],
  ['Arrows', 'Nudge selected notes (Shift: 10px)'],
  [`${MOD}D`, 'Duplicate selected notes'],
  [`${MOD}C`, 'Copy selected notes (paste them into any mdstickies)'],
  [`${MOD}V`, 'Paste notes or text (at the pointer)'],
  ['Delete, Backspace', 'Delete selected notes'],
  [`${MOD}Z`, 'Undo a delete (while the Undo message shows)'],
  [`${MOD}F`, 'Search (Esc clears it)'],
  ['?', 'Show these shortcuts'],
];
const REPO_URL = 'https://github.com/jmcd/mdstickies';
const GITHUB_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';
const PALETTE_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H12a3 3 0 0 0 3-3C15 3.6 11.9 1 8 1Zm-4 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm2-3a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm4 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm2 3a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>';
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
  private readonly toast = new Toast(UNDO_MS);
  private readonly searchBox = document.createElement('input');
  private readonly searchCount = document.createElement('span');
  private query = '';
  private pointer: [number, number] | null = null; // last pointer position over the board, in board coordinates
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
    toolbar.append(
      this.barButton('New', () => this.newSticky()),
      this.barButton('Paste', () => void this.pasteFromClipboard()),
      new Menu('Board', [
        ['Export', () => this.exportBoard()],
        ['Import', () => void this.importBoard()],
        ['Clear board', () => void this.clearBoard()],
      ]).el,
      this.searchControl(),
    );

    this.selectionBar.className = 'selection-bar';
    this.selectionBar.hidden = true;
    this.selectionCount.className = 'selection-count';
    this.selectionBar.append(this.selectionCount);
    // Grouped into menus so selecting notes doesn't wrap the toolbar onto more rows and push the board down.
    const deselect = this.barButton('✕', () => this.setSelection([]));
    deselect.setAttribute('aria-label', 'Deselect');
    deselect.title = 'Deselect';
    this.selectionBar.append(
      new Menu('Arrange', [
        ['Cascade', () => this.applyLayout(cascade(this.selectedStickies(), this.maxZ()))],
        ['Grid', () => this.applyLayout(grid(this.selectedStickies()))],
        ['Align left', () => this.applyLayout(alignLeft(this.selectedStickies()))],
        ['Align top', () => this.applyLayout(alignTop(this.selectedStickies()))],
        ['Same size', () => this.applyLayout(sameSize(this.selectedStickies()))],
        ['Front', () => this.applyLayout(toFront(this.selectedStickies(), this.maxZ()))],
      ]).el,
      new Menu('Copy', [
        ['Copy', () => void this.copySelected('notes')],
        ['Copy text', () => void this.copySelected('text')],
        ['Copy Markdown', () => void this.copySelected('markdown')],
        'divider',
        ['Export selected', () => this.exportSelected()],
      ]).el,
      this.colourControl(),
      this.barButton('Delete', () => this.deleteNotes(this.selectedIds())),
      deselect,
    );
    toolbar.append(this.selectionBar);

    const repo = document.createElement('a');
    repo.className = 'repo-link';
    repo.href = REPO_URL;
    repo.target = '_blank';
    repo.rel = 'noopener noreferrer';
    repo.title = 'mdstickies on GitHub';
    repo.setAttribute('aria-label', repo.title);
    repo.innerHTML = GITHUB_ICON;
    const end = document.createElement('div'); // one group, so a wrapping toolbar keeps them together at the right
    end.className = 'toolbar-end';
    const help = this.barButton('?', () => void this.showHelp());
    help.className = 'help-button';
    help.setAttribute('aria-label', 'Keyboard shortcuts');
    help.title = 'Keyboard shortcuts (?)';
    end.append(help);
    if (this.deps.themeToggle) end.append(this.deps.themeToggle);
    end.append(repo);
    toolbar.append(end);

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
    this.root.replaceChildren(toolbar, this.boardEl, this.toast.el);

    // A press on empty board must not start a text selection; blurEdit() ends edits explicitly.
    this.boardEl.addEventListener('mousedown', (e) => { if (e.target === this.boardEl) e.preventDefault(); });
    this.boardEl.addEventListener('pointerdown', (e) => this.boxStart(e));
    this.boardEl.addEventListener('pointermove', (e) => this.boxMove(e));
    this.boardEl.addEventListener('pointerup', () => this.boxEnd(true));
    this.boardEl.addEventListener('pointercancel', () => this.boxEnd(false));
    this.boardEl.addEventListener('lostpointercapture', () => this.boxEnd(false));
    this.boardEl.addEventListener('pointermove', (e) => { this.pointer = this.local(e); });
    this.boardEl.addEventListener('pointerleave', () => { this.pointer = null; });
    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('paste', (e) => this.onPaste(e));
    document.addEventListener('copy', (e) => this.onCopy(e));

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
    const s = createSticky({ ...this.midScreen(), z: this.maxZ() + 1 }, this.now());
    this.upsertView(s);
    this.resize();
    this.save(s);
    this.views.get(s.id)!.edit();
    return s;
  }

  private midScreen(): { x: number; y: number } {
    return {
      x: window.scrollX + window.innerWidth / 2 - DEFAULT_SIZE.width / 2,
      y: window.scrollY + window.innerHeight / 2 - DEFAULT_SIZE.height / 2,
    };
  }

  // Clipboard events in a text field, mid-edit or under a dialog are ordinary text copy/paste.
  private clipboardIsOurs(e: ClipboardEvent): boolean {
    if (e.defaultPrevented || this.dialogs > 0 || this.editingId !== null) return false;
    const t = e.target as HTMLElement | null;
    return !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
  }

  // Pasting copied notes recreates them; other text becomes a note. Either lands at the pointer if it's over the board.
  private onPaste(e: ClipboardEvent): void {
    if (!this.clipboardIsOurs(e)) return;
    const at = this.pointer ? { x: this.pointer[0], y: this.pointer[1] } : this.midScreen();
    const pasted = this.paste({ html: e.clipboardData?.getData('text/html') ?? '', text: e.clipboardData?.getData('text/plain') ?? '' }, at);
    if (pasted) e.preventDefault();
  }

  // The Paste button: the pointer is on the toolbar, so it lands mid-screen like New.
  private async pasteFromClipboard(): Promise<void> {
    let contents: ClipboardContents;
    try {
      contents = await (this.deps.readClipboard ?? readClipboard)();
    } catch {
      this.toast.show("Couldn't paste from the clipboard");
      return;
    }
    if (!this.paste(contents, this.midScreen())) this.toast.show('Nothing to paste');
  }

  // Copied notes are recreated; other text becomes a note. False if there was nothing to paste.
  private paste({ html, text }: ClipboardContents, at: { x: number; y: number }): boolean {
    const notes = notesFromClipboard(html);
    if (notes) {
      this.placeCopies(notes, at);
      return true;
    }
    text = text.replace(/\r\n?/g, '\n');
    if (!text.trim()) return false;
    const s = { ...createSticky({ ...at, z: this.maxZ() + 1 }, this.now()), text };
    this.upsertView(s);
    this.resize();
    this.save(s);
    this.setSelection([s.id]);
    return true;
  }

  // Ctrl/Cmd+C with notes selected copies them whole; highlighted text is copied as usual instead.
  private onCopy(e: ClipboardEvent): void {
    if (!this.clipboardIsOurs(e) || this.selected.size === 0 || !e.clipboardData) return;
    if (getSelection()?.isCollapsed === false) return;
    e.preventDefault();
    for (const [type, value] of Object.entries(clipboardData(this.selectedStickies(), 'notes'))) e.clipboardData.setData(type, value);
    this.toast.show(this.copiedMessage('notes'));
  }

  private async copySelected(kind: CopyKind): Promise<void> {
    const sel = this.selectedStickies();
    if (!sel.length) return;
    try {
      await (this.deps.writeClipboard ?? writeClipboard)(clipboardData(sel, kind));
      this.toast.show(this.copiedMessage(kind));
    } catch {
      this.toast.show("Couldn't copy to the clipboard");
    }
  }

  private copiedMessage(kind: CopyKind): string {
    const n = this.selected.size;
    const what = `Copied ${n} ${n === 1 ? 'note' : 'notes'}`;
    return kind === 'text' ? `${what} as text` : kind === 'markdown' ? `${what} as Markdown` : what;
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
      message: `Delete all ${this.notes.size} notes?`,
      buttons: [{ id: 'clear', label: 'Clear board', danger: true }, { id: 'cancel', label: 'Cancel' }],
      cancelId: 'cancel',
    });
    if (answer !== 'clear') return;
    const gone = this.stickies();
    this.clearEverywhere();
    this.resize();
    this.offerUndo(gone, 'Board cleared');
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
    if (this.selected.size === 0) {
      this.setColourOpen(false);
      closeMenus();
    }
  }

  // --- search ---

  private searchControl(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'search-wrap';
    const box = this.searchBox;
    box.type = 'search';
    box.className = 'search';
    box.placeholder = 'Search notes';
    box.setAttribute('aria-label', 'Search notes');
    box.addEventListener('input', () => this.setQuery(box.value));
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (box.value === '') box.blur();
      box.value = '';
      this.setQuery('');
    });
    this.searchCount.className = 'search-count';
    this.searchCount.setAttribute('aria-live', 'polite');
    this.searchCount.hidden = true;
    wrap.append(box, this.searchCount);
    return wrap;
  }

  private setQuery(raw: string): void {
    this.query = raw.trim();
    const first = this.applySearch()
      .sort((a, b) => a.y - b.y || a.x - b.x)[0];
    if (this.query && first) this.views.get(first.id)!.el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  // Dims every note that doesn't match the query; returns the ones that do.
  private applySearch(): Sticky[] {
    const hits: Sticky[] = [];
    for (const [id, view] of this.views) {
      const hit = view.setQuery(this.query);
      view.el.classList.toggle('search-miss', !hit);
      if (hit) hits.push(this.notes.get(id)!);
    }
    this.searchCount.hidden = !this.query;
    this.searchCount.textContent = `${hits.length} of ${this.views.size}`;
    return hits;
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
    if (e.defaultPrevented || this.dialogs > 0) return;
    if (isPrimaryShortcut(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.searchBox.focus();
      this.searchBox.select();
      return;
    }
    if (this.editingId !== null) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (this.groupDrag) { // a drag in progress owns the selection: Esc cancels it, select-all/delete wait
      if (e.key === 'Escape') this.cancelGroupDrag();
      if (e.key === 'Escape' || e.key === 'Delete' || e.key === 'Backspace' || (isPrimaryShortcut(e) && e.key.toLowerCase() === 'a')) e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && (closeMenus() || !this.colourDots.hidden)) { // close an open menu or the colour dots first, wherever focus is
      e.preventDefault();
      this.setColourOpen(false);
      return;
    }
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const command = isPrimaryShortcut(e) && !e.shiftKey && !e.altKey;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected.size > 0) {
      e.preventDefault(); // Backspace can navigate back in some browsers
      this.deleteNotes(this.selectedIds());
    } else if (plain && e.key.toLowerCase() === 'n') {
      e.preventDefault(); // or the n lands in the new note's textarea
      this.newSticky();
    } else if (plain && e.key === '?') {
      e.preventDefault();
      void this.showHelp();
    } else if (plain && e.key in ARROWS && this.selected.size > 0) {
      e.preventDefault(); // don't scroll the page too
      const [x, y] = ARROWS[e.key];
      const step = e.shiftKey ? NUDGE.large : NUDGE.small;
      this.nudge(x * step, y * step);
    } else if (command && e.key.toLowerCase() === 'd' && this.selected.size > 0) {
      e.preventDefault(); // the browser's bookmark shortcut
      this.duplicateSelected();
    } else if (plain && !e.shiftKey && e.key === 'Enter' && this.selected.size === 1 && !t?.closest('button, a')) {
      e.preventDefault(); // or a newline lands in the textarea
      this.views.get(this.selectedIds()[0])?.edit();
    } else if (isPrimaryShortcut(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && this.toast.hasAction) {
      e.preventDefault();
      this.toast.run();
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
    this.applySearch();
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
    this.applySearch();
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

  private nudge(dx: number, dy: number): void {
    const sel = this.selectedStickies();
    const d = clampDelta(sel, dx, dy);
    if (d.dx === 0 && d.dy === 0) return;
    for (const s of sel) this.change(s.id, { x: s.x + d.dx, y: s.y + d.dy }, false);
    this.resize();
  }

  // Copies sit offset so they don't hide the originals.
  private duplicateSelected(): void {
    const sel = this.selectedStickies();
    if (!sel.length) return;
    const x = Math.min(...sel.map((s) => s.x)) + DUPLICATE_OFFSET;
    const y = Math.min(...sel.map((s) => s.y)) + DUPLICATE_OFFSET;
    this.placeCopies(sel, { x, y });
  }

  // New notes copied from these, keeping their layout with its top-left corner at `at`, on top of
  // everything (stacked as before) and selected.
  private placeCopies(notes: Sticky[], at: { x: number; y: number }): void {
    const dx = at.x - Math.min(...notes.map((s) => s.x));
    const dy = at.y - Math.min(...notes.map((s) => s.y));
    const top = this.maxZ();
    const iso = this.now().toISOString();
    const copies = [...notes]
      .sort((a, b) => a.z - b.z)
      .map((s, i): Sticky => ({
        ...s,
        id: crypto.randomUUID(),
        x: Math.max(0, s.x + dx),
        y: Math.max(0, s.y + dy),
        z: top + 1 + i,
        createdAt: iso,
        updatedAt: iso,
      }));
    for (const c of copies) {
      this.upsertView(c);
      this.save(c);
    }
    this.resize();
    this.setSelection(copies.map((c) => c.id));
  }

  private async showHelp(): Promise<void> {
    const list = document.createElement('dl');
    list.className = 'shortcuts';
    for (const [keys, what] of SHORTCUTS) {
      const dt = document.createElement('dt');
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      dt.append(kbd);
      const dd = document.createElement('dd');
      dd.textContent = what;
      list.append(dt, dd);
    }
    await this.ask({ message: 'Keyboard shortcuts', content: list, buttons: [{ id: 'ok', label: 'OK' }], cancelId: 'ok' });
  }

  // Deletes at once; the toast's Undo (or Ctrl/Cmd+Z) puts them back. Empty notes go without an offer.
  private deleteNotes(ids: string[]): void {
    const gone = ids.map((id) => this.notes.get(id)).filter((s): s is Sticky => !!s);
    if (gone.length === 0) return;
    for (const s of gone) {
      this.removeLocal(s.id);
      this.store.remove(s.id);
    }
    this.resize();
    this.offerUndo(gone, gone.length === 1 ? 'Note deleted' : `${gone.length} notes deleted`);
  }

  private offerUndo(gone: Sticky[], message: string): void {
    if (gone.some((s) => s.text.trim() !== '')) this.toast.show(message, 'Undo', () => this.restore(gone));
  }

  // Puts deleted notes back as they were; a note already back (e.g. restored in another tab) is left alone.
  private restore(gone: Sticky[]): void {
    for (const s of gone) {
      if (this.notes.has(s.id)) continue;
      this.upsertView(s);
      this.save(s);
    }
    this.resize();
  }

  // --- views and memory ---

  private upsertView(s: Sticky): void {
    this.notes.set(s.id, s);
    const existing = this.views.get(s.id);
    if (existing) {
      existing.update(s);
      this.applySearch();
      return;
    }
    const view = new StickyView(s, {
      onChange: (id, changes, { debounce }) => {
        if ('x' in changes && !this.selected.has(id)) this.setSelection([id]); // dragging an unselected note selects just it
        this.change(id, changes, debounce);
      },
      onGroupMove: (id, dx, dy, phase) => this.groupMove(id, dx, dy, phase),
      onActivate: (id) => this.activate(id),
      onEditStart: (id) => { this.editingId = id; this.setSelection([]); this.applySearch(); },
      onToggleSelect: (id) => this.toggleSelect(id),
      onPlainClick: (id) => { this.activate(id); this.setSelection([id]); },
      onEditEnd: (id) => this.endEdit(id),
      onDeleteRequest: (id) => this.deleteNotes([id]),
    });
    this.views.set(s.id, view);
    this.boardEl.append(view.el);
    this.applySearch();
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
    this.applySearch();
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
