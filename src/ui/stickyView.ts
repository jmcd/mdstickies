import { COLORS, MIN_SIZE, type Sticky } from '../model';
import { renderMarkdown, toggleTask } from '../markdown';

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
}

const DRAG_THRESHOLD = 4;

interface Gesture {
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  pointerId: number | undefined;
  active: boolean; // false while a body press is still below the drag threshold
}

export class StickyView {
  readonly el: HTMLElement;
  private sticky: Sticky;
  private readonly bodyEl: HTMLElement;
  private textarea: HTMLTextAreaElement | null = null;
  private gesture: Gesture | null = null;
  private suppressClick = false;

  constructor(sticky: Sticky, private readonly cb: StickyViewCallbacks) {
    this.sticky = sticky;
    const el = (this.el = document.createElement('div'));
    el.className = 'sticky';
    el.dataset.id = sticky.id;

    const bar = document.createElement('div');
    bar.className = 'sticky-bar';
    const dots = document.createElement('div');
    dots.className = 'sticky-colors';
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
    bar.append(dots, del);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'sticky-body';
    const handle = document.createElement('div');
    handle.className = 'sticky-resize';
    el.append(bar, this.bodyEl, handle);

    el.addEventListener('pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e as PointerEvent));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e as PointerEvent));
    el.addEventListener('pointercancel', () => this.cancelGesture());
    el.addEventListener('focusin', () => cb.onActivate(this.sticky.id));
    el.addEventListener('focusout', (e) => this.onFocusOut(e));
    el.addEventListener('click', (e) => this.onClick(e));

    this.apply();
    this.renderBody();
  }

  get editing(): boolean {
    return this.textarea !== null;
  }

  update(sticky: Sticky): void {
    this.sticky = sticky;
    this.apply();
    if (!this.editing) this.renderBody();
  }

  edit(): void {
    if (this.textarea) return;
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

  private endEdit(): void {
    if (!this.textarea) return;
    this.textarea = null;
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
    this.bodyEl.innerHTML = renderMarkdown(this.sticky.text);
  }

  private onFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (this.editing && !(next && this.el.contains(next))) this.endEdit();
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const dot = t.closest<HTMLElement>('.sticky-dot');
    if (dot) {
      this.cb.onChange(this.sticky.id, { color: dot.dataset.color as Sticky['color'] }, { debounce: false });
      return;
    }
    if (t.closest('.sticky-delete')) {
      this.cb.onDeleteRequest(this.sticky.id);
      return;
    }
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
    this.cb.onActivate(this.sticky.id);
    this.suppressClick = false;
    const t = e.target as HTMLElement;
    let kind: Gesture['kind'] | null = null;
    let active = true;
    if (t.closest('.sticky-resize')) kind = 'resize';
    else if (t.closest('.sticky-dot, .sticky-delete')) return;
    else if (t.closest('.sticky-bar')) kind = 'move';
    else if (!this.editing && this.bodyEl.contains(t) && !t.closest('a, input')) {
      kind = 'move';
      active = false;
    }
    if (!kind) return;
    this.gesture = { kind, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, active };
    if (active) this.capture();
  }

  private capture(): void {
    const g = this.gesture;
    if (g && g.pointerId !== undefined) this.el.setPointerCapture?.(g.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    const g = this.gesture;
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.active) {
      if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
      g.active = true;
      this.capture();
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
    if (!g.active) return;
    this.suppressClick = true;
    const geo = this.geometry(g, e.clientX - g.startX, e.clientY - g.startY);
    const changes = g.kind === 'move' ? { x: geo.x, y: geo.y } : { width: geo.width, height: geo.height };
    this.cb.onChange(this.sticky.id, changes, { debounce: false });
  }

  private cancelGesture(): void {
    if (!this.gesture) return;
    this.gesture = null;
    this.apply(); // snap back to the stored geometry
  }
}
