import { isSticky } from './format';
import type { Sticky } from './model';

export const KEY_PREFIX = 'mdstickies:v1:sticky:';
export const CLEARED_KEY = 'mdstickies:v1:cleared';

export class StorageFailure extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageFailure';
  }
}

export class StickyStore {
  constructor(private readonly storage: Storage | null) {}

  private stickyKeys(): string[] {
    if (!this.storage) return [];
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k !== null && k.startsWith(KEY_PREFIX)) keys.push(k);
    }
    return keys;
  }

  private read(key: string): Sticky | undefined {
    if (!this.storage) return undefined;
    try {
      const raw = this.storage.getItem(key);
      if (raw === null) return undefined;
      const v: unknown = JSON.parse(raw);
      return isSticky(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }

  loadAll(): Sticky[] {
    const out: Sticky[] = [];
    for (const k of this.stickyKeys()) {
      const s = this.read(k);
      if (s) out.push(s);
    }
    return out;
  }

  get(id: string): Sticky | undefined {
    return this.read(KEY_PREFIX + id);
  }

  put(s: Sticky): void {
    if (!this.storage) throw new StorageFailure('Browser storage is unavailable.');
    try {
      this.storage.setItem(KEY_PREFIX + s.id, JSON.stringify(s));
    } catch (cause) {
      throw new StorageFailure('Could not save to browser storage.', { cause });
    }
  }

  remove(id: string): void {
    this.storage?.removeItem(KEY_PREFIX + id);
  }

  clearAll(): void {
    if (!this.storage) return;
    for (const k of this.stickyKeys()) this.storage.removeItem(k);
    try {
      this.storage.setItem(CLEARED_KEY, new Date().toISOString());
    } catch (cause) {
      throw new StorageFailure('Could not save to browser storage.', { cause });
    }
  }
}

export type RemoteChange =
  | { kind: 'upsert'; sticky: Sticky }
  | { kind: 'remove'; id: string }
  | { kind: 'clear' };

export function parseStorageEvent(key: string | null, newValue: string | null): RemoteChange | null {
  if (key === null) return { kind: 'clear' };
  if (key === CLEARED_KEY) return newValue === null ? null : { kind: 'clear' };
  if (!key.startsWith(KEY_PREFIX)) return null;
  if (newValue === null) return { kind: 'remove', id: key.slice(KEY_PREFIX.length) };
  try {
    const v: unknown = JSON.parse(newValue);
    return isSticky(v) ? { kind: 'upsert', sticky: v } : null;
  } catch {
    return null;
  }
}

export type Resolution = 'apply' | 'ignore' | 'resave-local';

export function resolveRemote(
  local: Sticky | undefined,
  change: RemoteChange,
  editingId: string | null,
): Resolution {
  switch (change.kind) {
    case 'clear':
      return 'apply';
    case 'upsert': {
      if (change.sticky.id === editingId) return 'ignore';
      if (!local) return 'apply';
      return Date.parse(change.sticky.updatedAt) > Date.parse(local.updatedAt) ? 'apply' : 'ignore';
    }
    case 'remove':
      return change.id === editingId ? 'resave-local' : 'apply';
  }
}
