# Pixel Agents Webview UI

This package contains the React + TypeScript canvas UI used by both runtimes:

- VS Code extension webview
- Tauri desktop app webview

## Scripts

```bash
npm install
npm run dev
npm run build
npm run lint
```

Desktop-only:

```bash
npm run tauri:dev
npm run tauri:build
```

## Runtime Notes

- In extension mode, assets are loaded by the extension host and forwarded via `postMessage`.
- In desktop mode, the webview bootstraps via Tauri commands and also loads character PNG sprites from `/assets/characters/char_*.png` when needed.
- Character sprites are expected as 6 PNG sheets (`char_0.png` to `char_5.png`), each `112x96` with `7` frames across and `3` direction rows.

## Asset Locations

- Source assets: `webview-ui/public/assets/`
- Character sprites: `webview-ui/public/assets/characters/`
- Furniture sprites + catalog: `webview-ui/public/assets/furniture/`
- Build output copy: `dist/assets/` and `dist/webview/assets/`

## Editing Guidelines

- Keep magic numbers in `webview-ui/src/constants.ts`.
- Keep CSS color tokens in `webview-ui/src/index.css` (`:root` `--pixel-*` vars).
- Use `as const` objects instead of TypeScript `enum`.
