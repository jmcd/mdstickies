import { COLORS, MIN_SIZE, type Sticky } from '../model';
import { renderMarkdown, toggleTask } from '../markdown';
import { isSelectModifier } from './keys';

export interface StickyViewCallbacks {
  onChange(
    id: string,
    changes: Partial<Pick<Sticky, 'text' | 'x' | 'y' | 'width' | 'height' | 'color'>>,
    opts: { debounce: boolean },
  ): void;
  onActivate(id: string): void;
  onEditStart(id: string): void;
  onEditEnd(id: string): void;
  onDeleteRequest(id: string): void;
  onToggleSelect?(id: string): void;
  onPlainClick?(id: string): void;
  /** Deltas are unclamped; the Board previews every selected view and commits on 'end'. */
  onGroupMove?(id: string, dx: number, dy: number, phase: 'move' | 'end' | 'cancel'): void;
}

const DRAG_THRESHOLD = 4;

export const PALETTE_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H12a3 3 0 0 0 3-3C15 3.6 11.9 1 8 1Zm-4 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm2-3a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm4 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm2 3a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>';

interface Gesture {
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  pointerId: number | undefined;
  active: boolean; // false while a body press is still below the drag threshold
  moved: boolean; // the pointer actually moved while active: the click that follows is not a click
  group: boolean; // moving a selected note: report deltas instead of moving ourselves
}

// Wraps each match within a single text node in <mark class="search-hit">.
function highlight(root: HTMLElement, query: string): void {
  const needle = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.data;
    const lower = text.toLowerCase();
    let at = lower.indexOf(needle);
    if (at < 0) continue;
    const frag = document.createDocumentFragment();
    let from = 0;
    for (; at >= 0; at = lower.indexOf(needle, from)) {
      frag.append(text.slice(from, at));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = text.slice(at, at + needle.length);
      frag.append(mark);
      from = at + needle.length;
    }
    frag.append(text.slice(from));
    node.replaceWith(frag);
  }
}

export class StickyView {
  readonly el: HTMLElement;
  private sticky: Sticky;
  private readonly bodyEl: HTMLElement;
  private textarea: HTMLTextAreaElement | null = null;
  private gesture: Gesture | null = null;
  private suppressClick = false;
  private isSelected = false;
  private renderedText: string | null = null;
  private query = '';
  private readonly toolsEl: HTMLElement;
  private readonly swatchesEl: HTMLElement;
  private readonly paletteEl: HTMLButtonElement;
  // While the swatches are open, a press outside the tools closes them.
  private readonly onOutsidePress = (e: Event) => {
    if (!this.toolsEl.contains(e.target as Node)) this.setSwatchesOpen(false);
  };

  constructor(sticky: Sticky, private readonly cb: StickyViewCallbacks) {
    this.sticky = sticky;
    const el = (this.el = document.createElement('div'));
    el.className = 'sticky';
    el.dataset.id = sticky.id;

    const bar = document.createElement('div');
    bar.className = 'sticky-bar';
    const dots = (this.swatchesEl = document.createElement('div'));
    dots.className = 'sticky-colors';
    dots.hidden = true;
    for (const color of COLORS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `sticky-dot sticky-dot--${color}`;
      dot.dataset.color = color;
      dot.setAttribute('aria-label', `Colour ${color}`);
      dots.appendChild(dot);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sticky-delete';
    del.setAttribute('aria-label', 'Delete note');
    del.textContent = '×';
    const palette = (this.paletteEl = document.createElement('button'));
    palette.type = 'button';
    palette.className = 'sticky-palette';
    palette.setAttribute('aria-label', 'Change colour');
    palette.setAttribute('aria-expanded', 'false');
    palette.innerHTML = PALETTE_ICON;
    const tools = (this.toolsEl = document.createElement('div'));
    tools.className = 'sticky-tools';
    tools.append(dots, palette, del);
    bar.append(tools);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'sticky-body';
    const handle = document.createElement('div');
    handle.className = 'sticky-resize';
    el.append(bar, this.bodyEl, handle);

    el.addEventListener('pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e as PointerEvent));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e as PointerEvent));
    el.addEventListener('pointercancel', () => this.cancelGesture());
    // Capture lost without a pointerup (e.g. a context menu swallowed it): abandon the move.
    el.addEventListener('lostpointercapture', () => this.cancelGesture());
    // A native drag-and-drop (selected text, <img>) would fire pointercancel and snap the note back.
    el.addEventListener('dragstart', (e) => {
      if (!this.editing) e.preventDefault();
    });
    el.addEventListener('focusin', () => cb.onActivate(this.sticky.id));
    el.addEventListener('focusout', (e) => this.onFocusOut(e));
    el.addEventListener('click', (e) => this.onClick(e));
    // Keep focus in the textarea when pressing a dot or x (Safari/Firefox-mac don't focus buttons; Chrome would).
    // A modifier press must not extend a text selection or move focus (Chrome does both on mousedown, not pointerdown).
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0 && isSelectModifier(e) && !this.ownTextarea(e.target as HTMLElement)) e.preventDefault();
      if (this.editing && (e.target as HTMLElement).closest('.sticky-dot, .sticky-palette, .sticky-delete')) e.preventDefault();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.paletteEl.getAttribute('aria-expanded') === 'true') e.preventDefault(); // closing the dots is all this Esc does
      this.setSwatchesOpen(false);
    });

    this.apply();
    this.renderBody();
  }

  get editing(): boolean {
    return this.textarea !== null;
  }

  get selected(): boolean {
    return this.isSelected;
  }

  setSelected(selected: boolean): void {
    this.isSelected = selected;
    this.el.classList.toggle('selected', selected);
  }

  preview(dx: number, dy: number): void {
    this.el.style.left = `${this.sticky.x + dx}px`;
    this.el.style.top = `${this.sticky.y + dy}px`;
  }

  /** Highlights case-insensitive matches of query in the rendered note; returns whether it matches.
   *  An empty query, or a note being edited, always matches. */
  setQuery(query: string): boolean {
    if (query !== this.query) {
      this.query = query;
      if (!this.editing) this.renderBody();
    }
    return !query || this.editing || this.bodyEl.textContent!.toLowerCase().includes(query.toLowerCase());
  }

  update(sticky: Sticky): void {
    this.sticky = sticky;
    this.apply();
    // Only re-render when the text changed: replacing the DOM under a pressed checkbox/link would lose its click.
    if (!this.editing && sticky.text !== this.renderedText) this.renderBody();
  }

  edit(): void {
    if (this.textarea) return;
    this.el.classList.add('editing');
    const ta = (this.textarea = document.createElement('textarea'));
    ta.className = 'sticky-text';
    ta.value = this.sticky.text;
    ta.setAttribute('aria-label', 'Note text');
    ta.addEventListener('input', () => {
      this.sticky = { ...this.sticky, text: ta.value };
      this.cb.onChange(this.sticky.id, { text: ta.value }, { debounce: true });
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      ta.blur();
      if (!ta.isConnected) this.endEdit(); // no focusout will fire for a detached textarea
    });
    this.bodyEl.replaceChildren(ta);
    this.cb.onEditStart(this.sticky.id);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  private setSwatchesOpen(open: boolean): void {
    if ((this.paletteEl.getAttribute('aria-expanded') === 'true') === open) return;
    this.swatchesEl.hidden = !open;
    this.paletteEl.setAttribute('aria-expanded', String(open));
    if (open) document.addEventListener('pointerdown', this.onOutsidePress, true);
    else document.removeEventListener('pointerdown', this.onOutsidePress, true);
  }

  private endEdit(): void {
    if (!this.textarea) return;
    this.textarea = null;
    this.el.classList.remove('editing');
    this.renderBody();
    this.cb.onEditEnd(this.sticky.id);
  }

  private apply(): void {
    const s = this.sticky;
    const st = this.el.style;
    st.left = `${s.x}px`;
    st.top = `${s.y}px`;
    st.width = `${s.width}px`;
    st.height = `${s.height}px`;
    st.zIndex = String(s.z);
    this.el.classList.remove(...COLORS.map((c) => `sticky--${c}`));
    this.el.classList.add(`sticky--${s.color}`);
  }

  private renderBody(): void {
    this.renderedText = this.sticky.text;
    this.bodyEl.innerHTML = renderMarkdown(this.sticky.text);
    if (this.query) highlight(this.bodyEl, this.query);
  }

  private onFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (this.editing && !(next && this.el.contains(next))) this.endEdit();
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    // The click after a modifier press: never edit, tick a checkbox or follow a link.
    if (isSelectModifier(e) && !this.ownTextarea(t)) {
      e.preventDefault();
      return;
    }
    const dot = t.closest<HTMLElement>('.sticky-dot');
    if (dot) {
      this.setSwatchesOpen(false);
      this.cb.onChange(this.sticky.id, { color: dot.dataset.color as Sticky['color'] }, { debounce: false });
      return;
    }
    if (t.closest('.sticky-palette')) {
      this.setSwatchesOpen(this.paletteEl.getAttribute('aria-expanded') !== 'true');
      return;
    }
    if (t.closest('.sticky-delete')) {
      this.cb.onDeleteRequest(this.sticky.id);
      return;
    }
    if (!this.suppressClick) this.cb.onPlainClick?.(this.sticky.id);
    if (!this.bodyEl.contains(t) || this.editing) return;
    const box = t.closest<HTMLInputElement>('input[data-task-index]');
    if (box) {
      // Board re-renders via update(); don't let the checkbox flip before then.
      e.preventDefault();
      const text = toggleTask(this.sticky.text, Number(box.dataset.taskIndex));
      this.cb.onChange(this.sticky.id, { text }, { debounce: false });
      return;
    }
    if (t.closest('a')) return;
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.edit();
  }

  private onPointerDown(e: PointerEvent): void {
    this.suppressClick = false;
    const t = e.target as HTMLElement;
    if (e.button === 0 && isSelectModifier(e) && !this.ownTextarea(t)) {
      e.preventDefault();
      this.cb.onToggleSelect?.(this.sticky.id);
      return;
    }
    let kind: Gesture['kind'] | null = null;
    let active = true;
    if (t.closest('.sticky-resize')) kind = 'resize';
    else if (t.closest('.sticky-dot, .sticky-palette, .sticky-delete')) kind = null;
    else if (t.closest('.sticky-bar')) {
      kind = 'move';
      active = !(this.isSelected && e.button === 0); // a selected note waits for the threshold so a click stays a click
    }
    else if (!this.editing && this.bodyEl.contains(t) && !t.closest('a, input')) {
      kind = 'move';
      active = false;
    }
    const group = kind === 'move' && this.isSelected && e.button === 0;
    if (!group) this.cb.onActivate(this.sticky.id);
    if (e.button !== 0 || !kind) return;
    this.gesture = { kind, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, active, moved: false, group };
    if (active) this.activate();
  }

  private ownTextarea(t: HTMLElement): boolean {
    return !!this.textarea && this.textarea.contains(t);
  }

  private activate(): void {
    this.capture();
    this.el.classList.add('dragging');
    getSelection()?.removeAllRanges();
  }

  private capture(): void {
    const g = this.gesture;
    if (g && g.pointerId !== undefined) this.el.setPointerCapture?.(g.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    const g = this.gesture;
    if (!g) return;
    if (e.buttons === 0) {
      this.cancelGesture();
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.active) {
      if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
      g.active = true;
      this.activate();
    }
    if (dx !== 0 || dy !== 0) g.moved = true;
    if (g.group) {
      this.cb.onGroupMove?.(this.sticky.id, dx, dy, 'move');
      return;
    }
    const geo = this.geometry(g, dx, dy);
    const st = this.el.style;
    if (g.kind === 'move') {
      st.left = `${geo.x}px`;
      st.top = `${geo.y}px`;
    } else {
      st.width = `${geo.width}px`;
      st.height = `${geo.height}px`;
    }
  }

  private geometry(g: Gesture, dx: number, dy: number) {
    const s = this.sticky;
    return {
      x: Math.max(0, s.x + dx),
      y: Math.max(0, s.y + dy),
      width: Math.max(MIN_SIZE.width, s.width + dx),
      height: Math.max(MIN_SIZE.height, s.height + dy),
    };
  }

  private onPointerUp(e: PointerEvent): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    this.el.classList.remove('dragging');
    if (!g.active) return;
    if (g.moved) this.suppressClick = true;
    if (g.group) {
      this.cb.onGroupMove?.(this.sticky.id, e.clientX - g.startX, e.clientY - g.startY, 'end');
      return;
    }
    const geo = this.geometry(g, e.clientX - g.startX, e.clientY - g.startY);
    const changes = g.kind === 'move' ? { x: geo.x, y: geo.y } : { width: geo.width, height: geo.height };
    this.cb.onChange(this.sticky.id, changes, { debounce: false });
  }

  private cancelGesture(): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    this.el.classList.remove('dragging');
    if (g.group && g.active) this.cb.onGroupMove?.(this.sticky.id, 0, 0, 'cancel');
    this.apply(); // snap back to the stored geometry
  }
}
