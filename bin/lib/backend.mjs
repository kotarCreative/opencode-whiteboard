// Shared local-backend lifecycle for the whiteboard.
//
// Both entry points use this module:
//   - bin/whiteboard.mjs (CLI, scripts, manual operation)
//   - src/gui/main.ts (OpenCode Desktop main process, cold start/retry)
//   - src/index.ts (OpenCode server plugin, MCP auto-registration)
//
// It never downloads anything, never binds off loopback, and never touches a
// process that does not identify itself as the pinned canvas service.
//
// Startup is single-flight in two layers:
//   - one promise per process (createBackend instance);
//   - an exclusive lock file under the board state directory for concurrent
//     processes.

import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

export const SERVICE_ID = "mcp-excalidraw-canvas"
export const MCP_NAME = "whiteboard"
export const UPLOAD_TOOL = "export_to_excalidraw_url"
export const DATA_HOME_ENV = "WHITEBOARD_HOME"
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function assertLoopback(target) {
  if (!LOOPBACK_HOSTS.has(target.hostname)) {
    throw new Error(`Refusing non-loopback board URL: ${target.href}`)
  }
}

function portOf(target) {
  return Number(target.port || (target.protocol === "https:" ? 443 : 80))
}

function homeOf(env) {
  return env.HOME || env.USERPROFILE || homedir()
}

function expandHome(value, env) {
  const home = homeOf(env)
  if (value === "~") return home
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(home, value.slice(2))
  return value
}

function resolvePath(base, value, env) {
  return resolve(base, expandHome(String(value), env))
}

/**
 * Stable user-level root for the one shared local board. It deliberately lives
 * outside package caches (npm/Git plugin installs) so updates cannot delete
 * board state. Override with WHITEBOARD_HOME for isolation or testing.
 */
export function defaultDataRoot(env = process.env, platform = process.platform) {
  const configured = env[DATA_HOME_ENV]?.trim()
  if (configured) return resolve(expandHome(configured, env))
  const home = homeOf(env)
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || join(home, "AppData", "Local")
    return join(base, "opencode-whiteboard")
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "opencode-whiteboard")
  }
  const base = env.XDG_DATA_HOME || join(home, ".local", "share")
  return join(base, "opencode-whiteboard")
}

/**
 * Picks the binary used to run the MCP and canvas JS entry points. The
 * OpenCode server may itself be a compiled binary, so process.execPath is not
 * always Node. WHITEBOARD_NODE overrides everything.
 */
export function resolveNodeCommand(env = process.env, execPath = process.execPath) {
  const configured = env.WHITEBOARD_NODE?.trim()
  if (configured) return configured
  const name = basename(execPath).toLowerCase()
  if (name === "node" || name === "node.exe") return execPath
  return "node"
}

function packageRequire(root) {
  return createRequire(join(root, "package.json"))
}

function resolvePackageEntry(root, specifier, fallbackRelative, label) {
  const require = packageRequire(root)
  try {
    return require.resolve(specifier)
  } catch {
    // Older/newer layouts may not expose the subpath; resolve the package and
    // look beside its main entry.
    try {
      const main = require.resolve("mcp-excalidraw-server")
      const entry = join(dirname(main), fallbackRelative)
      if (existsSync(entry)) return entry
    } catch {
      // Fall through to the actionable error below.
    }
    throw new Error(`Pinned upstream is missing the ${label}. Run "npm ci --ignore-scripts" in ${root}.`)
  }
}

export function resolveServerEntry(root, explicit) {
  if (explicit) {
    const entry = resolve(root, explicit)
    if (!existsSync(entry)) throw new Error(`Configured canvas server entry is missing: ${entry}`)
    return entry
  }
  return resolvePackageEntry(
    root,
    "mcp-excalidraw-server/dist/server.js",
    "server.js",
    "canvas server entry",
  )
}

export function resolveMcpEntry(root, explicit) {
  if (explicit) {
    const entry = resolve(root, explicit)
    if (!existsSync(entry)) throw new Error(`Configured MCP entry is missing: ${entry}`)
    return entry
  }
  return resolvePackageEntry(root, "mcp-excalidraw-server/dist/index.js", "index.js", "MCP entry")
}

function readUpstream(root) {
  const require = packageRequire(root)
  const packagePath = require.resolve("mcp-excalidraw-server/package.json")
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"))
  return { package: pkg.name, version: pkg.version, license: pkg.license }
}

/**
 * Reads whiteboard.config.json once and resolves every path both the MCP
 * process and the lifecycle wrapper must agree on.
 *
 * storage: "user" (the packaged default) keeps the one shared board in a
 * stable data root outside the package cache. storage: "project" keeps test
 * and bespoke configs self-contained beside their config file.
 *
 * @param {{
 *   root: string,
 *   configPath?: string,
 *   env?: Record<string, string | undefined>,
 *   serverEntry?: string,
 *   mcpEntry?: string,
 * }} options
 */
export function loadBoardConfig(options) {
  const root = resolve(options.root)
  const env = options.env ?? process.env
  const configured = options.configPath ?? env.WHITEBOARD_CONFIG
  const configPath = configured
    ? resolve(root, expandHome(String(configured), env))
    : join(root, "whiteboard.config.json")
  const configDir = dirname(configPath)
  const config = JSON.parse(readFileSync(configPath, "utf8"))
  const url = new URL(config.url)
  assertLoopback(url)

  const storage = config.storage === "user" ? "user" : "project"
  const dataRoot =
    storage === "user"
      ? config.dataRoot
        ? resolvePath(defaultDataRoot(env), config.dataRoot, env)
        : defaultDataRoot(env)
      : configDir
  const dataDir = resolvePath(dataRoot, config.dataDir ?? "data", env)
  const exportDir = resolvePath(dataRoot, config.exportDir ?? "exports", env)
  const stateDir = resolvePath(dataRoot, config.stateDir ?? (storage === "user" ? "state" : ".whiteboard"), env)
  const base = url.href.replace(/\/$/, "")

  return {
    root,
    config,
    configPath,
    configDir,
    storage,
    dataRoot,
    dataDir,
    exportDir,
    stateDir,
    base,
    url,
    port: portOf(url),
    manifestPath: join(stateDir, "board.json"),
    lockPath: join(stateDir, "board.lock"),
    logFile: join(stateDir, "board.log"),
    serverEntry: resolveServerEntry(root, options.serverEntry),
    mcpEntry: resolveMcpEntry(root, options.mcpEntry),
    upstream: readUpstream(root),
  }
}

/**
 * Creates a lifecycle handle for one board. Configuration is read once.
 *
 * @param {{
 *   root: string,
 *   configPath?: string,
 *   env?: Record<string, string | undefined>,
 *   nodePath?: string,
 *   spawnEnv?: Record<string, string | undefined>,
 *   serverEntry?: string,
 *   mcpEntry?: string,
 *   log?: (level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>) => void,
 * }} options
 */
export function createBackend(options) {
  const paths = loadBoardConfig(options)
  const root = paths.root
  const env = options.env ?? process.env
  const config = paths.config
  const configDir = paths.configDir
  const url = paths.url
  const base = paths.base
  const dataDir = paths.dataDir
  const exportDir = paths.exportDir
  const stateDir = paths.stateDir
  const manifestPath = paths.manifestPath
  const lockPath = paths.lockPath
  const logFile = paths.logFile
  const serverEntry = paths.serverEntry
  const upstream = paths.upstream
  const nodePath = options.nodePath ?? process.execPath
  const spawnEnv = options.spawnEnv ?? {}
  const log = options.log ?? (() => {})

  /** @type {Promise<{ alreadyRunning: boolean, manifest: Record<string, unknown>, health: Record<string, unknown> }> | null} */
  let inflight = null

  const boardInfo = (extra = {}) => ({
    boardId: config.name,
    boardName: config.name,
    scope: config.scope,
    storage: paths.storage,
    projectRoot: configDir,
    dataRoot: paths.dataRoot,
    url: base,
    dataDir,
    exportDir,
    logFile,
    upstream,
    ...extra,
  })

  async function health(timeoutMs = 1200) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(new URL("/health", url), {
        signal: controller.signal,
        headers: { accept: "application/json" },
      })
      if (!response.ok) {
        return { ok: false, code: "http", reason: `HTTP ${response.status} from ${base}` }
      }
      let body
      try {
        body = await response.json()
      } catch {
        return {
          ok: false,
          code: "foreign",
          reason: `Port ${paths.port} answered with a non-canvas response; refusing to reuse it.`,
        }
      }
      if (body?.service !== SERVICE_ID) {
        return {
          ok: false,
          code: "foreign",
          reason: `Port ${paths.port} is occupied by a different service; refusing to reuse it.`,
          body,
        }
      }
      return { ok: true, body }
    } catch (error) {
      return { ok: false, code: "unreachable", reason: messageOf(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  async function readManifest() {
    if (!existsSync(manifestPath)) return boardInfo()
    try {
      return JSON.parse(await readFile(manifestPath, "utf8"))
    } catch {
      return boardInfo()
    }
  }

  async function writeManifest(startedAt, pid) {
    await mkdir(stateDir, { recursive: true })
    const previous = await readManifest()
    const manifest = boardInfo({
      createdAt: previous.createdAt ?? new Date().toISOString(),
      lastStartedAt: startedAt,
      pid: Number.isSafeInteger(pid) && pid > 0 ? pid : (previous.pid ?? null),
    })
    const temporary = `${manifestPath}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n")
    await rename(temporary, manifestPath)
    return manifest
  }

  function pidAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error?.code === "EPERM"
    }
  }

  async function staleLock() {
    let owner
    try {
      owner = JSON.parse(await readFile(lockPath, "utf8"))
    } catch {
      // A lock without readable owner data is stale once it is old enough to
      // rule out an in-flight write by the owner.
      try {
        const info = await stat(lockPath)
        return Date.now() - info.mtimeMs > 30_000
      } catch {
        return true
      }
    }
    if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) {
      try {
        const info = await stat(lockPath)
        return Date.now() - info.mtimeMs > 30_000
      } catch {
        return true
      }
    }
    return !pidAlive(owner.pid)
  }

  async function acquireLock(timeoutMs = 25_000) {
    await mkdir(stateDir, { recursive: true })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const handle = await open(lockPath, "wx")
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), url: base }) + "\n",
        )
        await handle.close()
        return async () => {
          try {
            const owner = JSON.parse(await readFile(lockPath, "utf8"))
            if (owner?.pid === process.pid) await unlink(lockPath)
          } catch {
            // Already gone or unreadable; nothing to release.
          }
        }
      } catch (error) {
        if (error?.code !== "EEXIST") throw error
        if (await staleLock()) {
          try {
            await unlink(lockPath)
          } catch {
            // Another process cleaned it up first.
          }
          continue
        }
        await sleep(120)
      }
    }
    throw new Error(
      `Another whiteboard start is still in progress (${lockPath}). Retry shortly or inspect the lock owner.`,
    )
  }

  async function waitForHealth(deadlineMs = 15_000, child) {
    const deadline = Date.now() + deadlineMs
    let last = await health(800)
    while (!last.ok && Date.now() < deadline) {
      if (last.code === "foreign") return last
      if (child && child.exitCode !== null) {
        return { ...last, reason: `canvas exited with code ${child.exitCode}` }
      }
      await sleep(200)
      last = await health(800)
    }
    return last
  }

  async function logTail(bytes = 2000) {
    try {
      const text = await readFile(logFile, "utf8")
      return text.slice(-bytes).trim()
    } catch {
      return ""
    }
  }

  async function spawnCanvas() {
    const childEnv = {
      ...env,
      ...spawnEnv,
      PORT: String(paths.port),
      HOST: url.hostname.replace(/^\[|\]$/g, ""),
      EXPRESS_SERVER_URL: base,
      EXCALIDRAW_DATA_DIR: dataDir,
      EXCALIDRAW_EXPORT_DIR: exportDir,
      LOG_LEVEL: env.LOG_LEVEL ?? "warn",
    }
    const handle = await open(logFile, "a")
    let child
    let spawned
    try {
      child = spawn(nodePath, [serverEntry], {
        cwd: configDir,
        env: childEnv,
        detached: true,
        stdio: ["ignore", handle.fd, handle.fd],
      })
      // Attach before any await: a child that exits immediately can emit
      // "spawn" and "exit" while the log handle is closing.
      spawned = new Promise((done, reject) => {
        child.once("spawn", done)
        child.once("error", reject)
      })
    } finally {
      await handle.close()
    }

    await spawned
    child.on("error", (error) => {
      log("warn", "whiteboard canvas process error", { error: messageOf(error) })
    })
    child.unref()
    log("info", "whiteboard canvas spawned", {
      pid: child.pid,
      url: base,
      logFile,
      dataDir,
    })
    return child
  }

  async function startLocked() {
    await mkdir(dataDir, { recursive: true })
    await mkdir(exportDir, { recursive: true })

    // Re-check after taking the lock: another process may have just finished.
    const existing = await health()
    if (existing.ok) {
      const pid = existing.body?.pid
      const manifest = await writeManifest(new Date().toISOString(), pid)
      return { alreadyRunning: true, manifest, health: existing.body }
    }
    if (existing.code === "foreign" || existing.code === "http") {
      throw new Error(
        existing.code === "foreign"
          ? existing.reason
          : `Port ${paths.port} is occupied (${existing.reason}); refusing to reuse it.`,
      )
    }

    let child
    try {
      child = await spawnCanvas()
    } catch (error) {
      throw new Error(`Could not start the canvas (${nodePath} ${serverEntry}): ${messageOf(error)}`)
    }

    const check = await waitForHealth(15_000, child)
    if (!check.ok) {
      // Another process (for example the MCP bridge's own auto-start) may have
      // won the race while this child exited. Reuse the healthy winner instead
      // of reporting a failure.
      const winner = await waitForHealth(2_000)
      if (winner.ok) {
        const pid = winner.body?.pid ?? null
        const manifest = await writeManifest(new Date().toISOString(), pid)
        return { alreadyRunning: true, manifest, health: winner.body }
      }

      // Only signal the process this invocation spawned. If it exited on its
      // own (for example EADDRINUSE), there is nothing to clean up.
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(child.pid, "SIGTERM")
        } catch {
          // Already gone.
        }
      }
      const tail = await logTail()
      throw new Error(
        `Canvas did not become healthy at ${base}: ${check.reason}` +
          (tail ? `\nLog (${logFile}):\n${tail}` : `\nSee ${logFile}`),
      )
    }

    const pid = check.body?.pid ?? child.pid
    const manifest = await writeManifest(new Date().toISOString(), pid)
    return { alreadyRunning: false, manifest, health: check.body }
  }

  async function ensure() {
    if (inflight) return inflight
    inflight = (async () => {
      const release = await acquireLock()
      try {
        return await startLocked()
      } finally {
        await release()
      }
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  async function status() {
    const check = await health()
    const manifest = await readManifest()
    let sync = null
    if (check.ok) {
      try {
        const response = await fetch(new URL("/api/sync/status", url), {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(1500),
        })
        if (response.ok) sync = await response.json()
      } catch {
        sync = null
      }
    }
    return {
      ...manifest,
      running: check.ok,
      health: check.ok ? check.body : { error: check.reason },
      sync,
    }
  }

  async function stop() {
    const check = await health(1500)
    if (!check.ok) {
      return { ...boardInfo(), stopped: false, message: "Board is not running." }
    }
    const pid = check.body?.pid
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error("Healthy canvas did not report a valid pid; refusing to signal anything.")
    }
    try {
      process.kill(pid, "SIGTERM")
    } catch (error) {
      if (error?.code !== "ESRCH") throw error
      return { ...boardInfo(), stopped: true, pid }
    }
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (!(await health(300)).ok) {
        return { ...boardInfo(), stopped: true, pid }
      }
      await sleep(200)
    }
    throw new Error(`Canvas (pid ${pid}) did not stop within 5s.`)
  }

  async function info() {
    const manifest = await readManifest()
    const check = await health()
    return {
      ...manifest,
      running: check.ok,
      health: check.ok ? check.body : { error: check.reason },
    }
  }

  return {
    boardInfo,
    config,
    configPath: paths.configPath,
    paths,
    serverEntry,
    mcpEntry: paths.mcpEntry,
    health,
    ensure,
    status,
    stop,
    info,
    manifestPath,
    logFile,
  }
}
