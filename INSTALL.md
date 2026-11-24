# Install OpenCode Whiteboard v0.2.3

v0.2.3 is a one-reference Git install. The package ships its prebuilt Desktop GUI
bundle, auto-registers the MCP server, and keeps board state outside the package
cache. No local MCP entry, GUI build, or global JSON edit is required.

v0.2.3 keeps `/whiteboard` available in a fresh desktop draft, before the first
message. The side panel requires an active session, so in a draft the command
opens the board in the system browser instead; in a session it still toggles the
panel. That draft behavior is covered by the mocked-host test suite, not by
driving a real draft in Desktop. The panel itself still relies on the v0.2.2
sizing fix: the embedded view had no sizing class, measured 0px, and Electron
never placed the canvas. That fix was checked in a real OpenCode Desktop
**2.4.1** session at a wide and a narrow panel width, where the canvas toolbar
rendered. Other Desktop builds and the rest of the canvas interaction surface
were not exercised there.

The release is published in the public
[`kotarCreative/opencode-whiteboard`](https://github.com/kotarCreative/opencode-whiteboard)
repository. Installing it does **not** require a GitHub account, `gh` login, SSH
key, or npm login, and it is not published to npm. The install uses the public
**v0.2.3** tag.

## Requirements

- Node.js **20+** on `PATH` (the MCP and canvas processes use Node)
- OpenCode **2.x**
- Git and network access for OpenCode to fetch the public Git package and its
  pinned npm dependencies
- Optional Desktop panel: OpenCode Desktop with the experimental GUI plugin API
  (the GUI bundle is built against `@opencode/plugin` **2.3.2**; the related
  community plugin requires Desktop **2.2.7+**)
- A local Chromium is only needed for the optional UI smoke test

## 1. Install one reference

```sh
opencode plugin add 'github:kotarCreative/opencode-whiteboard#v0.2.3'
```

The command installs the package into OpenCode's plugin cache and adds it to the
**global** `opencode.json(c)`. That is the whole install. It does not clone the
repository into your workspace, run `npm install`, build the GUI, or add a
separate MCP entry.

After it succeeds, **restart OpenCode Desktop** (quit and reopen it) so the
global plugin entry and its GUI part are loaded. In the TUI, restart the TUI or
run `opencode service restart` if the plugin does not appear.

If you prefer SSH, the equivalent pinned reference is:

```sh
opencode plugin add 'git+ssh://git@github.com/kotarCreative/opencode-whiteboard.git#v0.2.3'
```

> **Public repository:** the default HTTPS install reads the public tag
> anonymously. If `opencode plugin add` reports a fetch failure, check Git and
> network/proxy access first:
>
> ```sh
> git ls-remote https://github.com/kotarCreative/opencode-whiteboard.git v0.2.3
> ```
>
> Do not put a token in the plugin spec. No GitHub authentication is needed for
> this public repository.

## 2. Verify the install

From any OpenCode project:

```sh
opencode plugin list
opencode mcp list
```

`opencode plugin list` should include **`opencode-whiteboard`**, and the MCP list
should include **`whiteboard connected`**. In the TUI, `/mcps` shows the same
server. The model sees 26 `whiteboard_*` tools; upstream's upload tool is
removed.

Pull the board:

```text
Pull the whiteboard into context and summarize the current diagram.
```

The first MCP tool call cold-starts the loopback canvas. No `npm run board` is
needed at runtime.

If OpenCode reports a plugin load error, check its server log path from
`opencode debug paths` and confirm the cache contains
`node_modules/opencode-whiteboard/dist/gui-experimental.cjs`,
`src/index.ts`, and `node_modules/mcp-excalidraw-server`. Then run
`opencode plugin add ...` again.

## 3. Desktop panel

`opencode plugin add` writes the global plugin entry that OpenCode Desktop reads,
so there is no separate Desktop install. **Restart Desktop after installing**,
then use **`/whiteboard`** in the composer, **Whiteboard: Toggle board panel**
from the command palette, or the **Whiteboard** launcher in the session
side-panel **+** menu. In a fresh draft, before the first message, `/whiteboard`
opens the board in the system browser because the side panel needs an active
session; after the session starts it toggles the panel.

The TUI has no Desktop side panel, and the `/whiteboard` GUI command does not
apply there. The MCP server and skill still work: use `/mcps` or
`opencode mcp list` to confirm the connection, and open
<http://127.0.0.1:4317> in a browser when you want the canvas UI.

The desktop panel is experimental. The build environment does not include
Desktop, so the automated suite cannot drive the Electron window; the v0.2.2
panel fix was checked manually in OpenCode Desktop **2.4.1** at a wide and a
narrow width, where the canvas toolbar rendered. v0.2.3's fresh-draft
`/whiteboard` path is covered only by the mocked host. See the caveats below. If a
particular Desktop build does not load the GUI, use **Whiteboard: Open board**
(browser pane) or open <http://127.0.0.1:4317> directly. The canvas and MCP
still work.

## Board data

v0.2.x deliberately uses **one shared local board** for every project that loads
the plugin. It is not per-project routing.

| Platform | Default data root |
| --- | --- |
| Linux/BSD | `$XDG_DATA_HOME/opencode-whiteboard` or `~/.local/share/opencode-whiteboard` |
| macOS | `~/Library/Application Support/opencode-whiteboard` |
| Windows | `%LOCALAPPDATA%\opencode-whiteboard` |

Inside that root:

```text
data/       durable Excalidraw scene state
exports/    .excalidraw exports
state/      board.json, lock, and log
```

`opencode plugin update` replaces the package cache; it does not touch this
directory. To use a separate board or an isolated test board:

```sh
export WHITEBOARD_HOME="$HOME/.local/share/opencode-whiteboard-work"
```

For a project-scoped config, create a config with `"storage": "project"` and
point the plugin/backend at it:

```sh
export WHITEBOARD_CONFIG=/absolute/path/to/whiteboard.config.json
```

Relative `dataDir`, `exportDir`, and `stateDir` then resolve from that config's
directory. See the README for plugin options and the config shape.

## Update or remove

Pinned tags are exact references. `opencode plugin update` updates unpinned Git
branches and ranges, but skips exact tags, so upgrade a pinned install by
removing the old reference and adding the new one:

```sh
opencode plugin remove 'github:kotarCreative/opencode-whiteboard#v0.2.2'
opencode plugin add 'github:kotarCreative/opencode-whiteboard#v0.2.3'
```

Remove the old reference first. `opencode plugin add` compares the full
configured reference, so adding a new tag while the old one remains leaves both
entries in the global `plugins` array. If you installed over SSH, use the same
SSH reference in both commands.

Restart OpenCode Desktop after the upgrade so it reloads the GUI bundle, and
restart the TUI or run `opencode service restart` if the server part does not
reload. `opencode plugin check` reports available updates. Board data is stored
outside the package cache and is preserved across remove/add and updates; see
[Board data](#board-data).

Remove with the same configured reference:

```sh
opencode plugin remove 'github:kotarCreative/opencode-whiteboard#v0.2.3'
```

Board data under the user data root is not removed automatically. Delete that
directory yourself only if you intend to discard the board and its exports.

## Development or no-Git install

A normal developer checkout still works:

```sh
git clone https://github.com/kotarCreative/opencode-whiteboard.git
cd opencode-whiteboard
npm ci --ignore-scripts
npm run build:gui
opencode
```

The checkout's `opencode.jsonc` loads the package from `.`; the server part
auto-registers MCP. The GUI bundle is tracked, so a Git package install does not
build it.

## Older v0.1 archive

The v0.1 portable zip release (`v0.1.0-test.1`) remains available as published
and is not updated. It required extracting the archive, running
`npm ci --ignore-scripts`, and optionally adding the extracted directory to the
global plugin list. Prefer the v0.2.x one-reference install above. Its bundled
README and INSTALL files are historical and still mention the private
prerelease process.

## Caveats

- The automated build environment has no Desktop, so the bundle is tested under
  the host’s actual CommonJS loader bindings, with a placeholder Electron, real
  IPC code, and a real canvas process; a clean Git install is tested against a
  real isolated OpenCode server. The panel layout and toolbar were also checked
  manually in OpenCode Desktop **2.4.1** at wide and narrow widths. That manual
  check does not cover other Desktop builds or full canvas interaction. v0.2.2
  fixed the blank panel caused by a 0px embed view. v0.2.3 keeps `/whiteboard`
  in a fresh draft, where it opens the system browser; that path is tested only
  against the mocked host. v0.2.1 fixed the
  Desktop-only `__dirname is not defined` startup crash: OpenCode supplies
  `require`, `module`, and `exports` but no Node path globals or
  `import.meta.url`.
- The Desktop GUI plugin API is experimental and may change. The TUI has no
  side panel; use the MCP path and the loopback URL there.
- The canvas binds `127.0.0.1` only. Do not expose the port or add a tunnel.
- One shared board for all projects. Set `WHITEBOARD_HOME` or use a
  `"storage": "project"` config for separation.
- The upstream package is pinned to `mcp-excalidraw-server@2.2.0`. `npm audit`
  reports inherited vulnerabilities; they are intentionally not force-upgraded
  for this tested prototype.
- No credentials are stored in the plugin package or its config.
