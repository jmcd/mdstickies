import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

let taskCounter = 0;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const marked = new Marked({ gfm: true });
marked.use({
  renderer: {
    checkbox({ checked }) {
      return `<input type="checkbox" data-task-index="${taskCounter++}"${checked ? ' checked' : ''}> `;
    },
    code({ text, lang }) {
      const language = (lang ?? '').trim().split(/\s+/)[0];
      const result = language && hljs.getLanguage(language)
        ? hljs.highlight(text, { language, ignoreIllegals: true })
        : hljs.highlightAuto(text);
      const cls = result.language ? ` language-${escapeHtml(result.language)}` : '';
      return `<pre><code class="hljs${cls}">${result.value}</code></pre>\n`;
    },
  },
});

// Remove any <input> that did not come from our checkbox renderer.
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'input' && !(node as Element).hasAttribute('data-task-index')) {
    node.parentNode?.removeChild(node);
  }
});
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** GFM -> sanitised HTML. Each task checkbox is <input type="checkbox" data-task-index="N"> (0-based,
 *  document order), `checked` when done, NOT disabled. Every other <input> is removed. Links get
 *  target="_blank" rel="noopener noreferrer". Fenced code is highlighted with highlight.js. */
export function renderMarkdown(text: string): string {
  taskCounter = 0;
  const raw = marked.parse(text, { async: false });
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['data-task-index', 'checked', 'type', 'target'],
  });
}

const TASK_RE = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=[ \t]+\S)/;
const ITEM_RE = /^((?:\s*>)*)(\s*)(?:[-*+]|\d+[.)])\s/;
const FENCE_RE = /^(?:\s*>)*\s{0,3}(`{3,}|~{3,})/;

/** Flip the index-th task marker ([ ] <-> [x]); returns text unchanged if index is out of range. */
export function toggleTask(text: string, index: number): string {
  const lines = text.split('\n');
  let fence: string | null = null;
  let count = 0;
  let inList = false; // an indented line is only a nested item (not an indented code block) inside a list
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence) fence = null;
      continue;
    }
    if (f) { fence = f[1][0]; continue; }
    const item = ITEM_RE.exec(line);
    const indent = (item ? item[2] : /^(?:\s*>)*(\s*)/.exec(line)![1]).length;
    if (indent >= 4 && !inList) continue;
    if (item) inList = true;
    else if (line.trim() !== '' && indent === 0) inList = false;
    const m = TASK_RE.exec(line);
    if (!m) continue;
    if (count++ === index) {
      const pos = m[1].length + 1;
      lines[i] = line.slice(0, pos) + (m[2] === ' ' ? 'x' : ' ') + line.slice(pos + 1);
      return lines.join('\n');
    }
  }
  return text;
}
