#!/usr/bin/env node
// End-to-end verification for the prototype:
//   1. pinned dependency + project binding checks
//   2. real upstream canvas on an isolated port/data dir
//   3. real MCP stdio bridge: initialize, tools/list, draw, pull, screenshot, export
//   4. optional headless Chromium render of the canvas UI
// The default board on port 4317 is never touched.

import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import Module, { createRequire, isBuiltin } from "node:module"
import { createServer } from "node:http"
import { createInterface } from "node:readline"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { ModuleKind, ScriptTarget, transpileModule } from "typescript"
import { defaultDataRoot, loadBoardConfig } from "../bin/lib/backend.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const port = 4318
const url = `http://127.0.0.1:${port}`
const dataDir = join(root, ".whiteboard", "test-data")
const exportDir = join(root, ".whiteboard", "test-export")
const serverEntry = join(root, "node_modules", "mcp-excalidraw-server", "dist", "server.js")
const mcpEntry = join(root, "node_modules", "mcp-excalidraw-server", "dist", "index.js")
const cliEntry = join(root, "bin", "whiteboard.mjs")

const checks = []
function ok(name, detail = "") {
  checks.push({ name, status: "pass", detail })
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`)
}
function fail(name, detail = "") {
  checks.push({ name, status: "fail", detail })
  throw new Error(`${name}${detail ? ` — ${detail}` : ""}`)
}
function skip(name, detail = "") {
  checks.push({ name, status: "skip", detail })
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ""}`)
}

async function health(base = url) {
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return null
    const body = await response.json()
    return body.service === "mcp-excalidraw-canvas" ? body : null
  } catch {
    return null
  }
}

async function waitHealth(base, deadlineMs = 20000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const body = await health(base)
    if (body) return body
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
  }
  return null
}

function runCli(args, configPath) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: root,
    env: { ...process.env, WHITEBOARD_CONFIG: configPath },
    encoding: "utf8",
    timeout: 30000,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

function runCliAsync(args, configPath) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: root,
      env: { ...process.env, WHITEBOARD_CONFIG: configPath },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("close", (code) => done({ status: code, stdout, stderr }))
  })
}

function parseJson(result, label) {
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error(`${label}: expected JSON output, got ${result.stdout.slice(0, 500)} ${result.stderr.slice(0, 500)}`)
  }
}

// --- GUI bundle evaluation --------------------------------------------------
// OpenCode Desktop evaluates a plugin's ./gui-experimental bundle as CommonJS
// text with exactly these bindings:
//
//   new Function("require", "module", "exports", code)(host.require, module, module.exports)
//
// (packages/plugin/src/gui/host.ts, evaluatePluginBundle). It has no
// __dirname, __filename, or import.meta.url. Reproduce that call rather than
// require()ing the file, so the check catches Node-only module assumptions.
const guiWindowModules = new Set([
  "solid-js",
  "solid-js/web",
  "solid-js/store",
  "@opencode/client/solid",
  "@opencode/plugin/gui/file",
  "@opencode/plugin/gui/review",
  "@opencode/plugin/gui/browser",
])
const guiNative = createRequire(import.meta.url)

function inertGuiModule(name) {
  const label = `[inert module ${name}]`
  const inert = new Proxy(function inert() {}, {
    get(_, key) {
      if (key === "then") return undefined
      if (key === Symbol.toPrimitive || key === "toString") return () => label
      if (key === Symbol.hasInstance) return () => false
      return inert
    },
    set: () => true,
    defineProperty: () => true,
    deleteProperty: () => true,
    apply: () => inert,
    construct: () => inert,
  })
  return inert
}

async function evaluateGuiBundle(code, processName) {
  const names = [
    "effect",
    "@opencode/plugin/gui",
    "@opencode/plugin/gui/main",
    "@opencode/plugin/gui/browser",
    "@opencode/plugin/rpc",
    "@opencode/schema/rpc",
    "@opencode/client",
    "@opencode/client/effect",
    "solid-js",
    "solid-js/web",
    "solid-js/store",
  ]
  const modules = new Map(
    await Promise.all(
      names.map(async (name) => {
        try {
          return [name, await import(name)]
        } catch {
          return [name, undefined]
        }
      }),
    ),
  )
  const module = { exports: {} }
  new Function("require", "module", "exports", code)((name) => {
    if (name === "electron") return { WebContentsView: class WebContentsView {} }
    if (isBuiltin(name)) return processName === "main" ? guiNative(name) : inertGuiModule(name)
    if (processName === "main" && guiWindowModules.has(name)) return inertGuiModule(name)
    // Node resolves Solid to its server build; the window host supplies its
    // browser build. A structural placeholder keeps setup free of server-only
    // DOM shims while the real window modules stay external in the bundle.
    if (processName === "window" && /^solid-js(\/|$)/.test(name)) return inertGuiModule(name)
    const value = modules.get(name)
    if (value) return value
    throw new Error(`Plugin GUI bundle requires a module the app does not share: ${name}`)
  }, module, module.exports)
  return module.exports.default
}

class McpClient {
  constructor(child) {
    this.child = child
    this.nextId = 1
    this.pending = new Map()
    this.stderr = ""
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    this.lines.on("line", (line) => {
      if (!line.trim().startsWith("{")) return
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
        else pending.resolve(message.result)
      }
    })
    child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString()
    })
    child.on("exit", (code) => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error(`MCP exited (${code}) before response ${id}: ${this.stderr}`))
        this.pending.delete(id)
      }
    })
  }

  request(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timeout waiting for ${method}. stderr: ${this.stderr}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolvePromise, reject, timer })
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  }

  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
  }

  async call(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args })
    if (result?.isError) {
      throw new Error(`${name} returned an error: ${JSON.stringify(result.content)}`)
    }
    return result
  }
}

function textOf(result) {
  return (result?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

async function run() {
  console.log("Whiteboard prototype verification\n")

  // --- Supply chain / binding -------------------------------------------------
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  if (pkg.dependencies["mcp-excalidraw-server"] !== "2.2.0") {
    fail("upstream pinned", `expected 2.2.0, got ${pkg.dependencies["mcp-excalidraw-server"]}`)
  }
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"))
  const locked = lock.packages?.["node_modules/mcp-excalidraw-server"]?.version
  if (locked !== "2.2.0") fail("lockfile pins upstream", `got ${locked}`)
  ok("upstream pinned", "mcp-excalidraw-server 2.2.0 (MIT)")

  const upstreamPackage = JSON.parse(
    await readFile(join(root, "node_modules", "mcp-excalidraw-server", "package.json"), "utf8"),
  )
  if (upstreamPackage.scripts?.postinstall || upstreamPackage.scripts?.preinstall) {
    fail("upstream has no install script", "unexpected install hook")
  }
  ok("upstream package checked", "no preinstall/postinstall hook")

  if (pkg.version !== "0.2.2") fail("package version", pkg.version)
  if (pkg.exports?.["./gui-experimental"] !== "./dist/gui-experimental.cjs") {
    fail("package exports", JSON.stringify(pkg.exports))
  }
  if (!pkg.files?.includes("dist")) fail("package files", "dist is not shipped")
  if (existsSync(join(root, ".git"))) {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "dist/gui-experimental.cjs"], {
      cwd: root,
      encoding: "utf8",
    })
    if (tracked.status !== 0) fail("GUI bundle tracked", "dist/gui-experimental.cjs is not tracked in Git")
  }
  ok("package shape", `${pkg.name}@${pkg.version}, GUI bundle exported and tracked`)

  const config = await readFile(join(root, "opencode.jsonc"), "utf8")
  const boardConfig = JSON.parse(await readFile(join(root, "whiteboard.config.json"), "utf8"))
  if (boardConfig.url !== "http://127.0.0.1:4317" || boardConfig.name !== "default") {
    fail("fixed single-board binding", "whiteboard.config.json is not the default loopback board")
  }
  if (boardConfig.storage !== "user") {
    fail("shared board storage", "whiteboard.config.json must keep the one shared board outside the package cache")
  }
  if (!config.includes("whiteboard_export_to_excalidraw_url") || !config.includes('"effect": "deny"')) {
    fail("share/upload tool denied", "opencode.jsonc is missing the deny rule")
  }
  if (!config.includes("http://127.0.0.1:4317")) fail("fixed single-board binding", "board URL missing")
  const opencode = JSON.parse(config)
  if (opencode.mcp?.servers?.whiteboard) {
    fail("MCP auto-registration", "opencode.jsonc still hand-declares the whiteboard MCP server")
  }
  const expectedDataRoot = defaultDataRoot(process.env)
  const defaultBoard = loadBoardConfig({ root, env: process.env })
  if (defaultBoard.storage !== "user" || defaultBoard.dataRoot !== expectedDataRoot) {
    fail("shared board storage", `${defaultBoard.storage} ${defaultBoard.dataRoot} (expected user ${expectedDataRoot})`)
  }
  if (defaultBoard.dataDir.startsWith(join(root, "node_modules"))) {
    fail("shared board storage", "durable data resolved inside node_modules")
  }
  ok("privacy/binding config", "fixed loopback URL; export_to_excalidraw_url denied")

  const guiSource = await readFile(join(root, "src", "gui", "window.tsx"), "utf8")
  for (const api of ["layout.open(panelKey", "layout.toggle(panelKey", "slash: { name: \"whiteboard\" }", "main.ensure()"]) {
    if (!guiSource.includes(api)) fail("panel lifecycle commands", `missing ${api}`)
  }

  // Exercise the real server part with mocked registries. This proves the
  // one-reference install auto-registers MCP from the package's own dependency
  // tree, shares the backend's user-level store, removes the upload tool, and
  // contributes the skill without a project-local config edit. Transpile in
  // memory so the check also runs on Node 20, which cannot import .ts directly.
  const source = await readFile(join(root, "src", "index.ts"), "utf8")
  const rpcSource = await readFile(join(root, "src", "rpc.ts"), "utf8")
  const options = {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022, verbatimModuleSyntax: false },
  }
  const rpcPath = join(root, "src", `.verify-rpc-${process.pid}.mjs`)
  const transpiledPath = join(root, "src", `.verify-index-${process.pid}.mjs`)
  await writeFile(rpcPath, transpileModule(rpcSource, options).outputText)
  await writeFile(
    transpiledPath,
    transpileModule(source, options).outputText.replace('from "./rpc"', `from "./.verify-rpc-${process.pid}.mjs"`),
  )
  let serverPlugin
  try {
    serverPlugin = (await import(pathToFileURL(transpiledPath).href)).default
  } finally {
    await rm(transpiledPath, { force: true })
    await rm(rpcPath, { force: true })
  }
  if (serverPlugin.id !== "opencode-whiteboard" || typeof serverPlugin.setup !== "function") {
    fail("server plugin exports", "missing id/setup")
  }
  const registered = { mcp: null, removed: [], skill: null, rpc: null }
  const serverCtx = {
    location: { directory: root },
    options: {},
    rpc: {
      register: async (definition, handlers) => {
        registered.rpc = { definition, handlers }
        return { events: { emit: async () => {} }, dispose: () => {} }
      },
    },
    mcp: {
      transform: async (edit) => {
        edit({
          list: () => [],
          get: () => undefined,
          set: (name, value) => {
            registered.mcp = { name, value }
          },
          update: () => {},
          remove: () => {},
        })
      },
    },
    tool: {
      transform: async (edit) => {
        edit({
          list: () => [],
          get: () => undefined,
          add: () => {},
          update: () => {},
          remove: (id) => registered.removed.push(id),
          namespace: () => {},
        })
      },
    },
    skill: {
      transform: async (edit) => {
        edit({
          list: () => [],
          get: () => undefined,
          add: (value) => {
            registered.skill = value
          },
          update: () => {},
          remove: () => {},
        })
      },
    },
  }
  await serverPlugin.setup(serverCtx)
  if (!registered.mcp || registered.mcp.name !== "whiteboard") {
    fail("server auto-registers MCP", JSON.stringify(registered.mcp))
  }
  const mcp = registered.mcp.value
  if (mcp.type !== "local" || !mcp.command?.[1]?.endsWith("mcp-excalidraw-server/dist/index.js")) {
    fail("server auto-registers MCP", `unexpected command ${JSON.stringify(mcp.command)}`)
  }
  if (mcp.environment.EXPRESS_SERVER_URL !== defaultBoard.base) {
    fail("MCP uses the same board URL", `${mcp.environment.EXPRESS_SERVER_URL} vs ${defaultBoard.base}`)
  }
  if (mcp.cwd !== root) fail("MCP cwd is the workspace", `${mcp.cwd} vs ${root}`)
  if (resolve(mcp.environment.EXCALIDRAW_DATA_DIR) !== defaultBoard.dataDir) {
    fail("MCP uses the same durable store", `${mcp.environment.EXCALIDRAW_DATA_DIR} vs ${defaultBoard.dataDir}`)
  }
  if (
    !registered.removed.includes("whiteboard_export_to_excalidraw_url") ||
    !registered.removed.includes("export_to_excalidraw_url")
  ) {
    fail("upload tool removed from surface", JSON.stringify(registered.removed))
  }
  if (!registered.skill || !registered.skill.content.includes("describe_scene")) {
    fail("embedded skill registered", JSON.stringify(registered.skill?.id))
  }
  if (registered.rpc?.definition.id !== "opencode-whiteboard" || !registered.rpc.handlers.paths) {
    fail("server exposes ESM path handoff", JSON.stringify(registered.rpc?.definition?.id))
  }
  const handedOff = await registered.rpc.handlers.paths({}, {
    signal: new AbortController().signal,
    error: () => {
      throw new Error("unexpected rpc error")
    },
  })
  if (handedOff.root !== root || handedOff.configPath !== defaultBoard.configPath) {
    fail("server path handoff", JSON.stringify(handedOff))
  }
  ok(
    "server auto-registers MCP + privacy",
    `shared store ${defaultBoard.dataRoot}; upload tool removed; skill embedded; ESM path handoff`,
  )

  const guiBundle = join(root, "dist", "gui-experimental.cjs")
  if (!existsSync(guiBundle)) fail("GUI bundle built", "run npm run build:gui")
  const bundle = await readFile(guiBundle, "utf8")
  if (!bundle.includes('require("electron")') || !bundle.includes('require("solid-js')) {
    fail("GUI bundle externalizes host modules", "expected external electron and solid-js requires")
  }
  for (const token of ["__dirname", "__filename"]) {
    if (bundle.includes(token)) {
      fail("GUI bundle has no CommonJS path globals", `bundle references ${token}; Desktop supplies neither`)
    }
  }
  for (const required of ["ELECTRON_RUN_AS_NODE", "toggle-board-panel", "whiteboard.config.json", "opencode-whiteboard"]) {
    if (!bundle.includes(required)) fail("GUI bundle cold-start wiring", `missing ${required}`)
  }
  for (const removed of ["open-board-panel", "close-board-panel"]) {
    if (bundle.includes(removed)) fail("GUI bundle simplified commands", `stale command ${removed}`)
  }
  // The embed SDK renders a plain div, so the panel must size it. A classless View measures
  // 0px and the native canvas stays unplaced (the v0.2.1 blank-panel bug).
  if (!bundle.includes("absolute inset-0")) {
    fail("GUI bundle embed box", "the built panel does not give ctx.embeds.View a sizing class")
  }

  // Main process: the official loader bindings, real shared modules, Node
  // built-ins, and placeholders for window-only modules. Invoking `main` is
  // what used to throw "__dirname is not defined".
  const mainPlugin = await evaluateGuiBundle(bundle, "main")
  if (!mainPlugin || typeof mainPlugin.main !== "function") {
    fail("GUI main under Desktop loader", "default export has no main setup")
  }
  let embed
  const mainCtx = {
    options: {},
    log: { write: () => {} },
    windows: { on: () => {}, get: () => undefined },
    onCleanup: () => {},
    provide: (_token, value) => {
      embed = value
    },
    embeds: {},
    // The path handoff is read lazily, on the first cold start. Point it at a
    // package root without a config so ensure() fails before spawning
    // anything; the regression is evaluation and path safety, not a new board.
    client: {
      rpc: () => ({
        paths: async () => ({
          root: join(root, ".whiteboard", "missing-package"),
          configPath: "",
        }),
      }),
    },
  }
  await mainPlugin.main(mainCtx)
  if (!embed || typeof embed.ensure !== "function" || typeof embed.acquire !== "function") {
    fail("GUI main under Desktop loader", "WhiteboardEmbed Ipc was not provided")
  }
  const failedEnsure = await embed.ensure()
  if (failedEnsure.ok !== false || typeof failedEnsure.error !== "string") {
    fail("GUI main path handoff", JSON.stringify(failedEnsure))
  }

  // Window process: Node built-ins and Electron are inert placeholders, and
  // module scope plus setup must stay runnable without them.
  const windowPlugin = await evaluateGuiBundle(bundle, "window")
  if (!windowPlugin || typeof windowPlugin.setup !== "function") {
    fail("GUI window under Desktop loader", "default export has no setup")
  }
  const windowCtx = {
    options: { boardUrl: "http://127.0.0.1:4317" },
    app: { platform: "web" },
    id: "opencode-whiteboard",
    t: (key) => key,
    use: () => () => ({ status: "inactive" }),
    main: () => ({ ensure: async () => ({ ok: false, url: "", error: "test" }) }),
    add: () => () => {},
    layout: { open: () => {}, toggle: () => {}, state: () => "closed" },
    sessions: { current: () => undefined },
    toast: { show: () => {} },
    system: { openExternal: () => {} },
  }
  await windowPlugin.setup(windowCtx)

  ok(
    "GUI bundle",
    `${(await stat(guiBundle)).size} bytes, loads in both Desktop processes without __dirname/__filename`,
  )

  // Render the real panel in headless Chromium. The embed SDK's View is a plain div; this
  // asserts the panel gives it the panel's full box at a normal and a narrow width.
  const { verifyEmbedLayout } = await import("./verify-embed-layout.mjs")
  const embedLayout = await verifyEmbedLayout()
  if (embedLayout.status === "skip") skip("panel embed layout", embedLayout.detail)
  else ok("panel embed layout", `fills the panel: ${embedLayout.detail}`)

  // --- Isolated canvas ---------------------------------------------------------
  await rm(dataDir, { recursive: true, force: true })
  await mkdir(dataDir, { recursive: true })
  await mkdir(exportDir, { recursive: true })
  await rm(join(exportDir, "verify.excalidraw"), { force: true })

  if (await health(url)) {
    fail("isolated test port free", `something is already listening on ${url}`)
  }

  const canvas = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      EXPRESS_SERVER_URL: url,
      EXCALIDRAW_DATA_DIR: dataDir,
      EXCALIDRAW_EXPORT_DIR: exportDir,
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "ignore", "pipe"],
  })
  let canvasStderr = ""
  canvas.stderr.on("data", (chunk) => {
    canvasStderr += chunk.toString()
  })

  try {
    const started = await waitHealth(url)
    if (!started) fail("canvas starts", canvasStderr.slice(-800))
    ok("canvas starts", `${url} pid ${started.pid}, durable=${started.durable_state_enabled === true}`)

    const page = await fetch(url)
    const html = await page.text()
    if (page.status !== 200 || !html.includes("Excalidraw")) {
      fail("canvas UI served", `HTTP ${page.status}, ${html.length} bytes`)
    }
    ok("canvas UI served", `${html.length} bytes at /`)

    // --- MCP stdio bridge ---------------------------------------------------
    const mcp = spawn(process.execPath, [mcpEntry], {
      cwd: root,
      env: {
        ...process.env,
        EXPRESS_SERVER_URL: url,
        EXCALIDRAW_NO_AUTOSTART: "1",
        EXCALIDRAW_EXPORT_DIR: exportDir,
        ENABLE_CANVAS_SYNC: "true",
        LOG_LEVEL: "warn",
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    const client = new McpClient(mcp)

    try {
      const init = await client.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "opencode-whiteboard-verify", version: "0.2.2" },
      })
      if (!init?.serverInfo?.name) fail("MCP initialize", JSON.stringify(init))
      client.notify("notifications/initialized")
      ok("MCP initialize", `${init.serverInfo.name} ${init.serverInfo.version}`)

      const list = await client.request("tools/list")
      const names = (list?.tools ?? []).map((tool) => tool.name)
      for (const required of [
        "batch_create_elements",
        "describe_scene",
        "get_canvas_screenshot",
        "export_scene",
        "clear_canvas",
      ]) {
        if (!names.includes(required)) fail("MCP tool catalog", `missing ${required}`)
      }
      ok("MCP tools/list", `${names.length} tools`)

      await client.call("batch_create_elements", {
        elements: [
          {
            id: "verify-a",
            type: "rectangle",
            x: 80,
            y: 120,
            width: 180,
            height: 90,
            text: "Verify A",
            backgroundColor: "#a5d8ff",
          },
          {
            id: "verify-b",
            type: "rectangle",
            x: 380,
            y: 120,
            width: 180,
            height: 90,
            text: "Verify B",
            backgroundColor: "#b2f2bb",
          },
          {
            type: "arrow",
            x: 0,
            y: 0,
            startElementId: "verify-a",
            endElementId: "verify-b",
            text: "pull",
          },
        ],
      })
      const count = (await health(url))?.elements_count
      if (!Number.isInteger(count) || count < 3) fail("MCP creates elements", `expected at least 3, got ${count}`)
      ok("MCP creates elements", `${count} scene elements (boxes, labels, bound arrow)`)

      const described = textOf(await client.call("describe_scene"))
      if (!described.includes("Verify A") || !described.includes("Verify B")) {
        fail("MCP pulls scene", described.slice(0, 500))
      }
      ok("MCP pulls scene", `${described.length} chars, labels present`)

      const shot = await client.call("get_canvas_screenshot", { scale: 1 })
      const image = (shot?.content ?? []).find((part) => part.type === "image")
      if (!image || typeof image.data !== "string" || image.data.length < 5000) {
        fail("MCP headless screenshot", "image content missing or too small")
      }
      ok("MCP headless screenshot", `${Math.round((image.data.length * 3) / 4 / 1024)} KiB PNG`)

      const exportPath = join(exportDir, "verify.excalidraw")
      await client.call("export_scene", { filePath: exportPath })
      const exported = JSON.parse(await readFile(exportPath, "utf8"))
      if (
        !Array.isArray(exported.elements) ||
        !exported.elements.some((element) => element.id === "verify-a") ||
        !exported.elements.some((element) => element.text === "Verify A")
      ) {
        fail("MCP export_scene", `unexpected file contents`)
      }
      ok("MCP export_scene", `${exported.elements.length} elements with bound labels`)

      await client.call("clear_canvas")
      const cleared = (await health(url))?.elements_count
      if (cleared !== 0) fail("MCP clear_canvas", `expected 0, got ${cleared}`)
      ok("MCP clear_canvas", "test canvas reset")
    } finally {
      mcp.stdin.end()
      mcp.kill("SIGTERM")
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
    }

    // --- Optional real browser render --------------------------------------
    const hasChromium = spawnSync("sh", ["-c", "command -v chromium || command -v chromium-browser"], {
      encoding: "utf8",
    })
    if (hasChromium.status === 0 && hasChromium.stdout.trim()) {
      const screenshot = join(root, ".whiteboard", "verify-ui.png")
      const shot = spawnSync(
        hasChromium.stdout.trim(),
        [
          "--headless=new",
          "--no-sandbox",
          "--disable-gpu",
          "--hide-scrollbars",
          "--window-size=1280,800",
          "--virtual-time-budget=8000",
          `--screenshot=${screenshot}`,
          url,
        ],
        { timeout: 60000, encoding: "utf8" },
      )
      const size = existsSync(screenshot) ? (await stat(screenshot)).size : 0
      if (shot.status !== 0 || size < 10000) {
        skip("Chromium canvas render", `screenshot failed or too small (${size} bytes)`)
      } else {
        ok("Chromium canvas render", `${size} bytes at .whiteboard/verify-ui.png`)
      }
    } else {
      skip("Chromium canvas render", "chromium not installed")
    }
  } finally {
    canvas.kill("SIGTERM")
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
  }

  // --- MCP-driven auto-start (no manual `board` command) -------------------
  const autoUrl = "http://127.0.0.1:4319"
  const autoData = join(root, ".whiteboard", "test-auto")
  await rm(autoData, { recursive: true, force: true })
  await mkdir(autoData, { recursive: true })
  const autoMcp = spawn(process.execPath, [mcpEntry], {
    cwd: root,
    env: {
      ...process.env,
      EXPRESS_SERVER_URL: autoUrl,
      EXCALIDRAW_DATA_DIR: autoData,
      EXCALIDRAW_EXPORT_DIR: exportDir,
      ENABLE_CANVAS_SYNC: "true",
      LOG_LEVEL: "warn",
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const autoClient = new McpClient(autoMcp)
  try {
    const init = await autoClient.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "opencode-whiteboard-verify-auto", version: "0.2.2" },
    })
    if (!init?.serverInfo?.name) fail("MCP auto-start initialize", JSON.stringify(init))
    autoClient.notify("notifications/initialized")
    await autoClient.call("describe_scene")
    const started = await health(autoUrl)
    if (!started) fail("MCP auto-starts canvas", "no health response after first tool call")
    ok("MCP auto-starts canvas", `${autoUrl} pid ${started.pid}, no manual start`)
  } finally {
    autoMcp.stdin.end()
    autoMcp.kill("SIGTERM")
    const started = await health(autoUrl)
    if (started?.pid) {
      try {
        process.kill(started.pid, "SIGTERM")
      } catch {
        // already gone
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
  }

  // --- Shared backend: cold start, single-flight, foreign rejection --------
  const lifecycleDir = join(root, ".whiteboard", "test-lifecycle")
  const lifecycleConfig = join(lifecycleDir, "whiteboard.config.json")
  const lifecycleUrl = "http://127.0.0.1:4321"
  const foreignUrl = "http://127.0.0.1:4322"
  const writeBoardConfig = async (target, name, port) => {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(
      target,
      JSON.stringify(
        { name, url: `http://127.0.0.1:${port}`, dataDir: "data", exportDir: "exports", scope: "test" },
        null,
        2,
      ) + "\n",
    )
  }

  await rm(lifecycleDir, { recursive: true, force: true })
  let lifecycleServer = null
  try {
    await writeBoardConfig(lifecycleConfig, "lifecycle", 4321)
    if (await health(lifecycleUrl)) fail("lifecycle test port free", `something is already listening on ${lifecycleUrl}`)
    if (await health(foreignUrl)) fail("foreign test port free", `something is already listening on ${foreignUrl}`)

    // Opening the board from a fresh checkout must start the backend; no
    // `npm run board` first.
    const cold = runCli(["start"], lifecycleConfig)
    if (cold.status !== 0) fail("backend cold start", cold.stderr || cold.stdout)
    const coldInfo = parseJson(cold, "backend cold start")
    if (coldInfo.alreadyRunning !== false || !(await health(lifecycleUrl))) {
      fail("backend cold start", "start did not launch a healthy canvas")
    }
    const coldPid = coldInfo.health?.pid
    ok("backend cold start", `${lifecycleUrl} pid ${coldPid}, no manual board command`)

    const second = runCli(["start"], lifecycleConfig)
    if (second.status !== 0) fail("backend start idempotent", second.stderr || second.stdout)
    const secondInfo = parseJson(second, "backend start idempotent")
    if (secondInfo.alreadyRunning !== true || secondInfo.health?.pid !== coldPid) {
      fail("backend start idempotent", "second start did not reuse the running canvas")
    }
    ok("backend start idempotent", `reused pid ${coldPid}`)

    const stoppedForRace = runCli(["stop"], lifecycleConfig)
    if (stoppedForRace.status !== 0) fail("backend test stop", stoppedForRace.stderr || stoppedForRace.stdout)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))

    const [firstStart, secondStart] = await Promise.all([
      runCliAsync(["start"], lifecycleConfig),
      runCliAsync(["start"], lifecycleConfig),
    ])
    if (firstStart.status !== 0 || secondStart.status !== 0) {
      fail("backend single-flight", `${firstStart.stderr} ${secondStart.stderr}`)
    }
    const race = [parseJson(firstStart, "single-flight A"), parseJson(secondStart, "single-flight B")]
    const spawns = race.filter((entry) => entry.alreadyRunning === false)
    const pids = new Set(race.map((entry) => entry.health?.pid))
    if (spawns.length !== 1 || pids.size !== 1) {
      fail("backend single-flight", `expected one spawn and one pid, got ${JSON.stringify(race)}`)
    }
    ok("backend single-flight", `two concurrent starts → one canvas pid ${[...pids][0]}`)

    const stopRace = runCli(["stop"], lifecycleConfig)
    if (stopRace.status !== 0) fail("backend test stop", stopRace.stderr || stopRace.stdout)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))

    // A foreign service on the configured port is never adopted or killed.
    lifecycleServer = createServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ service: "not-the-whiteboard", pid: process.pid }))
    })
    await new Promise((done) => lifecycleServer.listen(4322, "127.0.0.1", done))
    await writeBoardConfig(lifecycleConfig, "lifecycle", 4322)

    const foreign = await runCliAsync(["start"], lifecycleConfig)
    if (foreign.status !== 1 || !/different service/i.test(foreign.stderr)) {
      fail("backend rejects foreign service", `status ${foreign.status}: ${foreign.stderr || foreign.stdout}`)
    }
    const foreignBody = await (await fetch(`${foreignUrl}/health`)).json()
    if (foreignBody.service !== "not-the-whiteboard") {
      fail("backend leaves foreign service alone", JSON.stringify(foreignBody))
    }
    ok("backend rejects foreign service", "port owner was not reused or signalled")

    await new Promise((done) => lifecycleServer.close(done))
    lifecycleServer = null

    // Retry after the conflict clears.
    const retry = runCli(["start"], lifecycleConfig)
    if (retry.status !== 0) fail("backend retries after failure", retry.stderr || retry.stdout)
    const retryInfo = parseJson(retry, "backend retry")
    if (retryInfo.alreadyRunning !== false || !(await health(foreignUrl))) {
      fail("backend retries after failure", "retry did not start a healthy canvas")
    }
    ok("backend retries after failure", `started pid ${retryInfo.health?.pid} on retry`)

    // MCP points at the same URL + durable store and must reuse the backend
    // rather than starting a second canvas.
    const sharedMcp = spawn(process.execPath, [mcpEntry], {
      cwd: root,
      env: {
        ...process.env,
        EXPRESS_SERVER_URL: foreignUrl,
        EXCALIDRAW_DATA_DIR: join(lifecycleDir, "data"),
        EXCALIDRAW_EXPORT_DIR: join(lifecycleDir, "exports"),
        ENABLE_CANVAS_SYNC: "true",
        LOG_LEVEL: "warn",
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    const sharedClient = new McpClient(sharedMcp)
    try {
      const init = await sharedClient.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "opencode-whiteboard-verify-shared", version: "0.2.2" },
      })
      if (!init?.serverInfo?.name) fail("MCP reuses shared backend", JSON.stringify(init))
      sharedClient.notify("notifications/initialized")
      await sharedClient.call("describe_scene")
      const after = await health(foreignUrl)
      if (after?.pid !== retryInfo.health?.pid) {
        fail("MCP reuses shared backend", `pid changed from ${retryInfo.health?.pid} to ${after?.pid}`)
      }
      ok("MCP reuses shared backend", `same durable store, pid ${after.pid}`)
    } finally {
      sharedMcp.stdin.end()
      sharedMcp.kill("SIGTERM")
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
    }

    const finalStop = runCli(["stop"], lifecycleConfig)
    if (finalStop.status !== 0) fail("backend identity-checked stop", finalStop.stderr || finalStop.stdout)
    const finalStopInfo = parseJson(finalStop, "backend stop")
    if (finalStopInfo.stopped !== true || (await health(foreignUrl))) {
      fail("backend identity-checked stop", "canvas still healthy after stop")
    }
    ok("backend identity-checked stop", `stopped pid ${finalStopInfo.pid}`)
  } finally {
    if (lifecycleServer) await new Promise((done) => lifecycleServer.close(done))
    const cleanupStop = runCli(["stop"], lifecycleConfig)
    if (cleanupStop.status !== 0) {
      // Best effort: the test may already have stopped it.
      const body = await health(lifecycleUrl)
      const other = await health(foreignUrl)
      if (body?.pid) {
        try {
          process.kill(body.pid, "SIGTERM")
        } catch {}
      }
      if (other?.pid) {
        try {
          process.kill(other.pid, "SIGTERM")
        } catch {}
      }
    }
  }

  // --- Desktop GUI bundle: main-process cold start + panel commands ---------
  // Desktop is not installed here. Exercise the built bundle with mocked
  // Electron/host modules, so the real main/setup code, Ipc and backend run.
  const desktopDir = join(root, ".whiteboard", "test-desktop")
  const desktopConfig = join(desktopDir, "whiteboard.config.json")
  await rm(desktopDir, { recursive: true, force: true })
  await writeBoardConfig(desktopConfig, "desktop-smoke", 4327)
  if (await health("http://127.0.0.1:4327")) {
    fail("desktop smoke port free", "something is already listening on 4327")
  }

  const requireFromVerify = createRequire(import.meta.url)
  const load = Module._load
  const tokens = {
    Command: { kind: "registry", id: "verify.command" },
    MenuItem: { kind: "registry", id: "verify.menu" },
    Panel: { kind: "registry", id: "verify.panel" },
  }
  const fakeWeb = {
    template: () => ({}),
    delegateEvents: () => {},
    insert: () => {},
    createComponent: () => ({}),
    effect: () => {},
    style: () => {},
  }
  const fakeSolid = {
    createSignal: (value) => [() => value, () => {}],
    onMount: () => {},
    Show: () => {},
  }
  const fakeGui = {
    Plugin: { define: (value) => value },
    Ipc: { define: (spec) => ({ kind: "ipc", id: spec.id, spec }) },
    ...tokens,
  }
  class FakeView {
    constructor() {
      this.webContents = {
        isDestroyed: () => false,
        close: () => {},
        setWindowOpenHandler: () => {},
        on: () => {},
        loadURL: async (target) => {
          desktop.loaded = target
        },
      }
    }
  }
  const desktop = {
    loaded: null,
    impl: null,
    openExternal: [],
    toasts: [],
    layout: [],
    prompts: [],
    composerWrites: [],
    panelState: "closed",
  }

  Module._load = function (request, parent, isMain) {
    if (request === "electron") return { WebContentsView: FakeView }
    if (request === "solid-js/web") return fakeWeb
    if (request === "solid-js") return fakeSolid
    if (request === "@opencode/plugin/gui") return fakeGui
    if (request === "@opencode/plugin/gui/browser") return {}
    if (request === "@opencode/plugin/rpc") return { Rpc: { define: (spec) => spec } }
    return load.call(this, request, parent, isMain)
  }

  try {
    const definition = requireFromVerify(join(root, "dist", "gui-experimental.cjs")).default
    if (typeof definition.main !== "function" || typeof definition.setup !== "function") {
      fail("desktop bundle exports", "the bundle is missing setup/main")
    }

    const log = []
    const caller = { window: 1, signal: new AbortController().signal }
    const mainCtx = {
      id: "opencode-whiteboard",
      options: {},
      app: { platform: "desktop" },
      log: { write: (...args) => log.push(args) },
      client: {
        rpc: () => ({
          paths: async () => ({ root, configPath: desktopConfig }),
        }),
      },
      windows: { get: () => ({}), on: () => () => {} },
      embeds: {
        create: () => ({
          id: "embed-1",
          show: (visible) => {
            desktop.shown = visible
          },
          dispose: () => {},
        }),
      },
      onCleanup: () => {},
      provide: (_token, impl) => {
        desktop.impl = impl
        return { changed() {}, emit() {}, dispose() {} }
      },
    }
    definition.main(mainCtx)
    if (!desktop.impl) fail("desktop main provides Ipc", "ctx.provide was not called")

    const first = await desktop.impl.ensure({}, caller)
    if (!first.ok || first.started !== true) {
      fail("desktop main cold start", JSON.stringify(first))
    }
    const acquired = await desktop.impl.acquire({}, caller)
    if (acquired.id !== "embed-1" || acquired.error !== null || desktop.loaded !== first.url) {
      fail("desktop main acquire", `${JSON.stringify(acquired)} loaded ${desktop.loaded}`)
    }
    ok("desktop main cold start", `mock Electron: started ${first.url}, embed ${acquired.id}`)

    const second = await desktop.impl.ensure({}, caller)
    if (!second.ok || second.started !== false) fail("desktop main idempotent", JSON.stringify(second))
    ok("desktop main reuses backend", `already running at ${second.url}`)

    const session = { id: "session-1" }
    const registrations = new Map()
    const setupCtx = {
      ...mainCtx,
      id: "opencode-whiteboard",
      options: { configPath: desktopConfig, boardUrl: first.url },
      sessions: { current: () => session },
      screen: {
        current: () => ({
          composer: {
            insert: (text) => desktop.composerWrites.push(text),
          },
        }),
      },
      client: {
        rpc: mainCtx.client.rpc,
        session: {
          prompt: (input) => {
            desktop.prompts.push(input)
          },
        },
      },
      use: () => () => ({ status: "inactive", reason: "disabled" }),
      main: () => ({
        ensure: () => desktop.impl.ensure({}, caller),
        acquire: () => desktop.impl.acquire({}, caller),
      }),
      t: (key) => key,
      system: {
        openExternal: (target) => {
          desktop.openExternal.push(target)
        },
      },
      toast: {
        show: (options) => {
          desktop.toasts.push(options)
          return { dismiss() {} }
        },
      },
      layout: {
        open: (key, target) => {
          desktop.panelState = "visible"
          desktop.layout.push(["open", key, target.id])
        },
        close: (key, target) => {
          desktop.panelState = "closed"
          desktop.layout.push(["close", key, target.id])
        },
        toggle: (key, target) => {
          desktop.panelState = desktop.panelState === "closed" ? "visible" : "closed"
          desktop.layout.push(["toggle", key, target.id])
        },
        state: () => desktop.panelState,
      },
      add: (token, item) => {
        const value = typeof item === "function" ? item() : item
        if (token === tokens.Command) registrations.set(`command:${value.id}`, value)
        if (token === tokens.MenuItem) registrations.set("menu", value)
        if (token === tokens.Panel) registrations.set("panel", value)
        return () => {}
      },
    }
    definition.setup(setupCtx)

    const commands = [...registrations.entries()]
      .filter(([key]) => key.startsWith("command:"))
      .map(([, value]) => value)
    const slashes = commands.filter((command) => command.slash)
    if (slashes.length !== 1 || slashes[0].slash.name !== "whiteboard") {
      fail(
        "composer slash command",
        `expected exactly /whiteboard, got ${JSON.stringify(slashes.map((command) => command.slash))}`,
      )
    }
    if (slashes[0].slash.arguments !== undefined) {
      fail("composer slash command", "slash must not accept or forward prompt arguments")
    }
    if (commands.some((command) => command.id === "open-board-panel" || command.id === "close-board-panel")) {
      fail("palette simplified", `redundant panel commands are still registered: ${commands.map((c) => c.id).join(", ")}`)
    }
    if (!commands.some((command) => command.id === "open-board" && !command.slash)) {
      fail("browser fallback command", "open-board fallback is missing or has a slash command")
    }

    const toggle = registrations.get("command:toggle-board-panel")
    if (!toggle) fail("panel commands registered", "toggle-board-panel missing")
    if (toggle !== slashes[0]) fail("composer slash command", "/whiteboard is not the panel toggle command")

    const toggled = []
    for (let i = 0; i < 4; i++) {
      await toggle.run()
      toggled.push(desktop.panelState)
    }
    const key = "opencode-whiteboard:board"
    const sequence = desktop.layout.map((entry) => entry[0]).join(",")
    if (desktop.layout.some((entry) => entry[1] !== key) || sequence !== "toggle,toggle,toggle,toggle") {
      fail("panel toggle API", JSON.stringify(desktop.layout))
    }
    if (toggled.join(",") !== "visible,closed,visible,closed") {
      fail("repeated /whiteboard toggling", toggled.join(","))
    }
    if (desktop.prompts.length || desktop.composerWrites.length) {
      fail(
        "slash command stays out of chat",
        `prompts=${desktop.prompts.length}, composerWrites=${desktop.composerWrites.length}`,
      )
    }
    if (!registrations.get("panel")) fail("panel registered", "Panel contribution missing")

    await registrations.get("command:open-board").run()
    if (!desktop.openExternal.includes(first.url)) {
      fail("open board cold-start command", `system browser did not receive ${first.url}`)
    }
    ok(
      "desktop panel toggle and /whiteboard",
      "mock Layout API: open → close → open → close, no prompt/model; browser fallback opened",
    )

    // A missing/invalid config fails into the panel instead of throwing the
    // main entry or creating an embed.
    let failedImpl
    const failedCtx = {
      ...mainCtx,
      client: {
        rpc: () => ({
          paths: async () => ({ root, configPath: join(desktopDir, "missing.json") }),
        }),
      },
      provide: (_token, impl) => {
        failedImpl = impl
        return { changed() {}, emit() {}, dispose() {} }
      },
    }
    definition.main(failedCtx)
    const failedEnsure = await failedImpl.ensure({}, caller)
    const failedAcquire = await failedImpl.acquire({}, caller)
    if (failedEnsure.ok || !failedEnsure.error || failedAcquire.id !== null) {
      fail("desktop main failure path", JSON.stringify({ failedEnsure, failedAcquire }))
    }
    ok("desktop main failure path", "config error returned to the panel; no embed created")
  } finally {
    Module._load = load
    runCli(["stop"], desktopConfig)
  }

  // --- Durable local persistence across a canvas restart -------------------
  const durableUrl = "http://127.0.0.1:4320"
  const durableData = join(root, ".whiteboard", "test-durable")
  await rm(durableData, { recursive: true, force: true })
  await mkdir(durableData, { recursive: true })

  const startCanvas = async () => {
    const child = spawn(process.execPath, [serverEntry], {
      cwd: root,
      env: {
        ...process.env,
        PORT: "4320",
        HOST: "127.0.0.1",
        EXPRESS_SERVER_URL: durableUrl,
        EXCALIDRAW_DATA_DIR: durableData,
        EXCALIDRAW_EXPORT_DIR: exportDir,
        LOG_LEVEL: "warn",
      },
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    const body = await waitHealth(durableUrl)
    if (!body) fail("durable canvas starts", stderr.slice(-800))
    return child
  }

  let durableCanvas = await startCanvas()
  try {
    const created = await fetch(`${durableUrl}/api/elements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "durable-check",
        type: "rectangle",
        x: 40,
        y: 40,
        width: 160,
        height: 80,
        backgroundColor: "#ffec99",
      }),
    })
    if (!created.ok) fail("durable canvas accepts mutation", `HTTP ${created.status}`)
    durableCanvas.kill("SIGTERM")
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 700))
    durableCanvas = await startCanvas()
    const persisted = await fetch(`${durableUrl}/api/elements`)
    const scene = await persisted.json()
    const list = Array.isArray(scene) ? scene : (scene.elements ?? [])
    if (!list.some((element) => element.id === "durable-check")) {
      fail("durable persistence", "element missing after restart")
    }
    ok("durable persistence", "element survived canvas restart via EXCALIDRAW_DATA_DIR")
  } finally {
    durableCanvas.kill("SIGTERM")
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
  }

  const failed = checks.filter((check) => check.status === "fail")
  console.log(`\n${checks.filter((c) => c.status === "pass").length} passed, ${failed.length} failed, ${checks.filter((c) => c.status === "skip").length} skipped`)
  if (failed.length) process.exitCode = 1
}

run().catch((error) => {
  console.error(`\nFAIL  ${error.message}`)
  process.exitCode = 1
})
