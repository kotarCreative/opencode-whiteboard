# Install OpenCode Whiteboard v0.2

v0.2 is a one-reference Git install. The package ships its prebuilt Desktop GUI
bundle, auto-registers the MCP server, and keeps board state outside the package
cache. No local MCP entry, GUI build, or global JSON edit is required.

The release lives in the private
[`kotarCreative/opencode-whiteboard`](https://github.com/kotarCreative/opencode-whiteboard)
repository. Installing it requires Git credentials that can read that repository.
It is not a public npm package yet. The install below targets the **v0.2.0**
tag; if that tag is not yet published, substitute a full commit hash.

## Requirements

- Node.js **20+** on `PATH` (the MCP and canvas processes use Node)
- OpenCode **2.x**
- Git, plus credentials for the private repository
- Optional Desktop panel: OpenCode Desktop with the experimental GUI plugin API
  (the related community plugin requires Desktop **2.2.7+**; this bundle is
  built against `@opencode/plugin` **2.3.2**)
- Network access for OpenCode to fetch the Git package and its pinned npm
  dependencies

## 1. Install one reference

HTTPS with GitHub CLI credentials:

```sh
gh auth setup-git
opencode plugin add github:kotarCreative/opencode-whiteboard#v0.2.0
```

SSH:

```sh
opencode plugin add 'git+ssh://git@github.com/kotarCreative/opencode-whiteboard.git#v0.2.0'
```

The command installs the package into OpenCode's plugin cache and adds it to the
**global** `opencode.json(c)`. That is the whole install. Restart OpenCode if it
is already running.

> **Private repository auth:** OpenCode uses your existing Git credential helper
> or SSH agent, the same one `git clone` uses. If `opencode plugin add` reports a
> clone/authentication failure, verify `git ls-remote` first:
>
> ```sh
> git ls-remote https://github.com/kotarCreative/opencode-whiteboard.git v0.2.0
> # or
> git ls-remote git@github.com:kotarCreative/opencode-whiteboard.git v0.2.0
> ```
>
> A release that advertises this command must be reachable through the user's
> existing Git credentials. Do not put a token in the plugin spec.

## 2. Verify the install

From any OpenCode project:

```sh
opencode mcp list
```

The output should include **`whiteboard connected`**. In the TUI, `/mcps` shows
the same server. The model sees 26 `whiteboard_*` tools; upstream's upload tool
is removed.

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
so there is no separate Desktop install. Use **`/whiteboard`** in the composer,
**Whiteboard: Toggle board panel** from the palette, or the **Whiteboard**
launcher in the session side-panel **+** menu.

If a particular Desktop build does not load the GUI, use **Whiteboard: Open
board** (browser pane) or open <http://127.0.0.1:4317> directly. The canvas and
MCP still work. The real Electron window runtime is not available in the build
environment; see the caveats below.

## Board data

v0.2 deliberately uses **one shared local board** for every project that loads
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

Reinstall with a new tag or commit:

```sh
opencode plugin add github:kotarCreative/opencode-whiteboard#v0.2.0
```

Exact tags and full commit hashes are reproducible installs. `opencode plugin
check` reports outdated package plugins; `opencode plugin update` updates
unpinned Git refs. Re-run `opencode plugin add` with a new tag/commit to move
deliberately.

Remove with the same configured reference, or delete it from the global
`plugins` array:

```sh
opencode plugin remove 'git+ssh://git@github.com/kotarCreative/opencode-whiteboard.git#v0.2.0'
```

Board data under the user data root is not removed automatically.

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
global plugin list. Prefer the v0.2 one-reference install above.

## Caveats

- The real Electron Desktop window path was not available in the build
  environment. The bundle is tested with mocked Electron/host modules, real IPC
  code, and a real canvas process; a clean Git install is tested against a real
  isolated OpenCode server.
- The canvas binds `127.0.0.1` only. Do not expose the port or add a tunnel.
- One shared board for all projects. Set `WHITEBOARD_HOME` or use a
  `"storage": "project"` config for separation.
- The upstream package is pinned to `mcp-excalidraw-server@2.2.0`. `npm audit`
  reports inherited vulnerabilities; they are intentionally not force-upgraded
  for this tested prototype.
- No credentials are stored in the plugin package or its config.
