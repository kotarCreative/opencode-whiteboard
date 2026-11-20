# OpenCode Whiteboard

A local-first whiteboard for OpenCode: a pinned Excalidraw canvas, a real MCP
bridge, and an experimental OpenCode Desktop panel. Nothing is sent to a hosted
service, and no global OpenCode configuration is changed.

> **Status: v0.1 prototype.** One board per project, bound explicitly to
> `http://127.0.0.1:4317`. Opening the board (panel or command) cold-starts the
> local backend on demand, with no manual `npm run board` at runtime. The
> Desktop panel is implemented against the documented experimental GUI plugin
> API; its built bundle is tested here with mocked Electron/host modules, but
> the **real Desktop runtime is not available in this environment**. The
> browser/MCP path is tested end to end.

## Why this shape

Research found no dedicated "OpenCode whiteboard panel + MCP" project. The
closest pieces were:

| Project | What it gives | Gap |
| --- | --- | --- |
| [`yctimlin/mcp_excalidraw`](https://github.com/yctimlin/mcp_excalidraw) `mcp-excalidraw-server` 2.2.0 | MIT canvas + 27-tool MCP server + CLI; optional durable local state | No OpenCode Desktop panel |
| [`soetang/opencode-excalidraw`](https://github.com/soetang/opencode-excalidraw) | Desktop dock/panel for Excalidraw | No MCP bridge |

This prototype reuses the pinned upstream canvas/MCP package instead of
reimplementing Excalidraw, and adds the missing OpenCode wiring:

- a **project-local** `opencode.jsonc` MCP server entry;
- a **shared, single-flight backend lifecycle** used by both the CLI and the
  Desktop main process, with an explicit single-board scope;
- an **experimental Desktop GUI plugin**: a side `Panel` that embeds the canvas
  in a `WebContentsView`, cold-starts the backend if needed, and contributes a
  single open/close toggle command (also the composer slash command
  **`/whiteboard`**) plus the documented **built-in browser pane**;
- a project skill that defines **pull-only natural-language** behavior.

## Requirements

- Node.js **20+**
- OpenCode **2.x**
- Optional: OpenCode Desktop with the experimental GUI plugin API
  (the related community plugin requires Desktop **2.2.7+**). The GUI bundle is
  built against `@opencode/plugin` **2.3.2**.
- A local Chromium is only needed for the optional UI smoke test.

## Quick start

```sh
git clone https://github.com/kotarCreative/opencode-whiteboard.git
cd opencode-whiteboard
npm ci --ignore-scripts
npm run build:gui
```

That is enough to open OpenCode in this directory:

```sh
opencode
```

For a prebuilt private prerelease download that needs no GUI build, see
[INSTALL.md](INSTALL.md).

Run the full verification suite with `npm test` (see
[Verification](#verification)).

The project `opencode.jsonc` adds the `whiteboard` MCP server. Opening the
board from the Desktop panel/command cold-starts the canvas; the first MCP tool
call also starts it if it is not already running. Nothing needs `npm run board`
at runtime.

`npm run board` is still available for a browser-first workflow or manual
operation. It starts the same canvas on `http://127.0.0.1:4317`, with durable
state in `.whiteboard/data`, exports in `boards/`, and a log in
`.whiteboard/board.log`:

```sh
npm run board
```

Open that URL in a browser to watch or edit the board. Check `/mcps` in the TUI
(or `opencode mcp list` against a server that loaded this project) and use the
27 `whiteboard_*` tools. The MCP server runs locally over stdio; it is not an
HTTP endpoint.

### Desktop panel (experimental)

With OpenCode Desktop, the plugin contributes:

- **Whiteboard: Toggle board panel** — opens the side-panel tab when it is
  closed and closes it when it is open, using the documented
  `ctx.layout.toggle` panel API. The same command is **`/whiteboard`** in the
  composer's slash menu. It runs only that layout action: it does not insert a
  chat prompt and does not call a model. Closing keeps the backend running so
  the board and MCP stay available. Reopen with `/whiteboard`, the palette, the
  **+** menu, or Desktop's recently-closed-tab restore. Opening the panel asks
  the Electron main process to ensure the backend, creating it on demand if
  needed. The main process uses one shared single-flight startup, rejects a port
  owned by a different service, creates one isolated `WebContentsView` per
  window, denies popups and off-origin navigation, and returns the embed id. If
  startup fails, the panel shows a retry card instead of a blank view.
- **Whiteboard: Open board** — ensures the backend, then opens the board in the
  documented built-in browser pane (`@opencode/plugin/gui/browser`
  `Browser.open`). If the pane is unavailable, it falls back to the system
  browser.
- A **Whiteboard** launcher in the session side-panel **+** menu.

The redundant open-panel and close-panel palette commands were removed; the
toggle covers both. The panel's error card keeps its browser-pane and system
browser fallbacks.

The GUI API is experimental and may change. This environment has the OpenCode
CLI but not Desktop, so the real Electron window path is not run here. The
built bundle is exercised with mocked Electron/host modules: main-process cold
start, embed creation, idempotent ensure, and the `/whiteboard` toggle command
all run against the real bundle and a real canvas process. OpenCode 2.0.32
(`opencode plugin list`) recognizes this project package as
`opencode-whiteboard@0.1.0` from `.`, and the MCP bridge connects with 27 tools.

OpenCode's V2 docs say Desktop loads GUI parts of plugins listed in the
**global** `opencode.json(c)`. This repo deliberately does not edit global
configuration. If the panel does not appear in a particular Desktop setup, use
the browser pane command when available, add the plugin to global config
yourself, or open `http://127.0.0.1:4317` directly. The canvas itself is still
the same working board.

## Project configuration

`opencode.jsonc` is self-contained and project-local:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": ".", "options": { "boardUrl": "http://127.0.0.1:4317" } }
  ],
  "mcp": {
    "servers": {
      "whiteboard": {
        "type": "local",
        "command": ["node", "./node_modules/mcp-excalidraw-server/dist/index.js"],
        "cwd": ".",
        "environment": {
          "EXPRESS_SERVER_URL": "http://127.0.0.1:4317",
          "EXCALIDRAW_DATA_DIR": ".whiteboard/data",
          "EXCALIDRAW_EXPORT_DIR": "boards",
          "ENABLE_CANVAS_SYNC": "true",
          "LOG_LEVEL": "warn"
        }
      }
    }
  },
  "permissions": [
    { "action": "whiteboard_export_to_excalidraw_url", "resource": "*", "effect": "deny" }
  ]
}
```

The deny rule removes upstream's only tool that uploads the scene to
`excalidraw.com`. There is no share/upload tool in this setup.

## Natural-language usage

Sample prompts:

```text
Pull the whiteboard into context and summarize the current diagram.
```

```text
Read the diagram guide, then add a box labeled "Ingest" at 120,120
and connect it to the existing "Store" box with an arrow labeled "events".
```

```text
Export the current board to boards/architecture.excalidraw.
```

```text
Check which board is bound to this project (run node bin/whiteboard.mjs info).
```

```text
Pull the board again and tell me what changed since the last pull.
```

The project skill at `.opencode/skills/whiteboard/SKILL.md` teaches the agent to:

- use `describe_scene` and `get_canvas_screenshot` for **pull**;
- never use `whiteboard_export_to_excalidraw_url` or any upload/share path;
- treat the board as the single project-local default board;
- re-pull before assuming the canvas is fresh.

"Pull, no send" is therefore both a permission rule and an instruction. Board
contents stay in the local canvas process, the local durable directory, and the
model context the user explicitly asked for.

## Board identity and scope

There is exactly **one board per project** in v0.1:

| Setting | Value |
| --- | --- |
| Board id | `default` |
| URL | `http://127.0.0.1:4317` (loopback only) |
| Durable state | `.whiteboard/data/` (gitignored) |
| Exports | `boards/` |
| Manifest | `.whiteboard/board.json` (gitignored) |

The wrapper refuses non-loopback URLs and refuses to reuse a port that answers
with a different service identity. There is no port auto-discovery, so an agent
cannot silently attach to an unrelated board. Startup is single-flight: one
promise in the process plus an exclusive `.whiteboard/board.lock` across
processes, with the health check repeated after the lock is taken. A crashed
lock owner is detected by pid and cleaned up; a live owner is waited for, never
killed. To use another project, copy the repo and change
`whiteboard.config.json` plus the matching `opencode.jsonc` values (different
port and data dir). Multi-board selection is intentionally out of scope for
v0.1.

Commands:

```sh
npm run board          # start/ensure (idempotent, single-flight)
npm run board:status   # health + element count + durable flag
npm run board:info     # manifest, scope, paths, upstream version
npm run board:stop     # identity-checked shutdown
```

`node bin/whiteboard.mjs ensure` is an alias for `start`. The same
`bin/lib/backend.mjs` module is used by the CLI and by the Desktop main process
for cold starts, so validation, retries, and the durable store cannot drift
between them. The MCP entry points at the same `EXPRESS_SERVER_URL` and
`EXCALIDRAW_DATA_DIR`; the verification suite asserts that.

### Portability of the install

The checked-in setup is a project-local install: `package: "."` resolves the
project root, `whiteboard.config.json` lives there, and durable state goes to
`.whiteboard/data`. For an installed copy of the package, keep the board state
in the workspace rather than in `node_modules` by passing a `configPath` or
`projectRoot` plugin option, or `WHITEBOARD_CONFIG` pointing at the workspace
config. Relative `dataDir`/`exportDir` values resolve from the config file's
directory. `npm ci --ignore-scripts` is unchanged; no global install or
configuration is required or performed.

## Persistence and freshness

Upstream 2.2.0 supports opt-in durable state via `EXCALIDRAW_DATA_DIR`. Every
accepted mutation is checkpointed before acknowledgement. The verification suite
proves an element survives a canvas restart with the same data dir.

Freshness limits:

- MCP reads the **canvas server state**, not a browser tab's unsaved keystrokes.
  A tab normally syncs over WebSocket; if it is mid-edit or disconnected, pull
  again after it reconnects.
- `get_canvas_screenshot` renders headless in the canvas server, so it works with
  no browser tab. Mermaid conversion and `set_viewport` still need a browser tab.
- The canvas page loads Excalidraw fonts from the `esm.sh` CDN. That is an
  outbound font `GET`, not a board upload. Strictly offline use will fall back to
  local fonts; the board data itself never leaves the machine.
- Upstream is the source of truth for scene semantics, tool schemas, and durable
  state. This project is a wrapper; pin updates deliberately.

## Verification

```sh
npm test
```

What it actually runs (28 checks at the time of writing):

1. dependency is pinned to `mcp-excalidraw-server@2.2.0` in `package.json` and
   `package-lock.json`;
2. the published upstream package has no `preinstall`/`postinstall` hook;
3. the config keeps the fixed loopback board and denies the upload tool;
4. the MCP entry and the backend config use the same URL and durable store;
5. the Desktop GUI bundle exists, externalizes host modules, and contains the
   cold-start, simplified panel-command, and `/whiteboard` slash wiring;
6. a real upstream canvas starts on an isolated port with durable state;
7. the canvas UI is served;
8. real MCP stdio `initialize` and `tools/list` (27 tools);
9. MCP creates two boxes and a bound arrow;
10. MCP pulls the scene and finds the labels;
11. MCP renders a headless PNG screenshot;
12. MCP exports a `.excalidraw` file with bound labels;
13. MCP clears the test canvas;
14. headless Chromium renders the real UI (skipped if Chromium is absent);
15. MCP auto-starts a canvas with no manual `board` command;
16. the shared backend cold-starts with no manual `board` command;
17. a second start reuses the running canvas;
18. two concurrent starts produce exactly one spawn and one pid;
19. a foreign service on the port is rejected and left untouched;
20. startup succeeds on retry after the conflict clears;
21. MCP reuses the shared backend and durable store instead of spawning again;
22. stop is identity-checked and leaves the port free;
23. the built Desktop bundle's main process cold-starts and creates an embed
    (mocked Electron);
24. a second ensure reuses that backend;
25. the built bundle registers exactly one composer slash command, `/whiteboard`,
    tied to the panel toggle; repeated toggling calls the documented
    `Layout.toggle` API (mock), opening when closed and closing when open, with
    no prompt or model call; the browser fallback opens;
26. an invalid config is returned to the panel as an error, with no embed;
27. test state stays under `.whiteboard/` test directories; production
    persistence uses `.whiteboard/data`;
28. durable state survives a canvas restart.

The Desktop bundle checks use mocked Electron and host modules because Desktop is
not installed here; they run the real built bundle, the real Ipc code, and a real
canvas process. The default board and its data directory are not touched by the
test.

The `opencode.jsonc` MCP entry was validated through config loading and through
the same MCP command/env; the raw stdio bridge above is the actual transport
OpenCode uses. In addition, OpenCode 2.0.32 (`opencode plugin list`) recognizes
this project package as `opencode-whiteboard@0.1.0` from `.`, and
`opencode mcp list` reports `whiteboard connected`. The real Desktop
`WebContentsView`/window runtime is not run here.

## Security and supply chain

- Runtime dependencies are pinned exactly: `mcp-excalidraw-server@2.2.0`
  (canvas/MCP, MIT) and `@opencode/plugin@2.3.2` (plugin/GUI API types, MIT).
  Both are pinned in the lockfile.
- The published tarball contains prebuilt `dist/`, fonts, and its MIT license; it
  has no install scripts. Dependencies are installed with
  `npm ci --ignore-scripts`; the `electron` dev dependency is present for types
  only, so its binary download is unnecessary.
- The canvas binds `127.0.0.1` only. No account, API key, tunnel, container, or
  hosted service is added.
- Upstream's REST/WS API has no authentication. Do not bind it to a non-loopback
  interface or expose the port.
- `npm audit` reports vulnerabilities inherited from upstream's dependency tree
  (27 at install time, 3 high). They were not force-upgraded because that would
  break the pinned, tested upstream. Review before production use.
- No global OpenCode config, plugin directory, or credential store is modified.
  Nothing is published to a public registry; the private prerelease described in
  [INSTALL.md](INSTALL.md) is a download-only test artifact.

## Files

```text
opencode-whiteboard/
├── opencode.jsonc              project-local MCP + plugin + deny rule
├── whiteboard.config.json      single-board scope (name, URL, paths)
├── bin/whiteboard.mjs          start/ensure/status/stop/info wrapper
├── bin/lib/backend.mjs         shared single-flight backend lifecycle
├── src/
│   ├── index.ts                server part (stable id; GUI loadability)
│   ├── gui.tsx                 GUI plugin entry (setup + main)
│   └── gui/
│       ├── contract.ts         typed window <-> main Ipc
│       ├── definition.ts       declarations + copy
│       ├── main.ts             cold start, WebContentsView, health gate
│       ├── window.tsx          Panel, `/whiteboard` toggle, launcher, fallback
│       └── board.tsx           panel UI + fallback card
├── scripts/verify.mjs          end-to-end canvas/MCP/GUI-bundle checks
├── .opencode/skills/whiteboard/SKILL.md
├── boards/                     local .excalidraw exports
├── .whiteboard/                local durable state (gitignored)
├── LICENSE                     MIT
└── THIRD_PARTY_NOTICES.md
```

## Known limitations

- The real Desktop GUI runtime is unverified here; the API is experimental. The
  bundle's main/setup code is tested with mocked Electron/host modules, not a
  real Desktop window. Composer slash commands are documented by the V2 GUI
  `Command.slash` API and present in the pinned SDK types; the actual Desktop
  composer runtime is not available here, so the tests verify the `/whiteboard`
  registration and its toggle behavior rather than rendering the composer.
- Desktop loads GUI parts from its own global plugin list per the V2 docs. No
  global config or install is changed by this repo.
- One board per project; no board picker or multi-board naming.
- The backend keeps running after the panel/tab closes. Stop it explicitly with
  `npm run board:stop` if you want the port released.
- No custom MCP facade: upstream's 27 tools are used directly, with the upload
  tool denied. "Board info" is a CLI command (`npm run board:info`), not an MCP
  tool.
- Upstream's browser UI still depends on its own CDN font request.
- If the project-local GUI entry is not loaded by a particular Desktop build, use
  the browser pane command when available, add the plugin to global config
  yourself, or open the loopback URL directly. The canvas itself is still the
  same working board.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
