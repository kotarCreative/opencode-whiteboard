# OpenCode Whiteboard

A local-first whiteboard for OpenCode: a pinned Excalidraw canvas, an
auto-registered MCP bridge, and an experimental OpenCode Desktop panel. Nothing
is sent to a hosted service, and no global OpenCode configuration is hand-edited.

> **Status: v0.2.1 one-reference install.** Install with a single
> `opencode plugin add` Git reference. The server plugin registers the
> `whiteboard` MCP server itself, removes upstream's upload-to-excalidraw.com
> tool from the model surface, and contributes the pull-only skill. The built
> Desktop GUI bundle is tracked in Git and included in the package.
>
> This is a **single shared local board** for every project that loads the
> plugin, not one board per project. Its durable state lives outside the package
> cache (see [Board identity and scope](#board-identity-and-scope)). The Desktop
> panel is implemented against the documented experimental GUI plugin API and
> tested with the host's actual CommonJS loader contract; the **real Electron
> window runtime is not available in this environment**. v0.2.1 fixes the
> Desktop-only `__dirname is not defined` startup crash by resolving the
> package root in the ESM server part and handing it to the main process over
> the documented plugin RPC bridge. The browser/MCP path is tested end to end,
> including a clean Git install in an isolated OpenCode server.

## Why this shape

Research found no dedicated "OpenCode whiteboard panel + MCP" project. The
closest pieces were:

| Project | What it gives | Gap |
| --- | --- | --- |
| [`yctimlin/mcp_excalidraw`](https://github.com/yctimlin/mcp_excalidraw) `mcp-excalidraw-server` 2.2.0 | MIT canvas + 27-tool MCP server + CLI; optional durable local state | No OpenCode Desktop panel |
| [`soetang/opencode-excalidraw`](https://github.com/soetang/opencode-excalidraw) | Desktop dock/panel for Excalidraw | No MCP bridge |

This package reuses the pinned upstream canvas/MCP package instead of
reimplementing Excalidraw, and adds the missing OpenCode wiring:

- a **one-reference Git install** with no local MCP declaration, GUI build, or
  global config edit;
- a **shared, single-flight backend lifecycle** used by the CLI, the Desktop
  main process, and the auto-registered MCP server, with an explicit one-board
  scope;
- an **experimental Desktop GUI plugin**: a side `Panel` that embeds the canvas
  in a `WebContentsView`, cold-starts the backend if needed, and contributes a
  single open/close toggle command (also the composer slash command
  **`/whiteboard`**) plus the documented **built-in browser pane**;
- an **embedded pull-only skill** and removal of upstream's upload tool from the
  exposed tool surface.

## Quick start

Requirements:

- **OpenCode 2.x**, with the `opencode` CLI on `PATH`.
- **Node.js 20+** on `PATH` (the MCP and canvas processes run under Node even
  when OpenCode itself is a compiled binary).
- **Git** and network access for OpenCode to fetch the tagged package. The
  repository is public, so no GitHub account, `gh` login, SSH key, or npm login
  is needed.
- Optional: **OpenCode Desktop** for the side panel. The GUI plugin API is
  experimental; the real Desktop runtime is not available in this build
  environment (see [Desktop panel](#desktop-panel-experimental)).
- A local Chromium is only needed for the optional UI smoke test.

Install the pinned release:

```sh
opencode plugin add 'github:kotarCreative/opencode-whiteboard#v0.2.1'
```

Then **restart OpenCode Desktop** (quit and reopen it) so the global plugin
entry and its GUI part are loaded. In the TUI, restart the TUI or run
`opencode service restart` if the plugin does not appear.

Open any project and use it:

- **Desktop:** press `/whiteboard` in the composer, run **Whiteboard: Toggle
  board panel** from the command palette, or choose **Whiteboard** from the
  session side-panel **+** menu. The browser-pane command and a fallback to
  <http://127.0.0.1:4317> are also available.
- **TUI:** there is no Desktop side panel and the `/whiteboard` GUI command does
  not apply. The MCP server and skill still work: `/mcps` (or
  `opencode mcp list`) should show **`whiteboard connected`**, and the model can
  pull or edit the board. Open <http://127.0.0.1:4317> in a browser when you want
  the canvas UI.
- **Both:** the model sees 26 `whiteboard_*` tools (upstream's 27th, the upload
  tool, is removed), and the embedded `whiteboard` skill teaches pull-only
  usage.

No manual clone into your workspace, `npm ci`, `npm run build:gui`, separate
MCP entry, or hand-edited global JSON is required. The package ships its
prebuilt GUI bundle (`dist/gui-experimental.cjs`) and auto-registers the MCP
server.

> **Desktop status:** the panel is implemented against the documented
> experimental GUI plugin API and tested under the host's actual CommonJS
> loader bindings. The real Electron window runtime has not been available in
> this environment. If a
> particular Desktop build does not show it, use **Whiteboard: Open board**
> (browser pane) or open <http://127.0.0.1:4317> directly; the board and MCP
> still work.

See [INSTALL.md](INSTALL.md) for verification steps, update/remove commands, and
the older portable archive path. The v0.1 archive assets remain as published and
are not updated.

## Install details

`opencode plugin add` fetches the tagged Git package into OpenCode's plugin
cache and adds it to the **global** `opencode.json(c)`. The server plugin
registers the `whiteboard` MCP server at startup, so there is no second install
step. `opencode plugin list` shows the installed package; `opencode mcp list`
shows the connection.

The pinned tag is deliberate: `v0.2.1` is reproducible. `opencode plugin check`
reports updates, while `opencode plugin update` only updates unpinned Git
references. Exact tags are pinned, so upgrade a pinned install by removing the
old reference and adding the new one:

```sh
opencode plugin remove 'github:kotarCreative/opencode-whiteboard#v0.2.0'
opencode plugin add 'github:kotarCreative/opencode-whiteboard#v0.2.1'
```

`plugin add` matches the configured reference exactly, so remove the old tag
first; otherwise both pinned entries stay in the global `plugins` array. Board
state is outside the package cache and is preserved.

### Development checkout

To work on this repository itself:

```sh
git clone https://github.com/kotarCreative/opencode-whiteboard.git
cd opencode-whiteboard
npm ci --ignore-scripts
npm run build:gui
opencode
```

The checkout's `opencode.jsonc` loads the same package from `.`; the server part
still auto-registers MCP. `dist/` is tracked, so a plain Git install needs no
build.

`npm run board` is still available for a browser-first workflow or manual
operation. It starts the same canvas on `http://127.0.0.1:4317`, with durable
state in the user-level board store (see below), exports there too, and a log
under its `state/` directory:

```sh
npm run board
```

Open that URL in a browser to watch or edit the board. Check `/mcps` in the TUI
(or `opencode mcp list` against a server that loaded this project) and use the
26 exposed `whiteboard_*` tools. The MCP server runs locally over stdio; it is
not an HTTP endpoint.

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
built bundle is evaluated with the host's actual CommonJS loader contract
(`new Function("require", "module", "exports", code)`, which provides no
`__dirname` or `import.meta.url`) and inert window/main placeholders:
main-process cold start, embed creation, idempotent ensure, and the
`/whiteboard` toggle command all run against the real bundle and a real canvas
process. The install verification loads the package through the real OpenCode
server and confirms
the installed GUI bundle, auto-registered MCP connection, 26-tool surface, and
embedded skill.

`opencode plugin add` writes the plugin into the **global**
`opencode.json(c)`, which is exactly what OpenCode Desktop reads for GUI parts.
The one-reference install therefore needs no separate Desktop step. If the panel
does not appear in a particular Desktop build, use **Whiteboard: Open board**
(browser pane) or open `http://127.0.0.1:4317` directly; the canvas itself is
still the same working board.

## Project configuration

There is nothing to add for a normal install. `opencode plugin add` writes the
package into the global `plugins` array, and the server part registers the MCP
server at startup:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-whiteboard"]
}
```

The plugin resolves the pinned upstream MCP and canvas entry points from its own
installed dependency tree. It sets the same loopback URL, durable directory, and
export directory as the CLI/Desktop backend. The plugin owns the `whiteboard`
MCP name; remove any hand-written server with that name. A checkout uses the same
mechanism through its project-local `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": ".", "options": { "boardUrl": "http://127.0.0.1:4317" } }
  ],
  "permissions": [
    { "action": "whiteboard_export_to_excalidraw_url", "resource": "*", "effect": "deny" }
  ]
}
```

The permission rule is defense in depth for a checkout. The plugin also removes
`whiteboard_export_to_excalidraw_url` (and the raw `export_to_excalidraw_url`)
from the effective tool surface, so an installed package needs no config rule.
There is no share/upload tool in this setup.

Optional plugin options (object form):

| Option | Meaning |
| --- | --- |
| `configPath` | Workspace config file instead of the packaged `whiteboard.config.json`. Relative to the package root. |
| `projectRoot` | Package/workspace root for the config and skill lookup. Relative to the package root. |
| `mcp: false` | Do not auto-register the `whiteboard` MCP server. |
| `skill: false` | Do not contribute the embedded whiteboard skill. |
| `allowUpload: true` | Leave upstream's upload tool exposed. Not recommended; off by default. |

`WHITEBOARD_CONFIG` points the backend, MCP auto-registration, and Desktop main
process at a different config file. `WHITEBOARD_HOME` overrides the user-level
board root for isolation or tests.

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
Export the current board to the shared exports directory.
```

```text
Check which board this plugin uses (in a checkout, run node bin/whiteboard.mjs info).
```

```text
Pull the board again and tell me what changed since the last pull.
```

The skill at `.opencode/skills/whiteboard/SKILL.md` is discovered in a checkout
and embedded by the server plugin for an installed package. It teaches the agent
to:

- use `describe_scene` and `get_canvas_screenshot` for **pull**;
- never use an upload/share path;
- treat the board as the one shared local default board;
- re-pull before assuming the canvas is fresh.

"Pull, no send" is therefore both a tool-surface rule and an instruction. Board
contents stay in the local canvas process, the local durable directory, and the
model context the user explicitly asked for.

## Board identity and scope

This prototype deliberately exposes **one shared local board** to every project
that loads the plugin. It is not silently per-project routing; the shared scope
is chosen, documented, and can be isolated with `WHITEBOARD_HOME`.

| Setting | Value |
| --- | --- |
| Board id | `default` |
| URL | `http://127.0.0.1:4317` (loopback only) |
| Scope | one shared board for every OpenCode project using this plugin |
| Durable state | user data root `.../opencode-whiteboard/data/` |
| Exports | user data root `.../opencode-whiteboard/exports/` |
| Manifest/lock/log | user data root `.../opencode-whiteboard/state/` |

The user data root is outside npm/Git plugin caches so `opencode plugin update`
cannot delete board state:

| Platform | Default root |
| --- | --- |
| Linux/BSD | `$XDG_DATA_HOME/opencode-whiteboard` or `~/.local/share/opencode-whiteboard` |
| macOS | `~/Library/Application Support/opencode-whiteboard` |
| Windows | `%LOCALAPPDATA%\opencode-whiteboard` |

Set `WHITEBOARD_HOME` to override it, for example to keep separate boards per
workspace or test run. For a custom project-scoped config, set
`"storage": "project"` and point `WHITEBOARD_CONFIG`/`configPath` at it; relative
`dataDir`, `exportDir`, and `stateDir` then resolve from the config file's
directory. Reliable automatic per-project routing is not implemented.

The wrapper refuses non-loopback URLs and refuses to reuse a port that answers
with a different service identity. There is no port auto-discovery, so an agent
cannot silently attach to an unrelated service. If another canvas already owns
`127.0.0.1:4317`, the backend reuses it only after the service identity check.
Startup is single-flight: one promise in the process plus an exclusive
`board.lock` across processes, with the health check repeated after the lock is
taken. A crashed lock owner is detected by pid and cleaned up; a live owner is
waited for, never killed. Multi-board selection is intentionally out of scope
for v0.2.x.

Commands:

```sh
npm run board          # start/ensure (idempotent, single-flight)
npm run board:status   # health + element count + durable flag
npm run board:info     # manifest, scope, paths, upstream version
npm run board:stop     # identity-checked shutdown
```

`node bin/whiteboard.mjs ensure` is an alias for `start`. The same
`bin/lib/backend.mjs` module is used by the CLI, the Desktop main process, and
the server plugin's MCP registration, so validation, retries, and the durable
store cannot drift between them. The MCP entry points at the same
`EXPRESS_SERVER_URL` and `EXCALIDRAW_DATA_DIR`; the verification suite asserts
that.

### Portability of the install

The packaged `whiteboard.config.json` uses `"storage": "user"`, so a Git-installed
package never writes into `node_modules` or the OpenCode plugin cache. The
install is self-contained: pinned dependencies, prebuilt GUI bundle, MCP entry,
and config all resolve from the installed package, while board state stays in
the user data root. A checkout can use `"storage": "project"` with
`package: "."` when self-contained test state is wanted. `npm ci --ignore-scripts`
is unchanged; no global install or configuration is performed by the package
itself (the `opencode plugin add` command is the explicit user action).

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

What it actually runs (29 checks at the time of writing):

1. dependency is pinned to `mcp-excalidraw-server@2.2.0` in `package.json` and
   `package-lock.json`;
2. the published upstream package has no `preinstall`/`postinstall` hook;
3. the package version, exports map, shipped `files`, and tracked GUI bundle are
   correct;
4. the config keeps the fixed loopback board, uses the user-level store, and
   denies the upload tool;
5. the real server part auto-registers the same URL and durable store from the
   package's own MCP entry; no hand-written MCP block is needed;
6. the real server part removes both upload tool IDs and contributes the
   embedded skill;
7. the Desktop GUI bundle exists, externalizes host modules, and contains the
   cold-start, simplified panel-command, and `/whiteboard` slash wiring;
8. a real upstream canvas starts on an isolated port with durable state;
9. the canvas UI is served;
10. real MCP stdio `initialize` and `tools/list` (27 raw upstream tools);
11. MCP creates two boxes and a bound arrow;
12. MCP pulls the scene and finds the labels;
13. MCP renders a headless PNG screenshot;
14. MCP exports a `.excalidraw` file with bound labels;
15. MCP clears the test canvas;
16. headless Chromium renders the real UI (skipped if Chromium is absent);
17. MCP auto-starts a canvas with no manual `board` command;
18. the shared backend cold-starts with no manual `board` command;
19. a second start reuses the running canvas;
20. two concurrent starts produce exactly one spawn and one pid;
21. a foreign service on the port is rejected and left untouched;
22. startup succeeds on retry after the conflict clears;
23. MCP reuses the shared backend and durable store instead of spawning again;
24. stop is identity-checked and leaves the port free;
25. the built Desktop bundle loads under the official CommonJS loader bindings
    (`new Function`, no `__dirname`) and its main process cold-starts and
    creates an embed (placeholder Electron);
26. a second ensure reuses that backend;
27. the built bundle registers exactly one composer slash command, `/whiteboard`,
    tied to the panel toggle; repeated toggling calls the documented
    `Layout.toggle` API (mock), opening when closed and closing when open, with
    no prompt or model call; the browser fallback opens;
28. an invalid config is returned to the panel as an error, with no embed;
29. durable state survives a canvas restart.

Test state uses isolated configs/ports; production persistence uses the
user-level board root. The default board is not touched.

### One-reference Git install verification

```sh
npm run test:install
```

This is a separate, heavier check that builds a disposable bare Git remote from
the current working tree, runs the real
`opencode plugin add git+file://...#main` with an isolated HOME/config/cache,
starts a private `opencode serve`, and verifies:

- the package lands in OpenCode's plugin cache with the tracked GUI bundle,
  server part, MCP dependency, and skill;
- the server plugin auto-registers `whiteboard` and OpenCode reports
  **connected** without any MCP config edit;
- the effective tool catalog has 26 `whiteboard_*` tools and no upload tool;
- the embedded `whiteboard` skill is registered;
- an MCP tool call cold-starts the canvas and writes durable state to the
  user-level store outside the package cache;
- the installed `dist/gui-experimental.cjs` contains the Desktop
  cold-start/toggle wiring and host-module externals, with no `__dirname` or
  `__filename`;
- the installed server answers the Desktop path-handoff RPC with the package
  cache root and the active whiteboard config;
- the documented pinned upgrade sequence (`plugin remove` old reference, then
  `plugin add` new reference) leaves one configured entry and preserves the
  user-level board store.

The test does not use the real OpenCode config, credentials, or port 4317. It
is not part of `npm test` because it needs Git and starts a second OpenCode
server; run it before publishing a tag.

The Desktop bundle checks use the host's real loader bindings and a placeholder
Electron because Desktop is not installed here; they run the real built bundle,
the real Ipc code, and a real canvas process. A static check rejects
`__dirname` and `__filename` in the bundle. The Git install test uses the real
OpenCode server and package cache but still cannot exercise the real Electron
`WebContentsView`/window runtime. That remains the one unverified layer.

## Security and supply chain

- Runtime dependencies are pinned exactly: `mcp-excalidraw-server@2.2.0`
  (canvas/MCP, MIT), `@opencode/plugin@2.3.2` (plugin/GUI API, MIT),
  `effect@4.1.0`, and `solid-js@1.9.20`. All are pinned in the lockfile.
- `dist/gui-experimental.cjs` is built and tracked, so a Git install does not
  run a build or install script. The upstream package has no
  `preinstall`/`postinstall` hook.
- The MCP server is auto-registered from the pinned package dependency. Its
  command uses the package's own `node_modules`, and the environment points at
  the same URL/data path as the shared backend.
- Upstream's upload tool is removed from the exposed tool surface. The checkout
  config also keeps a permission deny rule as defense in depth.
- The canvas binds `127.0.0.1` only. No account, API key, tunnel, container, or
  hosted service is added.
- Upstream's REST/WS API has no authentication. Do not bind it to a non-loopback
  interface or expose the port.
- `npm audit` reports vulnerabilities inherited from upstream's dependency tree
  (27 at install time, 3 high). They were not force-upgraded because that would
  break the pinned, tested upstream. Review before production use.
- The package itself does not modify global config or credentials.
  `opencode plugin add` is the explicit user action that writes the plugin entry.
  Nothing is published to a public npm registry; installation uses the tagged
  public Git repository. The older v0.1 prerelease zip is a download-only test
  artifact.

## Files

```text
opencode-whiteboard/
├── opencode.jsonc              checkout plugin entry + permission deny rule
├── whiteboard.config.json      shared board (user storage, URL, paths)
├── bin/whiteboard.mjs          start/ensure/status/stop/info wrapper
├── bin/lib/backend.mjs         shared lifecycle, paths, MCP/canvas resolution
├── src/
│   ├── index.ts                server part: auto MCP, privacy, skill
│   ├── gui.tsx                 GUI plugin entry (setup + main)
│   └── gui/
│       ├── contract.ts         typed window <-> main Ipc
│       ├── definition.ts       declarations + copy
│       ├── main.ts             cold start, WebContentsView, health gate
│       ├── window.tsx          Panel, `/whiteboard` toggle, launcher, fallback
│       └── board.tsx           panel UI + fallback card
├── dist/gui-experimental.cjs   tracked prebuilt Desktop bundle
├── scripts/verify.mjs          end-to-end canvas/MCP/GUI-bundle checks
├── scripts/verify-install.mjs  clean Git remote + OpenCode install test
├── .opencode/skills/whiteboard/SKILL.md
├── LICENSE                     MIT
└── THIRD_PARTY_NOTICES.md
```

Local board state lives in the user data root, not in the repository. The
gitignored `.whiteboard/` directory remains available for `storage: "project"`
test configs.

## Known limitations

- The real Desktop GUI runtime is unverified here; the API is experimental. The
  bundle's main/setup code is tested under the host loader contract and mocked
  Electron, not a real Desktop window. Composer slash commands are documented
  by the V2 GUI `Command.slash` API and present in the pinned SDK types; the actual Desktop
  composer runtime is not available here, so the tests verify the `/whiteboard`
  registration and its toggle behavior rather than rendering the composer.
- Desktop loads GUI parts from the global plugin entry that
  `opencode plugin add` writes. The app runtime itself is unverified here.
- One **shared** board for every project using the plugin; no automatic
  per-project routing or board picker. Use `WHITEBOARD_HOME` or a project-local
  config with `"storage": "project"` to separate boards.
- If another process already owns `127.0.0.1:4317`, the backend reuses it only
  after the canvas service-identity check. Stop a stale board with
  `npm run board:stop`; use `WHITEBOARD_CONFIG` for a different port.
- No custom MCP facade: upstream's 27 raw tools are exposed, with the upload tool
  removed at the OpenCode tool layer. "Board info" is a CLI command
  (`npm run board:info`), not an MCP tool.
- Upstream's browser UI still depends on its own CDN font request.
- If the GUI entry is not loaded by a particular Desktop build, use the browser
  pane command when available or open the loopback URL directly. The canvas
  itself is still the same working board.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
