# mdstickies

A static sticky-notes app: write notes in Markdown, arrange them on a board. Built with Vite and TypeScript.

## Development

```sh
npm i
npm run dev
npm test
npm run build
```

## Selecting several notes

Drag a box on empty board, Shift-click or Ctrl/Cmd-click notes, or press Ctrl/Cmd+A. The toolbar then shows actions for the selection: arrange, align, colour, export and delete. Delete or Backspace deletes the selected notes after one confirmation. Esc clears the selection.

## Deploying to GitHub Pages

Pushes to `main` run `.github/workflows/deploy.yml`, which tests, builds and deploys `dist`.

In the repository, set **Settings → Pages → Source: GitHub Actions**.

## Your data

Notes are stored only in your own browser (local storage). Nothing is sent to a server, and they are not shared across browsers or devices. Use export to back them up.
