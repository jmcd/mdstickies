// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { closeMenus, Menu } from '../../src/ui/menu';

const make = (label = 'Arrange', runs = { a: vi.fn(), b: vi.fn(), c: vi.fn() }) => {
  const menu = new Menu(label, [['Alpha', runs.a], ['Beta', runs.b], 'divider', ['Gamma', runs.c]]);
  document.body.append(menu.el);
  const trigger = menu.el.querySelector<HTMLButtonElement>('.menu-button')!;
  const list = menu.el.querySelector<HTMLElement>('[role="menu"]')!;
  const items = [...list.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  return { menu, trigger, list, items, runs };
};
const key = (target: EventTarget, k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

afterEach(() => {
  closeMenus();
  document.body.innerHTML = '';
});

describe('Menu', () => {
  it('starts closed: a labelled button that says it opens a menu', () => {
    const { trigger, list, items } = make();
    expect(trigger.textContent).toBe('Arrange');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(list.hidden).toBe(true);
    expect(items.map((i) => i.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(list.querySelector('[role="separator"]')).not.toBeNull();
  });

  it('a click opens it and focuses the first item; another click closes it', () => {
    const { trigger, list, items } = make();
    trigger.click();
    expect(list.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(items[0]);
    trigger.click();
    expect(list.hidden).toBe(true);
  });

  it('picking an item runs it, closes the menu and returns focus to the button', () => {
    const { trigger, list, items, runs } = make();
    trigger.click();
    items[1].click();
    expect(runs.b).toHaveBeenCalledTimes(1);
    expect(runs.a).not.toHaveBeenCalled();
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('a press outside closes it; a press inside does not', () => {
    const { trigger, list, items } = make();
    trigger.click();
    items[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(list.hidden).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(list.hidden).toBe(true);
  });

  it('Escape closes it, returns focus to the button and is consumed', () => {
    const { trigger, list, items } = make();
    trigger.click();
    expect(key(items[0], 'Escape').defaultPrevented).toBe(true);
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('arrow keys move between items, wrapping, skipping the divider; Home and End jump', () => {
    const { trigger, items } = make();
    trigger.click();
    expect(key(items[0], 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    key(items[1], 'ArrowDown');
    expect(document.activeElement).toBe(items[2]);
    key(items[2], 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    key(items[0], 'ArrowUp');
    expect(document.activeElement).toBe(items[2]);
    key(items[2], 'Home');
    expect(document.activeElement).toBe(items[0]);
    key(items[0], 'End');
    expect(document.activeElement).toBe(items[2]);
  });

  it('ArrowDown on the closed button opens it', () => {
    const { trigger, list, items } = make();
    trigger.focus();
    expect(key(trigger, 'ArrowDown').defaultPrevented).toBe(true);
    expect(list.hidden).toBe(false);
    expect(document.activeElement).toBe(items[0]);
  });

  it('opening one menu closes another', () => {
    const one = make('One');
    const two = make('Two');
    one.trigger.click();
    two.trigger.click();
    expect(one.list.hidden).toBe(true);
    expect(two.list.hidden).toBe(false);
  });

  it('closeMenus closes the open menu and says whether there was one', () => {
    const { trigger, list } = make();
    expect(closeMenus()).toBe(false);
    trigger.click();
    expect(closeMenus()).toBe(true);
    expect(list.hidden).toBe(true);
  });
});
