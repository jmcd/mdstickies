import { createSticky, type Sticky, type StickyColor } from './model';
import { CLEARED_KEY, type StickyStore } from './store';

/** Set once the demo has been offered, so deleting the demo notes doesn't bring them back. */
export const WELCOMED_KEY = 'mdstickies:v1:welcomed';

const DEMO: Array<{ text: string; x: number; y: number; width: number; height: number; color: StickyColor }> = [
  {
    color: 'yellow', x: 40, y: 40, width: 300, height: 340,
    text: `# Welcome to mdstickies

Notes are written in **Markdown**. Click a note to edit it; click away to see it rendered.

- **bold**, *italic*, ~~strikethrough~~
- \`inline code\`
- [links](https://mdstickies.com) open in a new tab

> Drag a note to move it, drag its corner to resize.`,
  },
  {
    color: 'green', x: 370, y: 40, width: 260, height: 240,
    text: `## Today

- [x] Open mdstickies
- [ ] Tick a box (click it)
- [ ] Make a note with **New**

1. Numbered
2. lists
3. work too`,
  },
  {
    color: 'blue', x: 660, y: 40, width: 300, height: 240,
    text: `### Code

Fenced blocks are highlighted:

\`\`\`ts
const greet = (name: string) =>
  \`Hello, \${name}!\`;
\`\`\``,
  },
];

/** Puts the demo notes on a brand-new board: storage present, no notes, and never welcomed or cleared before. */
export function seedDemo(storage: Storage | null, store: StickyStore, now: Date = new Date()): Sticky[] {
  if (!storage || storage.getItem(WELCOMED_KEY) !== null || storage.getItem(CLEARED_KEY) !== null) return [];
  if (store.loadAll().length > 0) return [];
  const out: Sticky[] = [];
  try {
    storage.setItem(WELCOMED_KEY, now.toISOString());
    DEMO.forEach(({ text, color, ...rect }, i) => {
      const s = { ...createSticky({ x: rect.x, y: rect.y, z: i + 1 }, now), ...rect, text, color };
      store.put(s);
      out.push(s);
    });
  } catch {
    // Storage full or blocked: the board just starts empty.
  }
  return out;
}
