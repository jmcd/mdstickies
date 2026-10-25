// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StickyView, type StickyViewCallbacks } from '../../src/ui/stickyView';
import type { Sticky } from '../../src/model';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

function ptr(target: Element, type: string, x: number, y: number, extra: { button?: number; buttons?: number } = {}) {
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, ...extra };
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

  it('marks the note with an editing class only while editing', () => {
    const { view } = make({ text: '- [ ] a' });
    (view.el.querySelector('input[data-task-index="0"]') as HTMLInputElement).focus();
    expect(view.el.classList.contains('editing')).toBe(false);
    view.edit();
    expect(view.el.classList.contains('editing')).toBe(true);
    area(view).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(view.el.classList.contains('editing')).toBe(false);
  });

  it('draws the edit outline from the editing class, not from focus-within', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles.css'), 'utf8');
    expect(css).not.toMatch(/\.sticky:focus-within/);
    expect(css).toMatch(/\.sticky\.editing\s*\{[^}]*outline/);
  });

  describe('colour palette', () => {
    const palette = (v: StickyView) => v.el.querySelector('.sticky-palette') as HTMLButtonElement;
    const swatches = (v: StickyView) => v.el.querySelector('.sticky-colors') as HTMLElement;

    it('starts closed behind a labelled palette button', () => {
      const { view } = make();
      expect(palette(view).getAttribute('aria-label')).toBe('Change colour');
      expect(palette(view).getAttribute('aria-expanded')).toBe('false');
      expect(swatches(view).hidden).toBe(true);
    });

    // jsdom hides [hidden] regardless of author CSS, so it can't show `.sticky-colors { display: flex }`
    // overriding it in real browsers; assert the stylesheet forces [hidden] to win instead.
    it('stylesheet makes the hidden attribute beat display rules', () => {
      const css = readFileSync(resolve(__dirname, '../../src/styles.css'), 'utf8');
      expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
    });

    it('palette button toggles the swatches open and closed', () => {
      const { view, cb } = make();
      palette(view).click();
      expect(swatches(view).hidden).toBe(false);
      expect(palette(view).getAttribute('aria-expanded')).toBe('true');
      palette(view).click();
      expect(swatches(view).hidden).toBe(true);
      expect(view.editing).toBe(false);
      expect(cb.onChange).not.toHaveBeenCalled();
    });

    it('picking a colour reports it and closes the swatches', () => {
      const { view, cb } = make();
      palette(view).click();
      (view.el.querySelector('.sticky-dot--blue') as HTMLElement).click();
      expect(cb.onChange).toHaveBeenCalledWith('s1', { color: 'blue' }, { debounce: false });
      expect(swatches(view).hidden).toBe(true);
    });

    it('Escape closes the swatches', () => {
      const { view } = make();
      palette(view).click();
      view.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(swatches(view).hidden).toBe(true);
    });

    it('pressing anywhere outside the note closes the swatches', () => {
      const { view } = make();
      palette(view).click();
      ptr(document.body, 'pointerdown', 0, 0);
      expect(swatches(view).hidden).toBe(true);
    });

    it('pressing inside the open swatches does not close them', () => {
      const { view } = make();
      palette(view).click();
      ptr(swatches(view), 'pointerdown', 0, 0);
      expect(swatches(view).hidden).toBe(false);
    });

    it('palette press neither drags nor steals focus from the textarea', () => {
      const { view, cb } = make();
      ptr(palette(view), 'pointerdown', 10, 10);
      ptr(palette(view), 'pointermove', 60, 60);
      ptr(palette(view), 'pointerup', 60, 60);
      expect(cb.onChange).not.toHaveBeenCalled();
      view.edit();
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      palette(view).dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
    });
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

  it('update() that changes only z does not touch the body DOM; changed text still re-renders', () => {
    const { view, sticky } = make();
    const h2 = body(view).querySelector('h2');
    view.update({ ...sticky, z: 9 });
    expect(body(view).querySelector('h2')).toBe(h2);
    view.update({ ...sticky, z: 9, text: '# new' });
    expect(body(view).querySelector('h1')).not.toBeNull();
  });

  it('onActivate that raises z via update() does not break a checkbox click', () => {
    const { view, cb, sticky } = make({ text: '- [ ] a\n- [ ] b' });
    cb.onActivate.mockImplementation(() => view.update({ ...sticky, z: 9 }));
    const box = body(view).querySelector('input[data-task-index="0"]') as HTMLElement;
    ptr(box, 'pointerdown', 0, 0);
    ptr(box, 'pointerup', 0, 0);
    box.click();
    expect(cb.onChange).toHaveBeenCalledWith('s1', { text: '- [x] a\n- [ ] b' }, { debounce: false });
    expect(view.editing).toBe(false);
  });

  it('mousedown on dot or x is default-prevented only while editing', () => {
    const { view } = make();
    const dot = view.el.querySelector('[data-color="pink"]') as HTMLElement;
    const del = view.el.querySelector('.sticky-delete') as HTMLElement;
    const down = (t: HTMLElement) => {
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      t.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(down(dot)).toBe(false);
    view.edit();
    expect(down(dot)).toBe(true);
    expect(down(del)).toBe(true);
    expect(down(area(view))).toBe(false);
  });

  it('toggles the dragging class while a gesture is active, and clears the selection', () => {
    const { view } = make();
    const removeAllRanges = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({ removeAllRanges } as unknown as Selection);
    const b = body(view);
    ptr(b, 'pointerdown', 0, 0);
    expect(view.el.classList.contains('dragging')).toBe(false); // below threshold
    ptr(b, 'pointermove', 20, 0);
    expect(view.el.classList.contains('dragging')).toBe(true);
    expect(removeAllRanges).toHaveBeenCalled();
    ptr(b, 'pointerup', 20, 0);
    expect(view.el.classList.contains('dragging')).toBe(false);

    const bar = view.el.querySelector('.sticky-bar') as HTMLElement;
    ptr(bar, 'pointerdown', 0, 0);
    expect(view.el.classList.contains('dragging')).toBe(true);
    ptr(bar, 'pointercancel', 0, 0);
    expect(view.el.classList.contains('dragging')).toBe(false);
    vi.restoreAllMocks();
  });

  it('dragstart is prevented unless editing', () => {
    const { view } = make();
    const ev = () => new Event('dragstart', { bubbles: true, cancelable: true });
    const e1 = ev();
    body(view).dispatchEvent(e1);
    expect(e1.defaultPrevented).toBe(true);
    view.edit();
    const e2 = ev();
    area(view).dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
  });

  it('a right-button press activates but starts no gesture', () => {
    const { view, cb } = make();
    const bar = view.el.querySelector('.sticky-bar') as HTMLElement;
    ptr(bar, 'pointerdown', 10, 10, { button: 2, buttons: 2 });
    expect(cb.onActivate).toHaveBeenCalledWith('s1');
    ptr(bar, 'pointermove', 60, 60);
    expect(view.el.style.left).toBe('100px');
    expect(view.el.classList.contains('dragging')).toBe(false);
  });

  it('a move with no buttons held cancels the gesture and snaps back', () => {
    const { view, cb } = make();
    const bar = view.el.querySelector('.sticky-bar') as HTMLElement;
    ptr(bar, 'pointerdown', 10, 10);
    ptr(bar, 'pointermove', 40, 30);
    expect(view.el.style.left).toBe('130px');
    ptr(bar, 'pointermove', 80, 80, { buttons: 0 });
    expect(view.el.style.left).toBe('100px');
    expect(view.el.classList.contains('dragging')).toBe(false);
    ptr(bar, 'pointermove', 90, 90);
    expect(view.el.style.left).toBe('100px');
    expect(cb.onChange).not.toHaveBeenCalled();
  });

  it('lostpointercapture cancels an active gesture', () => {
    const { view, cb } = make();
    const bar = view.el.querySelector('.sticky-bar') as HTMLElement;
    ptr(bar, 'pointerdown', 10, 10);
    ptr(bar, 'pointermove', 40, 30);
    bar.dispatchEvent(new Event('lostpointercapture', { bubbles: true }));
    expect(view.el.style.left).toBe('100px');
    expect(view.el.classList.contains('dragging')).toBe(false);
    ptr(bar, 'pointerup', 40, 30);
    expect(cb.onChange).not.toHaveBeenCalled();
  });
});
