import './styles.css';
import 'highlight.js/styles/github.css';
import hljsDark from 'highlight.js/styles/github-dark.css?inline';
import { seedDemo } from './demo';
import { StickyStore } from './store';
import { Board } from './ui/board';
import { showDialog } from './ui/dialog';
import { downloadFile, pickFile } from './ui/files';
import { ThemeControl } from './ui/theme';

let storage: Storage | null = null;
try {
  storage = window.localStorage;
  storage.getItem('x');
} catch {
  storage = null;
}

// Code highlighting swaps to GitHub Dark under the dark theme (nested so it only applies there).
const darkCode = document.createElement('style');
darkCode.textContent = `:root[data-theme='dark'] { ${hljsDark} }`;
document.head.append(darkCode);

const theme = new ThemeControl(storage, window.matchMedia?.('(prefers-color-scheme: dark)') ?? null);
theme.start();

const store = new StickyStore(storage);
seedDemo(storage, store);

new Board(document.getElementById('app')!, store, {
  dialog: showDialog,
  download: downloadFile,
  pickFile,
  themeToggle: theme.el,
}).start();
