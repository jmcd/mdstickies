import './styles.css';
import 'highlight.js/styles/github.css';
import { StickyStore } from './store';
import { Board } from './ui/board';
import { showDialog } from './ui/dialog';
import { downloadFile, pickFile } from './ui/files';

let storage: Storage | null = null;
try {
  storage = window.localStorage;
  storage.getItem('x');
} catch {
  storage = null;
}

new Board(document.getElementById('app')!, new StickyStore(storage), {
  dialog: showDialog,
  download: downloadFile,
  pickFile,
}).start();
