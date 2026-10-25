export class FakeStorage implements Storage {
  failWrites = false;
  private map = new Map<string, string>();

  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new DOMException('quota', 'QuotaExceededError');
    this.map.set(k, String(v));
  }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
}
