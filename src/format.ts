import { COLORS, MIN_SIZE, type Sticky } from './model';

export class ImportError extends Error {}

const APP = 'mdstickies';
const VERSION = 1;

export function serializeBoard(stickies: Sticky[]): string {
  return JSON.stringify({ app: APP, version: VERSION, stickies }, null, 2);
}

export function exportFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${APP}-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

export function isSticky(v: unknown): v is Sticky {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    s.id !== '' &&
    typeof s.text === 'string' &&
    isNum(s.x) && isNum(s.y) && isNum(s.width) && isNum(s.height) && isNum(s.z) &&
    typeof s.color === 'string' &&
    (COLORS as readonly string[]).includes(s.color) &&
    isTime(s.createdAt) && isTime(s.updatedAt)
  );
}

export function parseBoardFile(json: string): Sticky[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ImportError('This file is not a valid JSON file.');
  }
  const file = data as { app?: unknown; version?: unknown; stickies?: unknown } | null;
  if (typeof file !== 'object' || file === null || file.app !== APP) {
    throw new ImportError('This is not an mdstickies file.');
  }
  if (typeof file.version !== 'number' || file.version > VERSION) {
    throw new ImportError('This file was made by a newer version of mdstickies.');
  }
  if (!Array.isArray(file.stickies)) {
    throw new ImportError('This is not an mdstickies file.');
  }
  const seen = new Set<string>();
  return file.stickies.map((raw: unknown, i: number) => {
    if (!isSticky(raw)) throw new ImportError(`Invalid sticky at position ${i + 1}.`);
    if (seen.has(raw.id)) throw new ImportError(`Duplicate sticky id "${raw.id}".`);
    seen.add(raw.id);
    return {
      ...raw,
      x: Math.max(0, raw.x),
      y: Math.max(0, raw.y),
      width: Math.max(MIN_SIZE.width, raw.width),
      height: Math.max(MIN_SIZE.height, raw.height),
    };
  });
}

export function prepareAdd(current: Sticky[], imported: Sticky[], now: Date = new Date()): Sticky[] {
  if (imported.length === 0) return [];
  const maxZ = current.reduce((m, s) => Math.max(m, s.z), 0);
  const minZ = imported.reduce((m, s) => Math.min(m, s.z), Infinity);
  const iso = now.toISOString();
  return imported.map(s => ({
    ...s,
    id: crypto.randomUUID(),
    z: maxZ + 1 + (s.z - minZ),
    updatedAt: iso,
  }));
}
