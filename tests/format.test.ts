import { describe, expect, test } from 'vitest';
import { ImportError, exportFileName, parseBoardFile, prepareAdd, serializeBoard } from '../src/format';
import type { Sticky } from '../src/model';

function sample(): Sticky {
  return {
    id: 'a', text: 'hello', x: 10, y: 20, width: 220, height: 180, color: 'yellow', z: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  };
}
function fileWith(...stickies: unknown[]): string {
  return JSON.stringify({ app: 'mdstickies', version: 1, stickies });
}

describe('format', () => {
  test('round-trips', () => { const s = [sample()]; expect(parseBoardFile(serializeBoard(s))).toEqual(s); });
  test('file name uses local date', () => { expect(exportFileName(new Date(2026, 0, 5))).toBe('mdstickies-2026-01-05.json'); });
  test.each([
    ['not json', 'nope', /not a valid/i],
    ['wrong app', JSON.stringify({ app: 'x', version: 1, stickies: [] }), /not an mdstickies file/i],
    ['newer version', JSON.stringify({ app: 'mdstickies', version: 2, stickies: [] }), /newer version/i],
    ['missing field', fileWith({ ...sample(), text: undefined }), /invalid sticky/i],
    ['bad type', fileWith({ ...sample(), x: '1' }), /invalid sticky/i],
    ['unknown colour', fileWith({ ...sample(), color: 'teal' }), /invalid sticky/i],
    ['non-finite number', fileWith({ ...sample(), width: 1e999 }), /invalid sticky/i],
    ['bad timestamp', fileWith({ ...sample(), createdAt: 'yesterday' }), /invalid sticky/i],
    ['duplicate ids', fileWith(sample(), sample()), /duplicate/i],
  ])('rejects %s', (_n, json, msg) => { expect(() => parseBoardFile(json)).toThrow(ImportError); expect(() => parseBoardFile(json)).toThrow(msg); });
  test('clamps negative positions and undersize dimensions', () => {
    expect(parseBoardFile(fileWith({ ...sample(), x: -10, y: -2, width: 5 }))[0]).toMatchObject({ x: 0, y: 0, width: 140 });
  });
  test('prepareAdd gives fresh ids and stacks above current', () => {
    const cur = [{ ...sample(), z: 7 }]; const imp = [{ ...sample(), z: 1 }, { ...sample(), id: 'b', z: 0 }];
    const now = new Date('2026-05-05T00:00:00.000Z');
    const out = prepareAdd(cur, imp, now);
    expect(out.every(s => s.id !== cur[0].id && s.id !== 'b')).toBe(true);
    expect(out.map(s => s.z)).toEqual([9, 8]);
    expect(out.every(s => s.updatedAt === now.toISOString() && s.createdAt === sample().createdAt)).toBe(true);
  });
});
