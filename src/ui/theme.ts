export type ThemePref = 'auto' | 'light' | 'dark';

/** index.html reads this key too, to apply the theme before first paint. */
export const THEME_KEY = 'mdstickies:v1:theme';

type SystemDark = Pick<MediaQueryList, 'matches'> & {
  addEventListener(type: 'change', fn: (e: { matches: boolean }) => void): void;
};

const ORDER: ThemePref[] = ['auto', 'light', 'dark'];
const LABELS: Record<ThemePref, string> = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
const DESCRIPTIONS: Record<ThemePref, string> = { auto: 'Auto (follows system)', light: 'Light', dark: 'Dark' };

const parse = (v: string | null): ThemePref => (ORDER.includes(v as ThemePref) ? (v as ThemePref) : 'auto');

// A toolbar button cycling Auto → Light → Dark. Sets data-theme="light"|"dark" on the root; the choice
// is kept in this browser and followed by other open tabs.
export class ThemeControl {
  readonly el = document.createElement('button');
  private pref: ThemePref = 'auto';

  constructor(
    private readonly storage: Storage | null,
    private readonly systemDark: SystemDark | null,
    private readonly root: HTMLElement = document.documentElement,
  ) {
    this.el.type = 'button';
    this.el.className = 'theme-toggle';
    this.el.addEventListener('click', () => this.choose(ORDER[(ORDER.indexOf(this.pref) + 1) % ORDER.length]));
  }

  start(): void {
    this.set(parse(this.read()));
    this.systemDark?.addEventListener('change', () => this.apply());
    window.addEventListener('storage', (e) => {
      if (e.key === THEME_KEY) this.set(parse(e.newValue));
    });
  }

  private choose(pref: ThemePref): void {
    this.set(pref);
    try { this.storage?.setItem(THEME_KEY, pref); } catch { /* storage full: the choice lasts this visit */ }
  }

  private read(): string | null {
    try { return this.storage?.getItem(THEME_KEY) ?? null; } catch { return null; }
  }

  private set(pref: ThemePref): void {
    this.pref = pref;
    this.el.textContent = LABELS[pref];
    this.el.setAttribute('aria-label', `Theme: ${DESCRIPTIONS[pref]}. Click to change.`);
    this.el.title = `Theme: ${DESCRIPTIONS[pref]}`;
    this.apply();
  }

  private apply(): void {
    const dark = this.pref === 'dark' || (this.pref === 'auto' && !!this.systemDark?.matches);
    this.root.dataset.theme = dark ? 'dark' : 'light';
  }
}
