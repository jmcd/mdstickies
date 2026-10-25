import { createSticky, touch, DEFAULT_SIZE, type Sticky } from '../model';
import { exportFileName, ImportError, parseBoardFile, prepareAdd, serializeBoard } from '../format';
import { parseStorageEvent, resolveRemote, StorageFailure, type RemoteChange, type StickyStore } from '../store';
import type { showDialog } from './dialog';
import type { downloadFile, pickFile } from './files';
import { StickyView } from './stickyView';

export interface BoardDeps {
  dialog: typeof showDialog;
  download: typeof downloadFile;
  pickFile: typeof pickFile;
  now?: () => Date;
}

const TEXT_DEBOUNCE_MS = 300;
const BOARD_MARGIN = 200;
const BANNER_TEXT = "Couldn't save — your browser storage is full or unavailable. Export to keep a copy.";

type Changes = Partial<Omit<Sticky, 'id' | 'createdAt'>>;

const isNewer = (a: Sticky, b: Sticky): boolean => Date.parse(a.updatedAt) > Date.parse(b.updatedAt);

export class Board {
  private readonly notes = new Map<string, Sticky>();
  private readonly views = new Map<string, StickyView>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private editingId: string | null = null;
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
      await this.deps.dialog({ message, buttons: [{ id: 'ok', label: 'OK' }], cancelId: 'ok' });
      return;
    }
    if (this.notes.size > 0) {
      const answer = await this.deps.dialog({
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
    const answer = await this.deps.dialog({
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

  private async requestDelete(id: string): Promise<void> {
    const s = this.notes.get(id);
    if (!s) return;
    if (s.text.trim() !== '') {
      const answer = await this.deps.dialog({
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

  // --- views and memory ---

  private upsertView(s: Sticky): void {
    this.notes.set(s.id, s);
    const existing = this.views.get(s.id);
    if (existing) return existing.update(s);
    const view = new StickyView(s, {
      onChange: (id, changes, { debounce }) => this.change(id, changes, debounce),
      onActivate: (id) => this.activate(id),
      onEditStart: (id) => { this.editingId = id; },
      onEditEnd: (id) => this.endEdit(id),
      onDeleteRequest: (id) => void this.requestDelete(id),
    });
    this.views.set(s.id, view);
    this.boardEl.append(view.el);
  }

  private removeLocal(id: string): void {
    this.cancelPending(id);
    if (this.editingId === id) this.editingId = null;
    this.views.get(id)?.el.remove();
    this.views.delete(id);
    this.notes.delete(id);
  }

  private clearLocal(): void {
    for (const id of [...this.notes.keys()]) this.removeLocal(id);
    this.editingId = null;
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
