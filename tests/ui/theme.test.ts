// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { ThemeControl, THEME_KEY } from '../../src/ui/theme';
import { FakeStorage } from '../helpers/fakeStorage';

function fakeMedia(dark: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = [];
  return {
    matches: dark,
    addEventListener: (_: 'change', fn: (e: { matches: boolean }) => void) => { listeners.push(fn); },
    set(next: boolean) {
      this.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
}

function setup(opts: { saved?: string; dark?: boolean; storage?: Storage | null } = {}) {
  const storage = opts.storage === undefined ? new FakeStorage() : opts.storage;
  if (opts.saved !== undefined) storage!.setItem(THEME_KEY, opts.saved);
  const media = fakeMedia(opts.dark ?? false);
  const root = document.createElement('html');
  const theme = new ThemeControl(storage, media, root);
  theme.start();
  return { theme, storage, media, root, label: () => theme.el.getAttribute('aria-label') };
}

const storageEvent = (key: string, newValue: string | null) =>
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));

afterEach(() => { document.body.innerHTML = ''; });

describe('ThemeControl', () => {
  it('starts on Auto and follows a light system', () => {
    const { root, label } = setup();
    expect(root.dataset.theme).toBe('light');
    expect(label()).toContain('Auto');
  });

  it('on Auto, follows the system live when it switches', () => {
    const { root, media } = setup({ dark: true });
    expect(root.dataset.theme).toBe('dark');
    media.set(false);
    expect(root.dataset.theme).toBe('light');
  });

  it('clicking cycles Auto → Light → Dark → Auto, saving each and overriding the system', () => {
    const { theme, root, storage, media, label } = setup({ dark: true });
    theme.el.click();
    expect([label(), root.dataset.theme, storage!.getItem(THEME_KEY)]).toEqual([expect.stringContaining('Light'), 'light', 'light']);
    media.set(true);
    expect(root.dataset.theme).toBe('light');
    theme.el.click();
    expect([label(), root.dataset.theme, storage!.getItem(THEME_KEY)]).toEqual([expect.stringContaining('Dark'), 'dark', 'dark']);
    theme.el.click();
    expect([label(), root.dataset.theme, storage!.getItem(THEME_KEY)]).toEqual([expect.stringContaining('Auto'), 'dark', 'auto']);
  });

  it('starts from the saved choice; an unknown saved value means Auto', () => {
    expect(setup({ saved: 'dark' }).root.dataset.theme).toBe('dark');
    const odd = setup({ saved: 'purple', dark: true });
    expect(odd.label()).toContain('Auto');
    expect(odd.root.dataset.theme).toBe('dark');
  });

  it('follows a choice made in another tab', () => {
    const { root, label } = setup();
    storageEvent(THEME_KEY, 'dark');
    expect(root.dataset.theme).toBe('dark');
    expect(label()).toContain('Dark');
    storageEvent('mdstickies:v1:sticky:x', 'light');
    expect(root.dataset.theme).toBe('dark');
  });

  it('still switches when storage is missing or full', () => {
    const none = setup({ storage: null });
    none.theme.el.click();
    expect(none.root.dataset.theme).toBe('light');
    const full = new FakeStorage();
    full.failWrites = true;
    const f = setup({ storage: full });
    f.theme.el.click();
    f.theme.el.click();
    expect(f.root.dataset.theme).toBe('dark');
  });

  it('describes the current setting for screen readers', () => {
    const { theme } = setup();
    expect(theme.el.getAttribute('aria-label')).toBe('Theme: Auto (follows system). Click to change.');
    expect(theme.el.textContent).toBe('◐'); // icon only, to keep the toolbar on one row
  });

  it('index.html applies the saved theme before the app loads, using the same key', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain(THEME_KEY);
    expect(head).toContain('prefers-color-scheme: dark');
  });

  it('the stylesheet has a dark palette and tells the browser which scheme is in use', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles.css'), 'utf8');
    expect(css).toMatch(/:root\[data-theme='dark'\]\s*\{[^}]*color-scheme:\s*dark/);
    expect(css).toMatch(/:root\[data-theme='dark'\]\s*\{[^}]*--sticky-yellow:/);
  });
});
