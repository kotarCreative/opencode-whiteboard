# Third-party notices

This project is MIT licensed. It depends on and reuses these MIT-licensed
projects at runtime or build time.

## mcp-excalidraw-server 2.2.0

- Project: https://github.com/yctimlin/mcp_excalidraw
- Package: https://www.npmjs.com/package/mcp-excalidraw-server
- License: MIT
- Copyright: 2024 MCP Excalidraw Server
- Use here: pinned runtime dependency. The canvas server, MCP stdio server,
  Excalidraw frontend, headless renderer, CLI, and bundled fonts come from this
  package. Its `LICENSE` is in `node_modules/mcp-excalidraw-server/LICENSE` after
  install.

## Excalidraw

- Project: https://github.com/excalidraw/excalidraw
- License: MIT
- Use here: the editor UI and scene model shipped inside the upstream package.
  The canvas page loads Excalidraw fonts from the `esm.sh` CDN at runtime.

## OpenCode plugin and GUI SDK

- Project: https://opencode.ai
- Package: `@opencode/plugin` 2.3.2 (runtime for the server part; types and
  externalized runtime for the GUI part)
- License: MIT
- Use here: the experimental Desktop GUI plugin API (`Panel`, `Command`,
  `MenuItem`, `Ipc`, `WebContentsView` embeds, `Browser` pane) and the server
  plugin definition. The app provides the GUI module at runtime; it is not
  bundled.

## Effect and Solid

- Effect: https://effect.website (`effect` 4.1.0, MIT) — schema and runtime
  primitives used by the GUI contract and the plugin SDK.
- Solid: https://www.solidjs.com (`solid-js` 1.9.20, MIT) — the window-side
  runtime the GUI bundle expects the app to provide.

## Build-time packages

`vite`, `vite-plugin-solid`, `typescript`, `@types/node`, and `electron` (types
only) are dev/build dependencies under their respective MIT licenses. Their full
license texts are in their installed packages.

No third-party code was copied into this repository.
