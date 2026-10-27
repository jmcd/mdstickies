# mdstickies

A static sticky-notes app: write notes in Markdown, arrange them on a board. Built with Vite and TypeScript.

Use it at <https://mdstickies.com>.

## How it's built

mdstickies is a single static page with no backend and no UI framework, just TypeScript and the DOM.

- **Vite** bundles the app, and **Vitest** with jsdom runs the tests.
- **marked** turns each note's Markdown (GitHub-flavoured, with task lists) into HTML, **highlight.js** colours fenced code, and **DOMPurify** sanitises the result before it goes on the page.
- Notes are saved as JSON in **local storage**, one key per note. Other open tabs pick up changes through the browser's `storage` event, so the board stays in sync across tabs.
- A **GitHub Actions** workflow tests and builds every push to `main` and deploys the `dist` folder to **GitHub Pages**.

## Development

```sh
npm i
npm run dev
npm test
npm run build
```

## Notes

Click a note to select it; double-click (or select it and press Enter) to edit it. Press N or New for a new note, or paste text onto the board. Drag a note to move it and its corner to resize it.

## Selecting several notes

Drag a box on empty board, Shift-click or Ctrl/Cmd-click notes, or press Ctrl/Cmd+A. The toolbar then shows actions for the selection: arrange, align, colour, copy, export and delete. Arrow keys nudge the selection, Ctrl/Cmd+D duplicates it, and Delete or Backspace deletes it. Esc clears the selection.

## Copying notes

With notes selected, Ctrl/Cmd+C (or Copy) copies them whole: paste them into mdstickies in any tab or browser and they keep their colour, size and layout. Copy text copies them as they read, for email or documents; Copy Markdown copies exactly what you typed.

## Search, dark mode and shortcuts

Ctrl/Cmd+F jumps to the search box, which fades notes that don't match. The theme button cycles Auto (follows your system), Light and Dark. Press ? for every keyboard shortcut.

## Undoing a delete

Deleting notes or clearing the board shows an Undo button for 10 seconds. Ctrl+Z (Cmd+Z on Mac) does the same while it's showing.

## Your data

Notes are stored only in your own browser (local storage). Nothing is sent to a server, and they are not shared across browsers or devices. Use export to back them up.
