// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { seedDemo, WELCOMED_KEY } from '../src/demo';
import { CLEARED_KEY, StickyStore } from '../src/store';
import { renderMarkdown } from '../src/markdown';
import { FakeStorage } from './helpers/fakeStorage';
import type { Sticky } from '../src/model';

const now = new Date('2026-10-27T12:00:00.000Z');

describe('seedDemo', () => {
  it('seeds demo notes on a brand-new board and marks it welcomed', () => {
    const storage = new FakeStorage();
    const store = new StickyStore(storage);
    const seeded = seedDemo(storage, store, now);
    expect(seeded.length).toBeGreaterThan(0);
    expect(store.loadAll()).toHaveLength(seeded.length);
    expect(storage.getItem(WELCOMED_KEY)).not.toBeNull();
  });

  it('demonstrates the main syntax', () => {
    const storage = new FakeStorage();
    const html = seedDemo(storage, new StickyStore(storage), now).map((s) => renderMarkdown(s.text)).join('');
    for (const tag of ['<h1', '<strong', '<em', '<del', '<code', '<a ', '<blockquote', '<ol', 'type="checkbox"', 'class="hljs'])
      expect(html).toContain(tag);
  });

  it('does not seed again once welcomed, even if the board is empty', () => {
    const storage = new FakeStorage();
    const store = new StickyStore(storage);
    for (const s of seedDemo(storage, store, now)) store.remove(s.id);
    expect(seedDemo(storage, store, now)).toEqual([]);
    expect(store.loadAll()).toEqual([]);
  });

  it('does not seed a board that already has notes or was cleared', () => {
    const withNotes = new FakeStorage();
    const store = new StickyStore(withNotes);
    store.put({ id: 'a', text: 'mine', x: 0, y: 0, width: 220, height: 180, color: 'yellow', z: 1,
      createdAt: now.toISOString(), updatedAt: now.toISOString() } satisfies Sticky);
    expect(seedDemo(withNotes, store, now)).toEqual([]);

    const cleared = new FakeStorage();
    cleared.setItem(CLEARED_KEY, 'x');
    expect(seedDemo(cleared, new StickyStore(cleared), now)).toEqual([]);
  });

  it('does nothing without storage, and survives a full storage', () => {
    expect(seedDemo(null, new StickyStore(null), now)).toEqual([]);
    const full = new FakeStorage();
    full.failWrites = true;
    expect(seedDemo(full, new StickyStore(full), now)).toEqual([]);
  });
});
