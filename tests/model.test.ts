import { expect, test } from 'vitest';
import { createSticky, touch } from '../src/model';

test('createSticky uses defaults', () => {
  const now = new Date('2026-10-25T10:00:00.000Z');
  const s = createSticky({ x: 10, y: 20, z: 3 }, now);
  expect(s).toMatchObject({ text: '', x: 10, y: 20, z: 3, color: 'yellow', width: 220, height: 180,
    createdAt: now.toISOString(), updatedAt: now.toISOString() });
  expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
});
test('createSticky clamps negative positions to 0', () => {
  expect(createSticky({ x: -5, y: -1, z: 0 })).toMatchObject({ x: 0, y: 0 });
});
test('touch applies changes and strictly advances updatedAt even within the same ms', () => {
  const now = new Date('2026-10-25T10:00:00.000Z');
  const s = createSticky({ x: 0, y: 0, z: 0 }, now);
  const t = touch(s, { text: 'hi' }, now);
  expect(t.text).toBe('hi');
  expect(Date.parse(t.updatedAt)).toBe(now.getTime() + 1);
  expect(s.text).toBe(''); // immutable
});
test('touch clamps x/y and enforces MIN_SIZE', () => {
  const s = touch(createSticky({ x: 0, y: 0, z: 0 }), { x: -9, width: 10, height: 10 });
  expect(s).toMatchObject({ x: 0, width: 140, height: 100 });
});
