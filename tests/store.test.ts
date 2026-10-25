import { describe, expect, test } from 'vitest';
import { CLEARED_KEY, KEY_PREFIX, StickyStore, StorageFailure, parseStorageEvent, resolveRemote } from '../src/store';
import type { RemoteChange } from '../src/store';
import { FakeStorage } from './helpers/fakeStorage';
import { touch } from '../src/model';
import type { Sticky } from '../src/model';

const ID = 'a';
function mk(id: string): Sticky {
  return {
    id, text: 'hi', x: 1, y: 2, width: 220, height: 180, color: 'yellow', z: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
const s1 = mk('one');
const s2 = mk('two');
const older = mk(ID);
const newer = touch(older, { text: 'newer' });

describe('StickyStore', () => {
  test('put/get/loadAll round-trip, one key per sticky', () => {
    const st = new FakeStorage();
    const store = new StickyStore(st);
    store.put(s1);
    expect(st.getItem(KEY_PREFIX + s1.id)).not.toBeNull();
    expect(store.get(s1.id)).toEqual(s1);
    expect(store.loadAll()).toEqual([s1]);
    expect(store.get('missing')).toBeUndefined();
  });

  test('loadAll skips corrupt entries and foreign keys', () => {
    const st = new FakeStorage();
    const store = new StickyStore(st);
    store.put(s1);
    st.setItem(KEY_PREFIX + 'bad', '{not json');
    st.setItem(KEY_PREFIX + 'shape', JSON.stringify({ id: 'x' }));
    st.setItem('other-app:key', JSON.stringify(s2));
    expect(store.loadAll()).toEqual([s1]);
    expect(store.get('bad')).toBeUndefined();
  });

  test('put throws StorageFailure when quota exceeded, keeping the cause', () => {
    const st = new FakeStorage();
    st.failWrites = true;
    let err: unknown;
    try { new StickyStore(st).put(s1); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(StorageFailure);
    expect((err as StorageFailure).cause).toBeInstanceOf(DOMException);
  });

  test('null storage: loadAll is [], put throws StorageFailure, remove/clearAll are no-ops', () => {
    const store = new StickyStore(null);
    expect(store.loadAll()).toEqual([]);
    expect(store.get('x')).toBeUndefined();
    expect(() => store.put(s1)).toThrow(StorageFailure);
    expect(() => store.remove('x')).not.toThrow();
    expect(() => store.clearAll()).not.toThrow();
  });

  test('remove deletes one sticky', () => {
    const st = new FakeStorage();
    const store = new StickyStore(st);
    store.put(s1); store.put(s2);
    store.remove(s1.id);
    expect(store.loadAll()).toEqual([s2]);
  });

  test('clearAll removes sticky keys only and writes CLEARED_KEY', () => {
    const st = new FakeStorage();
    const store = new StickyStore(st);
    for (const id of ['1', '2', '3', '4']) store.put(mk(id));
    st.setItem('other-app:key', 'keep');
    store.clearAll();
    expect(store.loadAll()).toEqual([]);
    expect(st.getItem('other-app:key')).toBe('keep');
    const marker = st.getItem(CLEARED_KEY);
    expect(marker).not.toBeNull();
    expect(Number.isNaN(Date.parse(marker!.split('#')[0]))).toBe(false);
    expect(st.length).toBe(2);
  });

  test('clearAll writes the marker before removing any sticky key, and each marker is unique', () => {
    const st = new FakeStorage();
    const store = new StickyStore(st);
    store.put(s1); store.put(s2);
    const ops: string[] = [];
    const set = st.setItem.bind(st), rem = st.removeItem.bind(st);
    st.setItem = (k, v) => { ops.push(`set:${k}`); set(k, v); };
    st.removeItem = (k) => { ops.push(`remove:${k}`); rem(k); };
    store.clearAll();
    const first = st.getItem(CLEARED_KEY);
    expect(ops).toEqual([
      `set:${CLEARED_KEY}`,
      expect.stringMatching(/^remove:/),
      expect.stringMatching(/^remove:/),
    ]);
    store.clearAll();
    expect(st.getItem(CLEARED_KEY)).not.toBe(first);
  });

  test('two stores on one storage do not clobber each other', () => {
    const st = new FakeStorage();
    const a = new StickyStore(st), b = new StickyStore(st);
    a.put(s1); b.put(s2);
    expect(new StickyStore(st).loadAll().map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  });
});

describe('parseStorageEvent', () => {
  test.each<[string, string | null, string | null, RemoteChange | null]>([
    ['null key (storage.clear)', null, null, { kind: 'clear' }],
    ['cleared marker written', CLEARED_KEY, '2026-01-01T00:00:00.000Z', { kind: 'clear' }],
    ['cleared marker removed', CLEARED_KEY, null, null],
    ['valid sticky', KEY_PREFIX + s1.id, JSON.stringify(s1), { kind: 'upsert', sticky: s1 }],
    ['corrupt json', KEY_PREFIX + 'x', '{nope', null],
    ['fails isSticky', KEY_PREFIX + 'x', JSON.stringify({ id: 'x' }), null],
    ['removed sticky', KEY_PREFIX + s1.id, null, { kind: 'remove', id: s1.id }],
    ['foreign key', 'other', JSON.stringify(s1), null],
    ['foreign key removed', 'other', null, null],
  ])('%s', (_n, key, value, want) => {
    expect(parseStorageEvent(key, value)).toEqual(want);
  });
});

describe('resolveRemote', () => {
  test.each<[string, Sticky | undefined, RemoteChange, string | null, string]>([
    ['clear', undefined, { kind: 'clear' }, null, 'apply'],
    ['clear while editing', older, { kind: 'clear' }, ID, 'apply'],
    ['upsert new', undefined, { kind: 'upsert', sticky: newer }, null, 'apply'],
    ['upsert newer', older, { kind: 'upsert', sticky: newer }, null, 'apply'],
    ['upsert older', newer, { kind: 'upsert', sticky: older }, null, 'ignore'],
    ['upsert equal timestamp', older, { kind: 'upsert', sticky: { ...older, text: 'x' } }, null, 'ignore'],
    ['upsert while editing', older, { kind: 'upsert', sticky: newer }, ID, 'ignore'],
    ['remove', older, { kind: 'remove', id: ID }, null, 'apply'],
    ['remove while editing', older, { kind: 'remove', id: ID }, ID, 'resave-local'],
    ['remove of another while editing', older, { kind: 'remove', id: ID }, 'other', 'apply'],
  ])('%s', (_n, local, change, editing, want) => {
    expect(resolveRemote(local, change, editing)).toBe(want);
  });
});
