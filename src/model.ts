export const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'] as const;
export type StickyColor = (typeof COLORS)[number];

export interface Sticky {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: StickyColor;
  z: number;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

export const DEFAULT_SIZE = { width: 220, height: 180 };
export const MIN_SIZE = { width: 140, height: 100 };

export function createSticky(at: { x: number; y: number; z: number }, now: Date = new Date()): Sticky {
  const iso = now.toISOString();
  return {
    id: crypto.randomUUID(),
    text: '',
    x: Math.max(0, at.x),
    y: Math.max(0, at.y),
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    color: 'yellow',
    z: at.z,
    createdAt: iso,
    updatedAt: iso,
  };
}

export function touch(
  s: Sticky,
  changes: Partial<Omit<Sticky, 'id' | 'createdAt'>>,
  now: Date = new Date(),
): Sticky {
  const next: Sticky = { ...s, ...changes };
  next.x = Math.max(0, next.x);
  next.y = Math.max(0, next.y);
  next.width = Math.max(MIN_SIZE.width, next.width);
  next.height = Math.max(MIN_SIZE.height, next.height);
  const ms = Math.max(now.getTime(), Date.parse(s.updatedAt) + 1);
  next.updatedAt = new Date(ms).toISOString();
  return next;
}
