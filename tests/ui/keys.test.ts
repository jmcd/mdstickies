import { describe, it, expect } from 'vitest';
import { isSelectModifier, isPrimaryShortcut } from '../../src/ui/keys';

const ev = (o: Partial<KeyboardEvent>) => ({ shiftKey: false, ctrlKey: false, metaKey: false, ...o }) as KeyboardEvent;

describe('keys', () => {
  it('shift selects on both platforms', () => {
    expect(isSelectModifier(ev({ shiftKey: true }), true)).toBe(true);
    expect(isSelectModifier(ev({ shiftKey: true }), false)).toBe(true);
  });
  it('meta selects only on mac, ctrl only elsewhere', () => {
    expect(isSelectModifier(ev({ metaKey: true }), true)).toBe(true);
    expect(isSelectModifier(ev({ metaKey: true }), false)).toBe(false);
    expect(isSelectModifier(ev({ ctrlKey: true }), false)).toBe(true);
    expect(isSelectModifier(ev({ ctrlKey: true }), true)).toBe(false);
    expect(isSelectModifier(ev({}), false)).toBe(false);
  });
  it('primary shortcut is meta on mac, ctrl elsewhere; shift alone is not', () => {
    expect(isPrimaryShortcut(ev({ metaKey: true }), true)).toBe(true);
    expect(isPrimaryShortcut(ev({ ctrlKey: true }), true)).toBe(false);
    expect(isPrimaryShortcut(ev({ ctrlKey: true }), false)).toBe(true);
    expect(isPrimaryShortcut(ev({ metaKey: true }), false)).toBe(false);
    expect(isPrimaryShortcut(ev({ shiftKey: true }), false)).toBe(false);
  });
});
