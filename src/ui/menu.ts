export type MenuEntry = [label: string, run: () => void] | 'divider';

let openMenu: Menu | null = null;

/** Closes whichever menu is open; true if one was. */
export function closeMenus(): boolean {
  if (!openMenu) return false;
  openMenu.setOpen(false);
  return true;
}

/** A toolbar button that drops a list of actions over the board, so grouped actions don't widen the toolbar. */
export class Menu {
  readonly el = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly list = document.createElement('div');
  private readonly items: HTMLButtonElement[] = [];

  constructor(label: string, entries: MenuEntry[]) {
    this.el.className = 'menu';
    const b = this.button;
    b.type = 'button';
    b.className = 'menu-button';
    b.textContent = label;
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => this.setOpen(this.list.hidden === true));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' || this.list.hidden !== true) return;
      e.preventDefault();
      this.setOpen(true);
    });

    this.list.className = 'menu-list';
    this.list.setAttribute('role', 'menu');
    this.list.hidden = true;
    for (const entry of entries) {
      if (entry === 'divider') {
        const hr = document.createElement('div');
        hr.className = 'menu-divider';
        hr.setAttribute('role', 'separator');
        this.list.append(hr);
        continue;
      }
      const [text, run] = entry;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'menu-item';
      item.setAttribute('role', 'menuitem');
      item.textContent = text;
      item.addEventListener('click', () => {
        this.setOpen(false);
        b.focus();
        run();
      });
      this.items.push(item);
      this.list.append(item);
    }
    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.el.append(b, this.list);
  }

  setOpen(open: boolean): void {
    if (this.list.hidden === !open) return;
    if (open && openMenu && openMenu !== this) openMenu.setOpen(false);
    this.list.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) {
      openMenu = this;
      document.addEventListener('pointerdown', this.onOutside, true);
      this.items[0]?.focus();
    } else {
      if (openMenu === this) openMenu = null;
      document.removeEventListener('pointerdown', this.onOutside, true);
    }
  }

  private readonly onOutside = (e: Event): void => {
    if (!this.el.contains(e.target as Node)) this.setOpen(false);
  };

  // Consumed keys are marked handled so the board's own shortcuts (arrows nudge, Esc deselects) leave them alone.
  private onKey(e: KeyboardEvent): void {
    const at = this.items.indexOf(document.activeElement as HTMLButtonElement);
    const n = this.items.length;
    const to =
      e.key === 'ArrowDown' ? (at + 1) % n
      : e.key === 'ArrowUp' ? (at - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : null;
    if (to !== null) {
      e.preventDefault();
      this.items[to].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.setOpen(false);
      this.button.focus();
    }
  }
}
