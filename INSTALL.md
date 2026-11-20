# Install the private prerelease

This is the no-build install path for the v0.1 prototype. The zip is a
portable copy of the tracked project files plus the prebuilt Desktop GUI bundle
(`dist/gui-experimental.cjs`). It contains no `node_modules`, no board state,
and no personal data.

The release lives in the private
[`kotarCreative/opencode-whiteboard`](https://github.com/kotarCreative/opencode-whiteboard)
repository. Downloading it requires a GitHub account with access to that
repository. The release itself is private and is not a public distribution.

## Requirements

- Node.js **20+** (npm is included)
- OpenCode **2.x**
- Optional Desktop panel: OpenCode Desktop with the experimental GUI plugin API
  (the related community plugin requires Desktop **2.2.7+**; this bundle is
  built against `@opencode/plugin` **2.3.2**)
- Internet access for `npm ci` (the pinned dependencies come from npm)

## 1. Download

With the GitHub CLI authenticated as an account that can see the private repo:

```sh
gh release download v0.1.0-test.1 \
  --repo kotarCreative/opencode-whiteboard
```

This downloads the zip and `SHA256SUMS.txt`.

Or open the release page while signed in to GitHub:

<https://github.com/kotarCreative/opencode-whiteboard/releases/tag/v0.1.0-test.1>

Asset: `opencode-whiteboard-0.1.0-portable.zip`

Optionally download and check `SHA256SUMS.txt` from the same release.

## 2. Verify and extract

macOS / Linux:

```sh
sha256sum -c SHA256SUMS.txt        # macOS: shasum -a 256 -c SHA256SUMS.txt
unzip opencode-whiteboard-0.1.0-portable.zip
cd opencode-whiteboard-0.1.0
```

Windows PowerShell:

```powershell
Get-FileHash .\opencode-whiteboard-0.1.0-portable.zip -Algorithm SHA256
Expand-Archive -Path .\opencode-whiteboard-0.1.0-portable.zip -DestinationPath .
cd .\opencode-whiteboard-0.1.0
```

`tar -xf opencode-whiteboard-0.1.0-portable.zip` also works on current
Windows, macOS, and Linux.

## 3. Install locked dependencies

```sh
npm ci --ignore-scripts
```

`.npmrc` already sets `ignore-scripts=true`. There is **no build step**: the
GUI bundle is already in `dist/`. Do not run `npm run build:gui` just to install.

## 4. Open the board

From the extracted directory:

```sh
opencode
```

The project `opencode.jsonc` loads the `whiteboard` MCP server. Open `/mcps`
(or run `opencode mcp list`) and the whiteboard should be connected. The first
tool call starts the loopback canvas automatically.

For a browser-first check:

```sh
npm run board
```

Then open <http://127.0.0.1:4317>. Durable state is created on first use under
`.whiteboard/data`; exports go to `boards/`.

Optional verification (uses isolated test ports and does not touch the default
board):

```sh
node scripts/verify.mjs
```

## 5. Optional: Desktop panel

The browser/MCP path works with the project config alone. OpenCode Desktop only
loads GUI parts from plugins listed in the **global** `opencode.json(c)`, so the
panel needs one global entry.

Edit your global config:

| Platform | Path |
| --- | --- |
| Linux / macOS | `~/.config/opencode/opencode.jsonc` (or `$XDG_CONFIG_HOME/opencode/opencode.jsonc`) |
| Windows | `%USERPROFILE%\.config\opencode\opencode.jsonc` |

Add the **absolute path** of the extracted directory to the existing `plugins`
array. If the file does not exist, create it with:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/absolute/path/to/opencode-whiteboard-0.1.0"
  ]
}
```

Windows example (forward slashes are accepted):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "C:/Users/you/opencode-whiteboard-0.1.0"
  ]
}
```

Keep any other global settings and plugin entries. Relative paths in the global
config resolve from the global config directory, so use an absolute path here.

Restart OpenCode Desktop. Check **Settings > Extensions > Plugins** for
`opencode-whiteboard`, then use `/whiteboard` in the composer or the
**Whiteboard: Toggle board panel** command. The same command opens the panel in
the side region; closing it leaves the canvas and MCP running.

The global entry makes the panel available in every Desktop project, but its
backend is the extracted copy's `whiteboard.config.json` and `.whiteboard/data`.
To bind it to a different workspace, add plugin options such as
`"projectRoot"` or `"configPath"` in the object form. For this prototype, the
simplest setup is to run OpenCode from the extracted directory.

## Caveats

- The real Electron Desktop window path was not available in the build
  environment. The bundle is tested against mocked Electron/host modules, real
  IPC code, and a real canvas process. If the panel shows its retry card on a
  particular Desktop build, use **Whiteboard: Open board** (browser pane) or
  open <http://127.0.0.1:4317> directly; the same board is still served.
- The canvas binds `127.0.0.1` only. Do not expose the port or add a tunnel.
- The upstream package is pinned to `mcp-excalidraw-server@2.2.0`. `npm audit`
  reports inherited vulnerabilities; they are intentionally not force-upgraded
  for this tested prototype.
- No global configuration is changed by the archive. The Desktop entry above is
  the only optional global edit, and you can remove it at any time.

## Remove

Quit OpenCode, delete the extracted directory, and remove the path from the
global `plugins` array if you added it.
