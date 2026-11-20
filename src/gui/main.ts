import { resolve } from "node:path"
import { WebContentsView } from "electron"
import type { Embed } from "@opencode/plugin/gui/main"
import type { Plugin } from "@opencode/plugin/gui"
import { createBackend, type Backend } from "../../bin/lib/backend.mjs"
import { WhiteboardEmbed } from "./contract"

type Entry = {
  view: WebContentsView
  embed: Embed
}

type Ensure = {
  ok: boolean
  started: boolean
  url: string
  error: string | null
}

function originOf(url: string) {
  try {
    return new URL(url).origin
  } catch {
    return ""
  }
}

function optionString(options: { readonly [key: string]: unknown }, key: string) {
  const value = options[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export const main: Plugin.MainSetup = (ctx) => {
  // The GUI bundle lives at <package>/dist/gui-experimental.cjs. For a Git or
  // npm install this is the package cache root; `projectRoot`, `configPath`,
  // or WHITEBOARD_CONFIG can point it at a workspace-owned board. Relative
  // options resolve from the package root, not Desktop's working directory.
  const packageRoot = resolve(__dirname, "..")
  const rootOption = optionString(ctx.options, "projectRoot")
  const projectRoot = rootOption ? resolve(packageRoot, rootOption) : packageRoot
  const configOption = optionString(ctx.options, "configPath")
  const configPath = configOption ? resolve(projectRoot, configOption) : undefined

  let backend: Backend | undefined
  let initError: string | null = null
  try {
    backend = createBackend({
      root: projectRoot,
      configPath,
      env: process.env,
      // In Electron, process.execPath is the app binary. ELECTRON_RUN_AS_NODE
      // makes the spawned canvas a plain Node process.
      nodePath: process.env.WHITEBOARD_NODE || process.execPath,
      spawnEnv: process.versions["electron"] ? { ELECTRON_RUN_AS_NODE: "1" } : undefined,
      log: (level, message, data) => ctx.log.write(level, message, data),
    })
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error)
    ctx.log.write("error", "whiteboard backend configuration failed", {
      error: initError,
      projectRoot,
      configPath,
    })
  }

  const fallbackUrl = (optionString(ctx.options, "boardUrl") ?? "http://127.0.0.1:4317").replace(
    /\/+$/,
    "",
  )
  const url = (backend?.config.url ?? fallbackUrl).replace(/\/+$/, "")
  const origin = originOf(url)
  const entries = new Map<number, Entry>()

  const configured = optionString(ctx.options, "boardUrl")?.replace(/\/+$/, "")
  if (backend && configured && configured !== url) {
    ctx.log.write("warn", "whiteboard boardUrl option does not match whiteboard.config.json", {
      option: configured,
      config: url,
    })
  }

  const ensure = async (): Promise<Ensure> => {
    if (!backend) {
      return { ok: false, started: false, url, error: initError ?? "Whiteboard backend is not configured." }
    }
    try {
      const result = await backend.ensure()
      return { ok: true, started: !result.alreadyRunning, url, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.log.write("warn", "whiteboard backend cold start failed", { error: message, url })
      return { ok: false, started: false, url, error: message }
    }
  }

  const dispose = (windowId: number) => {
    const entry = entries.get(windowId)
    if (!entry) return
    entries.delete(windowId)
    entry.embed.dispose()
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }

  ctx.windows.on("close", (window) => dispose(window.id))
  ctx.onCleanup(() => {
    for (const windowId of [...entries.keys()]) dispose(windowId)
  })

  ctx.provide(WhiteboardEmbed, {
    ensure,

    async acquire(_input, caller) {
      const window = ctx.windows.get(caller.window)
      if (!window) return { id: null, url, error: "Desktop window not found." }

      // Cold start (or reuse) the one shared, validated backend. A failure is
      // returned to the panel, which keeps its Retry action; the next call
      // starts a fresh attempt.
      const started = await ensure()
      if (!started.ok) return { id: null, url, error: started.error }
      if (caller.signal.aborted) return { id: null, url, error: "Cancelled." }

      let entry = entries.get(caller.window)
      if (entry && entry.view.webContents.isDestroyed()) {
        entries.delete(caller.window)
        entry = undefined
      }

      if (!entry) {
        const view = new WebContentsView({
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        })
        view.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
        view.webContents.on("will-navigate", (event, target) => {
          if (originOf(target) !== origin) event.preventDefault()
        })

        const embed = ctx.embeds.create(view, window)
        entry = { view, embed }
        entries.set(caller.window, entry)

        try {
          await view.webContents.loadURL(url)
        } catch (error) {
          dispose(caller.window)
          return {
            id: null,
            url,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }

      entry.embed.show(true)
      return { id: entry.embed.id, url, error: null }
    },
  })
}
