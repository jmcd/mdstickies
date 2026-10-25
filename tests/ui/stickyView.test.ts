// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StickyView, type StickyViewCallbacks } from '../../src/ui/stickyView';
import type { Sticky } from '../../src/model';

function make(over: Partial<Sticky> = {}) {
  const sticky: Sticky = {
    id: 's1', text: '## x', x: 100, y: 50, width: 220, height: 180, color: 'yellow', z: 3,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
  };
  const cb = {
    onChange: vi.fn(), onActivate: vi.fn(), onEditStart: vi.fn(), onEditEnd: vi.fn(), onDeleteRequest: vi.fn(),
  } satisfies StickyViewCallbacks;
  const view = new StickyView(sticky, cb);
  document.body.appendChild(view.el);
  return { view, cb, sticky };
}

afterEach(() => { document.body.innerHTML = ''; });

const body = (v: StickyView) => v.el.querySelector('.sticky-body') as HTMLElement;
const area = (v: StickyView) => v.el.querySelector('textarea') as HTMLTextAreaElement;

function ptr(target: Element, type: string, x: number, y: number) {
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y };
  target.dispatchEvent(
    typeof PointerEvent !== 'undefined' ? new PointerEvent(type, init) : new MouseEvent(type, init),
  );
}

describe('StickyView', () => {
  it('applies position, size, colour class and z', () => {
    const { view } = make();
    expect(view.el.dataset.id).toBe('s1');
    expect(view.el.style.left).toBe('100px');
    expect(view.el.style.top).toBe('50px');
    expect(view.el.style.width).toBe('220px');
    expect(view.el.style.height).toBe('180px');
    expect(view.el.style.zIndex).toBe('3');
    expect(view.el.classList.contains('sticky--yellow')).toBe(true);
  });

  it('renders markdown when not editing', () => {
    const { view } = make();
    expect(body(view).innerHTML).toContain('<h2');
  });

  it('click on rendered body enters edit mode with raw text', () => {
    const { view, cb } = make();
    body(view).click();
    expect(view.editing).toBe(true);
    expect(area(view).value).toBe('## x');
    expect(cb.onEditStart).toHaveBeenCalledWith('s1');
  });

  it('typing calls onChange({text}, {debounce:true})', () => {
    const { view, cb } = make();
    view.edit();
    area(view).value = 'hello';
    area(view).dispatchEvent(new Event('input', { bubbles: true }));
    expect(cb.onChange).toHaveBeenCalledWith('s1', { text: 'hello' }, { debounce: true });
  });

  it('focusout to outside the note ends editing and renders the latest text', () => {
    const { view, cb } = make();
    view.edit();
    area(view).value = '# typed';
    area(view).dispatchEvent(new Event('input', { bubbles: true }));
    area(view).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(view.editing).toBe(false);
    expect(cb.onEditEnd).toHaveBeenCalledWith('s1');
    expect(body(view).innerHTML).toContain('typed');
    expect(body(view).querySelector('h1')).not.toBeNull();
  });

  it('focusout to a control inside the note keeps editing', () => {
    const { view, cb } = make();
    view.edit();
    const dot = view.el.querySelector('[data-color="pink"]') as HTMLElement;
    area(view).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: dot }));
    expect(view.editing).toBe(true);
    expect(cb.onEditEnd).not.toHaveBeenCalled();
  });

  it('Escape in textarea ends editing', () => {
    const { view, cb } = make();
    view.edit();
    area(view).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.editing).toBe(false);
    expect(cb.onEditEnd).toHaveBeenCalledTimes(1);
  });

  it('Escape with a detached textarea still ends editing', () => {
    const { view, cb } = make();
    view.edit();
    const ta = area(view);
    view.el.remove();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.editing).toBe(false);
    expect(cb.onEditEnd).toHaveBeenCalledTimes(1);
  });

  it('edit() uses the latest sticky.text', () => {
    const { view, sticky } = make();
    view.update({ ...sticky, text: 'newer' });
    view.edit();
    expect(area(view).value).toBe('newer');
  });

  it('clicking a rendered checkbox calls onChange with toggled text and does not enter edit mode', () => {
    const { view, cb } = make({ text: '- [ ] a\n- [ ] b' });
    (body(view).querySelector('input[data-task-index="1"]') as HTMLElement).click();
    expect(cb.onChange).toHaveBeenCalledWith('s1', { text: '- [ ] a\n- [x] b' }, { debounce: false });
    expect(view.editing).toBe(false);
    expect(cb.onEditStart).not.toHaveBeenCalled();
  });

  it('clicking a link does not enter edit mode', () => {
    const { view } = make({ text: '[l](https://example.com)' });
    const a = body(view).querySelector('a') as HTMLElement;
    a.addEventListener('click', (e) => e.preventDefault());
    a.click();
    expect(view.editing).toBe(false);
  });

  it('colour dot click calls onChange({color}) without editing', () => {
    const { view, cb } = make();
    const dot = view.el.querySelector('[data-color="blue"]') as HTMLElement;
    expect(dot.getAttribute('aria-label')).toBeTruthy();
    dot.click();
    expect(cb.onChange).toHaveBeenCalledWith('s1', { color: 'blue' }, { debounce: false });
    expect(view.editing).toBe(false);
  });

  it('x calls onDeleteRequest', () => {
    const { view, cb } = make();
    (view.el.querySelector('.sticky-delete') as HTMLElement).click();
    expect(cb.onDeleteRequest).toHaveBeenCalledWith('s1');
    expect(view.editing).toBe(false);
  });

  it('pointerdown anywhere activates', () => {
    const { view, cb } = make();
    ptr(body(view), 'pointerdown', 0, 0);
    expect(cb.onActivate).toHaveBeenCalledWith('s1');
  });

  it('dragging the bar moves the note and reports x/y once on pointerup, clamped >= 0', () => {
    const { view, cb } = make();
    const bar = view.el.querySelector('.sticky-bar') as HTMLElement;
    ptr(bar, 'pointerdown', 10, 10);
    ptr(bar, 'pointermove', 40, 30);
    expect(view.el.style.left).toBe('130px');
    expect(view.el.style.top).toBe('70px');
    expect(cb.onChange).not.toHaveBeenCalled();
    ptr(bar, 'pointermove', -500, -500);
    ptr(bar, 'pointerup', -500, -500);
    expect(cb.onChange).toHaveBeenCalledTimes(1);
    expect(cb.onChange).toHaveBeenCalledWith('s1', { x: 0, y: 0 }, { debounce: false });
  });

  it('colour dots and x do not start a drag', () => {
    const { view, cb } = make();
    const dot = view.el.querySelector('[data-color="pink"]') as HTMLElement;
    ptr(dot, 'pointerdown', 0, 0);
    ptr(dot, 'pointermove', 50, 50);
    ptr(dot, 'pointerup', 50, 50);
    expect(view.el.style.left).toBe('100px');
    expect(cb.onChange).not.toHaveBeenCalled();
  });

  it('rendered body drag beyond 4px moves instead of entering edit mode', () => {
    const { view, cb } = make();
    const b = body(view);
    ptr(b, 'pointerdown', 0, 0);
    ptr(b, 'pointermove', 2, 2);
    expect(view.el.style.left).toBe('100px');
    ptr(b, 'pointermove', 20, 0);
    expect(view.el.style.left).toBe('120px');
    ptr(b, 'pointerup', 20, 0);
    b.click();
    expect(view.editing).toBe(false);
    expect(cb.onChange).toHaveBeenCalledWith('s1', { x: 120, y: 50 }, { debounce: false });
  });

  it('small movement on the body still counts as a click', () => {
    const { view, cb } = make();
    const b = body(view);
    ptr(b, 'pointerdown', 0, 0);
    ptr(b, 'pointermove', 2, 1);
    ptr(b, 'pointerup', 2, 1);
    b.click();
    expect(view.editing).toBe(true);
    expect(cb.onChange).not.toHaveBeenCalled();
  });

  it('resize handle reports width/height, not below MIN_SIZE', () => {
    const { view, cb } = make();
    const h = view.el.querySelector('.sticky-resize') as HTMLElement;
    ptr(h, 'pointerdown', 0, 0);
    ptr(h, 'pointermove', 30, 20);
    expect(view.el.style.width).toBe('250px');
    expect(view.el.style.height).toBe('200px');
    ptr(h, 'pointermove', -1000, -1000);
    ptr(h, 'pointerup', -1000, -1000);
    expect(cb.onChange).toHaveBeenCalledTimes(1);
    expect(cb.onChange).toHaveBeenCalledWith('s1', { width: 140, height: 100 }, { debounce: false });
  });

  it('update() while editing does not overwrite the textarea', () => {
    const { view, sticky } = make();
    view.edit();
    area(view).value = 'in progress';
    view.update({ ...sticky, text: 'from board', color: 'green' });
    expect(area(view).value).toBe('in progress');
    expect(view.el.classList.contains('sticky--green')).toBe(true);
    expect(view.el.classList.contains('sticky--yellow')).toBe(false);
  });

  it('update() while not editing re-renders', () => {
    const { view, sticky } = make();
    view.update({ ...sticky, text: '# fresh' });
    expect(body(view).querySelector('h1')).not.toBeNull();
  });
});
