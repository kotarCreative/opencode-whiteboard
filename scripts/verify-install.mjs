#!/usr/bin/env node
// One-reference Git install verification.
//
// Builds a disposable Git remote from this working tree (tracked and modified
// files, without node_modules/.git/.whiteboard), installs it with the real
// OpenCode CLI in an isolated HOME/config, starts a private OpenCode server,
// and checks the package cache, auto-registered MCP connection, effective tool
// surface, embedded skill, GUI bundle, and user-level board storage.
//
// This never touches the real OpenCode config, credentials, or board on 4317.
// Run with WHITEBOARD_INSTALL_KEEP=1 to keep the scratch directory.

import { spawn, spawnSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const keep = process.env.WHITEBOARD_INSTALL_KEEP === "1"
const base = await mkdtemp(join(tmpdir(), "opencode-whiteboard-install-"))
const snapshot = join(base, "snapshot")
const remote = join(base, "remote.git")
const home = join(base, "home")
const configDir = join(base, "config")
const dataDir = join(base, "data")
const stateDir = join(base, "state")
const cacheDir = join(base, "cache")
const workspace = join(base, "workspace")
const boardHome = join(base, "board-home")
const boardConfig = join(base, "whiteboard.config.json")
const toolsFile = join(base, "tools.json")
const servePort = await freePort()
const boardPort = await freePort()
const serverUrl = `http://127.0.0.1:${servePort}`
const password = "whiteboard-install-test"

const checks = []
function ok(name, detail = "") {
  checks.push({ name, status: "pass" })
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`)
}
function fail(name, detail = "") {
  checks.push({ name, status: "fail" })
  throw new Error(`${name}${detail ? ` — ${detail}` : ""}`)
}

const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: configDir,
  XDG_DATA_HOME: dataDir,
  XDG_STATE_HOME: stateDir,
  XDG_CACHE_HOME: cacheDir,
  WHITEBOARD_HOME: boardHome,
  WHITEBOARD_CONFIG: boardConfig,
  OPENCODE_PASSWORD: password,
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  WB_PROBE_OUT: toolsFile,
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? workspace,
    env,
    encoding: "utf8",
    timeout: options.timeout ?? 180_000,
  })
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    )
  }
  return result
}

function git(args, cwd) {
  return run("git", args, { cwd, timeout: 60_000 })
}

function api(path, options = {}) {
  const result = run(
    "opencode",
    ["api", "--server", serverUrl, options.method ?? "get", path, ...(options.args ?? [])],
    { timeout: 30_000, allowFailure: true },
  )
  if (result.status !== 0) return { error: (result.stderr || result.stdout).trim() }
  try {
    return JSON.parse(result.stdout)
  } catch {
    return { error: result.stdout.slice(0, 500) }
  }
}

async function freePort() {
  const server = createServer()
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}

async function waitFor(label, probe, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await probe()
      if (last) return last
    } catch (error) {
      last = error
    }
    await new Promise((done) => setTimeout(done, 400))
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last.message ?? JSON.stringify(last)}` : ""}`)
}

async function main() {
  console.log(`Whiteboard one-reference Git install verification\nscratch: ${base}\n`)

  // --- Disposable source remote --------------------------------------------
  await mkdir(snapshot, { recursive: true })
  await cp(root, snapshot, {
    recursive: true,
    filter: (source) => {
      const relative = source.slice(root.length + 1)
      if (!relative) return true
      if (relative === ".git" || relative === "node_modules" || relative === ".whiteboard") return false
      if (relative.startsWith(".git/") || relative.startsWith("node_modules/") || relative.startsWith(".whiteboard/")) {
        return false
      }
      return true
    },
  })
  git(["init", "-q", "-b", "main"], snapshot)
  git(["add", "-A"], snapshot)
  git(
    ["-c", "user.email=verify@example.invalid", "-c", "user.name=Whiteboard Verify", "commit", "-qm", "install snapshot"],
    snapshot,
  )
  git(["tag", "v0.2.2"], snapshot)
  git(["clone", "--bare", snapshot, remote], base)
  const commit = run("git", ["-C", remote, "rev-parse", "v0.2.2"], { cwd: base }).stdout.trim()
  ok("clean Git remote", `${remote}#v0.2.2 @ ${commit.slice(0, 12)}`)

  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, "README.md"), "# isolated OpenCode workspace\n")
  await writeFile(
    boardConfig,
    JSON.stringify(
      {
        name: "default",
        url: `http://127.0.0.1:${boardPort}`,
        storage: "user",
        dataDir: "data",
        exportDir: "exports",
        scope: "install verification board",
      },
      null,
      2,
    ) + "\n",
  )

  // --- Real one-reference install ------------------------------------------
  const spec = `git+file://${remote}#v0.2.2`
  const added = run("opencode", ["plugin", "add", spec], { timeout: 240_000 })
  if (!/installed and added/.test(added.stdout + added.stderr)) {
    fail("opencode plugin add", (added.stdout + added.stderr).slice(-800))
  }
  const globalConfig = JSON.parse(await readFile(join(configDir, "opencode", "opencode.json"), "utf8"))
  if (!globalConfig.plugins?.includes(spec)) {
    fail("global plugin entry", JSON.stringify(globalConfig.plugins))
  }
  ok("opencode plugin add", spec)

  // A local-only probe reads the effective tool catalog and invokes one MCP
  // tool. It is part of the isolated workspace, not the package.
  await mkdir(join(workspace, ".opencode", "plugins"), { recursive: true })
  await writeFile(
    join(workspace, ".opencode", "plugins", "whiteboard-probe.ts"),
    `import { Plugin } from "@opencode/plugin"
import { writeFileSync } from "node:fs"
import { Effect } from "effect"

export default Plugin.define({
  id: "whiteboard-install-probe",
  async setup(ctx) {
    const out = process.env.WB_PROBE_OUT
    if (!out) return
    let last = ""
    let called = false
    const tick = async () => {
      try {
        const tools = await ctx.tool.list()
        const text = JSON.stringify(
          tools.map((tool) => ({ id: tool.id, name: tool.name })).sort((a, b) => a.id.localeCompare(b.id)),
          null,
          2,
        )
        if (text !== last) {
          last = text
          writeFileSync(out, text)
        }
        const target = tools.find((tool) => tool.id === "whiteboard_describe_scene")
        if (target && !called) {
          called = true
          const context = {
            sessionID: "ses_install_probe",
            agent: "build",
            messageID: "msg_install_probe",
            id: "call_install_probe",
            progress: () => Effect.void,
          }
          try {
            await Effect.runPromise(target.execute({}, context))
          } catch {
            // The canvas auto-start is what this probe exercises. A result
            // encoding failure must not hide that independent evidence.
          }
        }
      } catch {}
    }
    const timer = setInterval(() => void tick(), 500)
    void tick()
    return () => clearInterval(timer)
  },
})
`,
  )

  const server = spawn("opencode", ["serve", "--port", String(servePort), "--print-logs"], {
    cwd: workspace,
    env,
    stdio: ["ignore", "ignore", "ignore"],
  })
  let serverExited = false
  let installedPackage
  server.once("exit", () => {
    serverExited = true
  })

  try {
    await waitFor(
      "private OpenCode server",
      async () => {
        if (serverExited) throw new Error("server exited before becoming ready")
        const info = api("/api/info")
        return info && !info.error && info.version ? info : undefined
      },
      60_000,
    )
    const info = api("/api/info")
    ok("private OpenCode server", `${info.version} on ${serverUrl}`)

    const mcp = await waitFor(
      "auto-registered whiteboard MCP",
      async () => {
        const body = api("/api/mcp")
        const entry = body?.data?.find((item) => item.name === "whiteboard")
        return entry?.status?.status === "connected" ? entry : undefined
      },
      120_000,
    )
    ok("MCP auto-registered and connected", `whiteboard: ${mcp.status.status}`)

    const cachePackage = await waitFor(
      "installed package in OpenCode cache",
      async () => {
        const found = findInstalledPackage()
        return found
      },
      30_000,
    )
    installedPackage = cachePackage
    const packageJson = JSON.parse(await readFile(join(cachePackage, "package.json"), "utf8"))
    if (packageJson.version !== "0.2.2") fail("installed package version", packageJson.version)
    if (packageJson.exports?.["."] !== "./src/index.ts") {
      fail("installed package server export", JSON.stringify(packageJson.exports))
    }
    if (packageJson.exports?.["./gui-experimental"] !== "./dist/gui-experimental.cjs") {
      fail("installed package GUI export", JSON.stringify(packageJson.exports))
    }
    const guiBundle = join(cachePackage, "dist", "gui-experimental.cjs")
    const bundle = await readFile(guiBundle, "utf8")
    for (const required of [
      'require("electron")',
      'require("@opencode/plugin/gui")',
      'require("solid-js")',
      "ELECTRON_RUN_AS_NODE",
      "toggle-board-panel",
      "opencode-whiteboard",
    ]) {
      if (!bundle.includes(required)) fail("installed GUI bundle", `missing ${required}`)
    }
    for (const token of ["__dirname", "__filename"]) {
      if (bundle.includes(token)) fail("installed GUI bundle", `references ${token}`)
    }
    for (const required of [
      join(cachePackage, "src", "index.ts"),
      join(cachePackage, "bin", "lib", "backend.mjs"),
      join(cachePackage, ".opencode", "skills", "whiteboard", "SKILL.md"),
    ]) {
      if (!existsSync(required)) fail("installed package files", `missing ${required}`)
    }
    const mcpEntry = join(dirname(cachePackage), "mcp-excalidraw-server", "dist", "index.js")
    if (!existsSync(mcpEntry)) fail("installed dependencies", `missing ${mcpEntry}`)
    ok("package cache contents", `${packageJson.name}@${packageJson.version}, GUI + MCP + skill`)

    // Desktop's main process asks the ESM server part for its package root;
    // the bundle itself has no __dirname/import.meta.url. Exercise the real
    // RPC over the private server, against the installed cache path.
    const rpcPaths = api("/api/rpc/opencode-whiteboard/paths", {
      method: "post",
      args: ["--data", '{"input":{}}'],
    })
    if (rpcPaths.error || rpcPaths.output?.root !== cachePackage) {
      fail("installed Desktop path handoff RPC", JSON.stringify(rpcPaths))
    }
    if (rpcPaths.output?.configPath !== boardConfig) {
      fail("installed Desktop config handoff", JSON.stringify(rpcPaths.output))
    }
    ok("installed Desktop path handoff RPC", `${rpcPaths.output.root} -> ${rpcPaths.output.configPath}`)

    const skills = await waitFor(
      "embedded whiteboard skill",
      async () => {
        const body = api("/api/skill")
        return body?.data?.some((skill) => skill.id === "whiteboard") ? body.data : undefined
      },
      30_000,
    )
    const whiteboardSkill = skills.find((skill) => skill.id === "whiteboard")
    if (!whiteboardSkill.content.includes("describe_scene")) fail("embedded skill content", whiteboardSkill.id)
    ok("embedded skill registered", whiteboardSkill.id)

    const tools = await waitFor(
      "effective tool catalog",
      async () => {
        if (!existsSync(toolsFile)) return undefined
        const parsed = JSON.parse(await readFile(toolsFile, "utf8"))
        return parsed.some((tool) => tool.id.startsWith("whiteboard_")) ? parsed : undefined
      },
      60_000,
    )
    const whiteboardTools = tools.filter((tool) => tool.id.startsWith("whiteboard_"))
    if (whiteboardTools.length !== 26) {
      fail("effective MCP tool surface", `expected 26 tools, got ${whiteboardTools.length}`)
    }
    if (whiteboardTools.some((tool) => /export_to_excalidraw_url/.test(tool.id))) {
      fail("upload tool removed", whiteboardTools.map((tool) => tool.id).join(", "))
    }
    ok("privacy", `${whiteboardTools.length} whiteboard tools, upload tool absent`)

    await waitFor(
      "MCP canvas auto-start in user-level store",
      async () => (existsSync(join(boardHome, "data")) ? true : undefined),
      60_000,
    )
    if (!existsSync(join(boardHome, "data"))) fail("shared board data", "data dir not created")
    if (existsSync(join(cachePackage, ".whiteboard"))) {
      fail("shared board data", "durable state was written inside the package cache")
    }
    const lockFiles = await stat(join(boardHome, "data"))
    if (!lockFiles.isDirectory()) fail("shared board data", "data path is not a directory")
    ok("shared durable store outside cache", join(boardHome, "data"))

    const status = api(`/api/mcp`)
    if (!status?.data?.some((item) => item.name === "whiteboard" && item.status?.status === "connected")) {
      fail("MCP remains connected", JSON.stringify(status))
    }
    ok("installed package exports/commands", "server entry, GUI bundle, and MCP entry resolved from cache")

    // Pinned tags are exact references: the documented upgrade is remove the
    // old reference, then add the new one. Prove that syntax with the real CLI
    // and that the user-level board store survives it.
    const sentinel = join(boardHome, "data", "upgrade-preserved.json")
    await writeFile(sentinel, JSON.stringify({ preserved: true }) + "\n")
    const removed = run("opencode", ["plugin", "remove", spec])
    if (!/removed from/.test(removed.stdout + removed.stderr)) {
      fail("opencode plugin remove", (removed.stdout + removed.stderr).slice(-800))
    }
    const afterRemove = JSON.parse(await readFile(join(configDir, "opencode", "opencode.json"), "utf8"))
    if ((afterRemove.plugins ?? []).includes(spec)) {
      fail("opencode plugin remove", JSON.stringify(afterRemove.plugins))
    }
    const readded = run("opencode", ["plugin", "add", spec], { timeout: 240_000 })
    if (!/installed and added/.test(readded.stdout + readded.stderr)) {
      fail("opencode plugin add after remove", (readded.stdout + readded.stderr).slice(-800))
    }
    const afterAdd = JSON.parse(await readFile(join(configDir, "opencode", "opencode.json"), "utf8"))
    const entries = (afterAdd.plugins ?? []).filter((entry) => entry === spec)
    if (entries.length !== 1) fail("single pinned plugin entry", JSON.stringify(afterAdd.plugins))
    if (!existsSync(sentinel)) fail("upgrade preserves board data", "user-level sentinel disappeared")
    ok("remove/add upgrade syntax", "one pinned entry; user-level board data preserved")

    console.log(`\n${checks.filter((check) => check.status === "pass").length} passed, 0 failed`)
  } finally {
    if (!serverExited) server.kill("SIGTERM")
    await new Promise((done) => setTimeout(done, 800))
    // Stop only the isolated canvas on the test port.
    const cleanupPackage = installedPackage ?? findInstalledPackage()
    if (cleanupPackage) {
      run(
        process.execPath,
        [join(cleanupPackage, "bin", "whiteboard.mjs"), "stop"],
        { allowFailure: true, timeout: 20_000 },
      )
    }
    if (!keep) await rm(base, { recursive: true, force: true })
    else console.log(`kept scratch: ${base}`)
  }
}

function findInstalledPackage() {
  const npmRoot = join(cacheDir, "opencode", "npm")
  if (!existsSync(npmRoot)) return undefined
  const stack = [npmRoot]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry)
      if (entry === "opencode-whiteboard" && existsSync(join(full, "package.json"))) return full
      if (entry === "node_modules" || entry.startsWith("git-remote-") || /^\d+$/.test(entry)) {
        stack.push(full)
      }
    }
  }
  return undefined
}

main().catch((error) => {
  console.error(`\nFAIL  ${error.message}`)
  process.exitCode = 1
})
