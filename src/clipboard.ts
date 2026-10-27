import { parseBoardFile, serializeBoard } from './format';
import { renderMarkdown } from './markdown';
import type { Sticky } from './model';

/** notes: everything, for pasting into mdstickies (any tab or browser). text: the notes as they read. markdown: the raw text. */
export type CopyKind = 'notes' | 'text' | 'markdown';

// The notes ride along in the rich (HTML) copy, which the system clipboard carries between browsers.
const ATTR = 'data-mdstickies';

const readingOrder = (notes: Sticky[]) => [...notes].sort((a, b) => a.y - b.y || a.x - b.x);

// Rendered note with checkboxes as ☑/☐: rich editors and plain text both drop <input>s.
function rendered(s: Sticky): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(s.text);
  for (const box of div.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) box.replaceWith(box.checked ? '☑' : '☐');
  return div;
}

// A blank line between blocks (headings, paragraphs, lists), as you'd type it.
const plainText = (el: HTMLElement) =>
  [...el.children].map((block) => block.textContent!.trim()).filter(Boolean).join('\n\n');

/** Clipboard contents by MIME type. Notes go top to bottom, then left to right. */
export function clipboardData(notes: Sticky[], kind: CopyKind): Record<string, string> {
  const sorted = readingOrder(notes);
  const markdown = sorted.map((s) => s.text.trim()).join('\n\n');
  if (kind === 'markdown') return { 'text/plain': markdown };
  const parts = sorted.map(rendered);
  const html = parts.map((p) => p.innerHTML).join('<hr>');
  if (kind === 'text') return { 'text/plain': parts.map(plainText).join('\n\n'), 'text/html': html };
  const wrap = document.createElement('div');
  wrap.setAttribute(ATTR, serializeBoard(sorted));
  wrap.innerHTML = html;
  return { 'text/plain': markdown, 'text/html': wrap.outerHTML };
}

/** The notes hidden in a "notes" copy, validated like an imported file; null if there are none. */
export function notesFromClipboard(html: string): Sticky[] | null {
  if (!html.includes(ATTR)) return null;
  const json = new DOMParser().parseFromString(html, 'text/html').querySelector(`[${ATTR}]`)?.getAttribute(ATTR);
  if (!json) return null;
  try {
    const notes = parseBoardFile(json);
    return notes.length ? notes : null;
  } catch {
    return null;
  }
}

export async function writeClipboard(data: Record<string, string>): Promise<void> {
  const blobs = Object.fromEntries(Object.entries(data).map(([type, v]) => [type, new Blob([v], { type })]));
  await navigator.clipboard.write([new ClipboardItem(blobs)]);
}

/** What a paste carries: the rich copy (where copied notes hide) and the plain text. */
export interface ClipboardContents {
  html: string;
  text: string;
}

// Reading needs the browser's permission (it may ask); Ctrl/Cmd+V doesn't, so it uses the paste event instead.
export async function readClipboard(): Promise<ClipboardContents> {
  const read = async (item: ClipboardItem, type: string) => (item.types.includes(type) ? (await item.getType(type)).text() : '');
  if (!navigator.clipboard.read) return { html: '', text: await navigator.clipboard.readText() };
  const [item] = await navigator.clipboard.read();
  return item ? { html: await read(item, 'text/html'), text: await read(item, 'text/plain') } : { html: '', text: '' };
}
