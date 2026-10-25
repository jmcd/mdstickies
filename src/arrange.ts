import type { Sticky } from './model';

export type Geometry = Partial<Pick<Sticky, 'x' | 'y' | 'width' | 'height' | 'z'>>;
export type Layout = Array<{ id: string; changes: Geometry }>;
export interface Rect { x: number; y: number; width: number; height: number }

export const CASCADE_OFFSET = 30;
export const GRID_GAP = 16;

function origin(sel: Sticky[]) {
  return { x: Math.min(...sel.map((s) => s.x)), y: Math.min(...sel.map((s) => s.y)) };
}

export function cascade(sel: Sticky[], topZ: number): Layout {
  if (!sel.length) return [];
  const o = origin(sel);
  return [...sel].sort((a, b) => a.z - b.z).map((s, i) => ({
    id: s.id,
    changes: { x: o.x + i * CASCADE_OFFSET, y: o.y + i * CASCADE_OFFSET, z: topZ + 1 + i },
  }));
}

export function grid(sel: Sticky[]): Layout {
  if (!sel.length) return [];
  const o = origin(sel);
  const cols = Math.ceil(Math.sqrt(sel.length));
  const cellW = Math.max(...sel.map((s) => s.width));
  const cellH = Math.max(...sel.map((s) => s.height));
  return [...sel].sort((a, b) => a.y - b.y || a.x - b.x).map((s, i) => ({
    id: s.id,
    changes: {
      x: o.x + (i % cols) * (cellW + GRID_GAP),
      y: o.y + Math.floor(i / cols) * (cellH + GRID_GAP),
    },
  }));
}

export function alignLeft(sel: Sticky[]): Layout {
  if (!sel.length) return [];
  const x = origin(sel).x;
  return sel.map((s) => ({ id: s.id, changes: { x } }));
}

export function alignTop(sel: Sticky[]): Layout {
  if (!sel.length) return [];
  const y = origin(sel).y;
  return sel.map((s) => ({ id: s.id, changes: { y } }));
}

export function sameSize(sel: Sticky[]): Layout {
  if (!sel.length) return [];
  const big = sel.reduce((m, s) => (s.width * s.height > m.width * m.height ? s : m));
  return sel.map((s) => ({ id: s.id, changes: { width: big.width, height: big.height } }));
}

export function toFront(sel: Sticky[], topZ: number): Layout {
  const rank = new Map([...sel].sort((a, b) => a.z - b.z).map((s, i) => [s.id, i]));
  return sel.map((s) => ({ id: s.id, changes: { z: topZ + 1 + rank.get(s.id)! } }));
}

export function clampDelta(sel: Sticky[], dx: number, dy: number): { dx: number; dy: number } {
  if (!sel.length) return { dx, dy };
  const o = origin(sel);
  return { dx: Math.max(dx, -o.x), dy: Math.max(dy, -o.y) };
}

export function touches(r: Rect, s: Sticky): boolean {
  return r.x < s.x + s.width && s.x < r.x + r.width && r.y < s.y + s.height && s.y < r.y + r.height;
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
