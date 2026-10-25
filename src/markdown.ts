import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

let taskCounter = 0;
// Per-render secret marking inputs emitted by our renderer; user-supplied HTML cannot guess it.
let nonce = '';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const marked = new Marked({ gfm: true });
marked.use({
  renderer: {
    checkbox({ checked }) {
      return `<input type="checkbox" data-task-index="${taskCounter++}" data-task-nonce="${nonce}"${checked ? ' checked' : ''}> `;
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
  if (data.tagName === 'input' && (node as Element).getAttribute('data-task-nonce') !== nonce) {
    node.parentNode?.removeChild(node);
  }
});
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'INPUT') node.removeAttribute('data-task-nonce');
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
  nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const raw = marked.parse(text, { async: false });
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['input'],
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option'],
    FORBID_ATTR: ['style'],
    ADD_ATTR: ['data-task-index', 'data-task-nonce', 'checked', 'type', 'target'],
  });
}

const TASK_RE = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=[ \t]+\S)/;
// Loose candidate: any list-marker line followed by [ ]/[x]. Whether it is a real task is decided by marked.
const CANDIDATE_RE = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

function taskStates(text: string): boolean[] {
  const out: boolean[] = [];
  marked.walkTokens(marked.lexer(text), (t) => {
    if (t.type === 'list_item' && (t as Tokens.ListItem).task) out.push(!!(t as Tokens.ListItem).checked);
  });
  return out;
}

/** Flip the index-th task marker ([ ] <-> [x]); returns text unchanged if index is out of range.
 *  Task detection is delegated to marked's lexer so it cannot drift from rendering. */
export function toggleTask(text: string, index: number): string {
  if (index < 0) return text;
  const base = taskStates(text);
  if (index >= base.length) return text;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = CANDIDATE_RE.exec(lines[i]);
    if (!m) continue;
    const pos = m[1].length + 1;
    const flipped = lines[i].slice(0, pos) + (m[2] === ' ' ? 'x' : ' ') + lines[i].slice(pos + 1);
    const trial = [...lines.slice(0, i), flipped, ...lines.slice(i + 1)].join('\n');
    const after = taskStates(trial);
    if (after.length !== base.length) continue;
    const diffs = after.flatMap((v, k) => (v !== base[k] ? [k] : []));
    if (diffs.length === 1 && diffs[0] === index) return trial;
  }
  return text;
}
