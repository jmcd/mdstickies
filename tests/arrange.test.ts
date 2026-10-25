import { describe, it, expect } from 'vitest';
import {
  cascade, grid, alignLeft, alignTop, sameSize, toFront, clampDelta, touches, normalizeRect,
} from '../src/arrange';
import type { Sticky } from '../src/model';

function sticky(over: Partial<Sticky> = {}): Sticky {
  return {
    id: 's1', text: '', x: 10, y: 20, width: 220, height: 180, color: 'yellow', z: 1,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...over,
  };
}

describe('arrange', () => {
  it('cascade keeps back-to-front order, starts at the bounding box corner, offsets 30px, stacks above topZ', () => {
    const a = sticky({ id: 'a', z: 2, x: 100, y: 50 });
    const b = sticky({ id: 'b', z: 1, x: 300, y: 10 });
    const c = sticky({ id: 'c', z: 5, x: 40, y: 200 });
    expect(cascade([a, b, c], 9)).toEqual([
      { id: 'b', changes: { x: 40, y: 10, z: 10 } },
      { id: 'a', changes: { x: 70, y: 40, z: 11 } },
      { id: 'c', changes: { x: 100, y: 70, z: 12 } },
    ]);
  });

  it('grid orders by reading position and uses ceil(sqrt(n)) columns with the largest width/height as the cell', () => {
    const sel = [
      sticky({ id: 'a', x: 20, y: 100, width: 300, height: 100 }),
      sticky({ id: 'b', x: 400, y: 30, width: 150, height: 200 }),
      sticky({ id: 'c', x: 50, y: 30, width: 200, height: 150 }),
      sticky({ id: 'd', x: 500, y: 100, width: 140, height: 100 }),
      sticky({ id: 'e', x: 30, y: 300, width: 140, height: 100 }),
    ];
    const out = grid(sel);
    expect(out.map((l) => l.id)).toEqual(['c', 'b', 'a', 'd', 'e']);
    expect(out[0].changes).toEqual({ x: 20, y: 30 });
    expect(out[1].changes).toEqual({ x: 20 + 300 + 16, y: 30 });
    expect(out[3].changes).toEqual({ x: 20, y: 30 + 200 + 16 });
  });

  it('alignLeft sets every x to the minimum x; alignTop every y to the minimum y', () => {
    const sel = [sticky({ id: 'a', x: 50, y: 70 }), sticky({ id: 'b', x: 20, y: 90 })];
    expect(alignLeft(sel)).toEqual([{ id: 'a', changes: { x: 20 } }, { id: 'b', changes: { x: 20 } }]);
    expect(alignTop(sel)).toEqual([{ id: 'a', changes: { y: 70 } }, { id: 'b', changes: { y: 70 } }]);
  });

  it('sameSize gives everyone the width and height of the largest-area note (first wins a tie)', () => {
    const sel = [
      sticky({ id: 'a', width: 200, height: 100 }),
      sticky({ id: 'b', width: 100, height: 200 }),
      sticky({ id: 'c', width: 150, height: 100 }),
    ];
    for (const l of sameSize(sel)) expect(l.changes).toEqual({ width: 200, height: 100 });
    expect(sameSize(sel)).toHaveLength(3);
  });

  it('toFront lifts the selection above topZ keeping its own order', () => {
    const sel = [sticky({ id: 'a', z: 4 }), sticky({ id: 'b', z: 1 }), sticky({ id: 'c', z: 7 })];
    expect(toFront(sel, 7)).toEqual([
      { id: 'a', changes: { z: 9 } },
      { id: 'b', changes: { z: 8 } },
      { id: 'c', changes: { z: 10 } },
    ]);
  });

  it('clampDelta stops the whole group at the edge', () => {
    const sel = [sticky({ x: 5, y: 40 }), sticky({ id: 's2', x: 100, y: 60 })];
    expect(clampDelta(sel, -20, 15)).toEqual({ dx: -5, dy: 15 });
    expect(clampDelta(sel, 3, -100)).toEqual({ dx: 3, dy: -40 });
    expect(clampDelta([], -4, -5)).toEqual({ dx: -4, dy: -5 });
  });

  it('touches is any overlap, edges touching do not count', () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    expect(touches(r, sticky({ x: 10, y: 0 }))).toBe(false);
    expect(touches(r, sticky({ x: 9, y: 0 }))).toBe(true);
  });

  it('normalizeRect handles a box dragged up-left', () => {
    expect(normalizeRect(50, 60, 10, 20)).toEqual({ x: 10, y: 20, width: 40, height: 40 });
  });

  it('empty selections give empty layouts and inputs are not mutated', () => {
    expect(cascade([], 3)).toEqual([]);
    expect(grid([])).toEqual([]);
    expect(alignLeft([])).toEqual([]);
    expect(sameSize([])).toEqual([]);
    expect(toFront([], 3)).toEqual([]);
    const sel = [sticky({ id: 'a', x: 9, y: 9 }), sticky({ id: 'b', x: 1, y: 1 })];
    const copy = structuredClone(sel);
    grid(sel); cascade(sel, 1);
    expect(sel).toEqual(copy);
  });
});
