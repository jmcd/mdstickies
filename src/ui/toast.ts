// A single bottom-of-screen message with one action. Showing a new one replaces the old.
// The timer pauses while the pointer or focus is on it, so the action can't vanish mid-reach.
export class Toast {
  readonly el = document.createElement('div');
  private readonly message = document.createElement('span');
  private readonly action = document.createElement('button');
  private onAction: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private held = { hover: false, focus: false };

  constructor(private readonly ms: number) {
    this.el.className = 'toast';
    this.el.setAttribute('role', 'status');
    this.el.hidden = true;
    this.action.type = 'button';
    this.action.className = 'toast-action';
    this.action.addEventListener('click', () => this.run());
    this.el.append(this.message, this.action);
    this.el.addEventListener('pointerenter', () => this.hold('hover', true));
    this.el.addEventListener('pointerleave', () => this.hold('hover', false));
    this.el.addEventListener('focusin', () => this.hold('focus', true));
    this.el.addEventListener('focusout', (e) => { if (!this.el.contains(e.relatedTarget as Node | null)) this.hold('focus', false); });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(message: string, actionLabel: string, onAction: () => void): void {
    this.message.textContent = message;
    this.action.textContent = actionLabel;
    this.onAction = onAction;
    this.el.hidden = false;
    this.restart();
  }

  // Runs the action if the toast is still up; returns whether it did.
  run(): boolean {
    const act = this.onAction;
    if (!this.open || !act) return false;
    this.hide();
    act();
    return true;
  }

  hide(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.onAction = null;
    this.held = { hover: false, focus: false }; // a hidden element gets no leave/blur events
    this.el.hidden = true;
  }

  private hold(kind: 'hover' | 'focus', on: boolean): void {
    this.held[kind] = on;
    if (this.open) this.restart();
  }

  private restart(): void {
    clearTimeout(this.timer);
    this.timer = this.held.hover || this.held.focus ? undefined : setTimeout(() => this.hide(), this.ms);
  }
}
