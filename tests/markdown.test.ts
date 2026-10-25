// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { renderMarkdown, toggleTask } from '../src/markdown';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

function countTasks(src: string): number {
  let n = 0;
  while (toggleTask(src, n) !== src) n++;
  return n;
}

const CORPUS = [
  '- [ ] a\n- [x] b\n  - [X] c',
  '- [ ] a\n- [ ] b',
  '- [X] a',
  '```\n- [ ] not\n```\n~~~\n- [ ] not\n~~~\n- [ ] yes',
  '1. [ ] a\n   * [ ] b\n> + [ ] c',
  '- [ ] a',
  '- []',
  '-[ ]',
  '- [ ]',
  '- [ ] ',
  '- [x]',
  '- [ ]a',
  '- a\n  - b\n    ```\n    - [ ] x\n    ```\n- [ ] y',
  '````\n```js\n- [ ] x\n````\n- [ ] y',
  '- a\n\n      - [ ] code in item\n\n- [ ] y',
  '<input data-task-index="0" type="checkbox">\n\n- [ ] real',
  '- [ ] a\n  - [ ] b\n    - [ ] c\n      - [ ] d',
  '1) [ ] paren',
  '    - [ ] indented code?',
  'text [ ] inline\n\n- not [ ] task',
  '> > - [ ] deep quote',
  '- [ ] a\n\n  ```\n  - [ ] in fence\n  ```\n\n- [x] b',
  '<input type="checkbox">\n\n- [ ] real',
  '* [ ] a\n+ [x] b',
];

test('renders GFM basics', () => {
  const html = renderMarkdown('# Hi\n\n**b** _i_\n\n| a |\n|---|\n| 1 |');
  expect(html).toContain('<h1'); expect(html).toContain('<strong>b</strong>'); expect(html).toContain('<table');
});
test('task checkboxes are numbered, enabled, and reflect state', () => {
  const doc = parse(renderMarkdown('- [ ] a\n- [x] b\n  - [X] c'));
  const boxes = [...doc.querySelectorAll('input[type=checkbox]')];
  expect(boxes.map(b => b.getAttribute('data-task-index'))).toEqual(['0', '1', '2']);
  expect(boxes.map(b => (b as HTMLInputElement).hasAttribute('checked'))).toEqual([false, true, true]);
  expect(boxes.some(b => b.hasAttribute('disabled'))).toBe(false);
});
test('numbering resets on each render', () => {
  renderMarkdown('- [ ] a\n- [ ] b');
  const doc = parse(renderMarkdown('- [ ] a'));
  expect(doc.querySelector('input')!.getAttribute('data-task-index')).toBe('0');
});
test('code is highlighted', () => {
  expect(renderMarkdown('```js\nconst a = 1\n```')).toContain('hljs');
});
test('sanitises script, handlers and javascript: links', () => {
  const html = renderMarkdown('<script>x()</script><img src=x onerror="x()">\n\n[l](javascript:x())');
  expect(html).not.toMatch(/<script|onerror|javascript:/i);
});
test('raw <input> tags are stripped and do not shift numbering', () => {
  const doc = parse(renderMarkdown('<input type="checkbox">\n\n- [ ] real'));
  const boxes = doc.querySelectorAll('input');
  expect(boxes.length).toBe(1); expect(boxes[0].getAttribute('data-task-index')).toBe('0');
});
test('links open in a new tab', () => {
  expect(renderMarkdown('[a](https://x.y)')).toMatch(/target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"/);
});

test('toggleTask flips the Nth task', () => {
  expect(toggleTask('- [ ] a\n- [ ] b', 1)).toBe('- [ ] a\n- [x] b');
  expect(toggleTask('- [X] a', 0)).toBe('- [ ] a');
});
test('toggleTask skips markers inside ``` and ~~~ fences', () => {
  const src = '```\n- [ ] not\n```\n~~~\n- [ ] not\n~~~\n- [ ] yes';
  expect(toggleTask(src, 0)).toBe(src.replace('- [ ] yes', '- [x] yes'));
});
test('toggleTask handles nested, ordered, * and + bullets, and blockquotes', () => {
  const src = '1. [ ] a\n   * [ ] b\n> + [ ] c';
  expect(toggleTask(src, 2)).toBe('1. [ ] a\n   * [ ] b\n> + [x] c');
});
test('toggleTask out of range returns input unchanged', () => {
  expect(toggleTask('- [ ] a', 5)).toBe('- [ ] a');
});
test('forged raw <input data-task-index> does not collide with real numbering', () => {
  const doc = parse(renderMarkdown('<input data-task-index="0" type="checkbox">\n\n- [ ] a\n- [ ] b'));
  const boxes = [...doc.querySelectorAll('input')];
  expect(boxes.map(b => b.getAttribute('data-task-index'))).toEqual(['0', '1']);
  expect(doc.querySelector('[data-task-nonce]')).toBeNull();
});
test('toggle index matches rendered checkbox count and flips exactly that checkbox (parity corpus)', () => {
  const states = (src: string) =>
    [...parse(renderMarkdown(src)).querySelectorAll('input')].map(b => b.hasAttribute('checked'));
  for (const src of CORPUS) {
    const base = states(src);
    expect(countTasks(src), src).toBe(base.length);
    for (let i = 0; i < base.length; i++) {
      const after = states(toggleTask(src, i));
      expect(after, `${src} #${i}`).toEqual(base.map((v, k) => (k === i ? !v : v)));
    }
  }
});

test('forbidden elements and style attributes are stripped', () => {
  for (const tag of ['style', 'form', 'button', 'textarea', 'select', 'option']) {
    const html = renderMarkdown(`<${tag}>x</${tag}>\n\ntext`);
    expect(parse(html).querySelector(tag), tag).toBeNull();
  }
  expect(renderMarkdown('<style>*{display:none}</style>')).not.toContain('display');
  const doc = parse(renderMarkdown('<p style="position:fixed">a</p>\n\n<div style="x:y">b</div>'));
  expect(doc.querySelector('[style]')).toBeNull();
});

test('task checkboxes stay numbered and hljs output keeps classes', () => {
  const doc = parse(renderMarkdown('- [ ] a\n- [x] b\n\n```js\nconst a = 1;\n```'));
  const boxes = [...doc.querySelectorAll('input[type=checkbox]')];
  expect(boxes.map((b) => b.getAttribute('data-task-index'))).toEqual(['0', '1']);
  expect(doc.querySelector('code.hljs.language-js .hljs-keyword')).not.toBeNull();
  expect(doc.querySelector('[style]')).toBeNull();
});

test('soft line breaks render as <br>', () => {
  expect(renderMarkdown('milk\neggs')).toContain('milk<br>eggs');
});
