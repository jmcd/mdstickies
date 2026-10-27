// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { clipboardData, notesFromClipboard } from '../src/clipboard';
import type { Sticky } from '../src/model';

function sticky(over: Partial<Sticky> = {}): Sticky {
  return {
    id: 's1', text: 'hello', x: 10, y: 20, width: 220, height: 180, color: 'yellow', z: 1,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...over,
  };
}

// Listed out of reading order on purpose: lower note first.
const notes = [
  sticky({ id: 'low', text: '- [x] eggs\n- [ ] milk', y: 400, color: 'pink' }),
  sticky({ id: 'top', text: '# Plan\n\nSome **bold** words', y: 10, width: 300 }),
];

describe('clipboardData', () => {
  it('markdown: the raw text only, top to bottom, separated by a blank line', () => {
    expect(clipboardData(notes, 'markdown')).toEqual({
      'text/plain': '# Plan\n\nSome **bold** words\n\n- [x] eggs\n- [ ] milk',
    });
  });

  it('text: the words as shown, with formatting kept in the rich version', () => {
    const data = clipboardData(notes, 'text');
    expect(data['text/plain']).toBe('Plan\n\nSome bold words\n\n☑ eggs\n☐ milk');
    expect(data['text/html']).toContain('<strong>bold</strong>');
    expect(data['text/html']).not.toContain('<input');
    expect(data['text/html']).not.toContain('data-mdstickies');
  });

  it('notes: Markdown as the plain fallback, the whole notes hidden in the rich version', () => {
    const data = clipboardData(notes, 'notes');
    expect(data['text/plain']).toBe(clipboardData(notes, 'markdown')['text/plain']);
    expect(data['text/html']).toContain('<strong>bold</strong>');
    expect(notesFromClipboard(data['text/html'])).toEqual([notes[1], notes[0]]);
  });
});

describe('notesFromClipboard', () => {
  it('reads notes back after a browser wraps the HTML in its own page markup', () => {
    const html = clipboardData(notes, 'notes')['text/html'];
    const wrapped = `<html><body>\n<!--StartFragment-->${html}<!--EndFragment-->\n</body></html>`;
    expect(notesFromClipboard(wrapped)?.map((s) => s.id)).toEqual(['top', 'low']);
  });

  it('keeps awkward text intact', () => {
    const odd = sticky({ text: `quotes " ' and "><script>alert(1)</script> & <b>` });
    expect(notesFromClipboard(clipboardData([odd], 'notes')['text/html'])).toEqual([odd]);
  });

  it('is null for ordinary HTML, broken data, or nothing', () => {
    expect(notesFromClipboard('<p>just <b>text</b></p>')).toBeNull();
    expect(notesFromClipboard('<div data-mdstickies="{not json">x</div>')).toBeNull();
    expect(notesFromClipboard('<div data-mdstickies=\'{"app":"other"}\'>x</div>')).toBeNull();
    expect(notesFromClipboard('')).toBeNull();
  });
});
