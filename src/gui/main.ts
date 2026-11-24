import { WebContentsView } from "electron"
import type { Embed } from "@opencode/plugin/gui/main"
import type { Plugin } from "@opencode/plugin/gui"
import { createBackend, type Backend } from "../../bin/lib/backend.mjs"
import { WhiteboardEmbed, WhiteboardPaths } from "./contract"

type Entry = {
  view: WebContentsView
  embed: Embed
  origin: string
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
  const fallbackUrl = (optionString(ctx.options, "boardUrl") ?? "http://127.0.0.1:4317").replace(
    /\/+$/,
    "",
  )
  const configured = optionString(ctx.options, "boardUrl")?.replace(/\/+$/, "")
  const entries = new Map<number, Entry>()
  let backendPromise: Promise<Backend> | undefined

  // OpenCode evaluates this bundle as CommonJS text with only `require`,
  // `module`, and `exports`: there is no __dirname, __filename, or
  // import.meta.url to locate the package. The server part resolves its own
  // ESM root and returns it over RPC. Read `ctx.client` at call time because
  // it changes after the server restarts.
  const backend = () => {
    if (!backendPromise) {
      backendPromise = (async () => {
        // JSON Schema RPC output is unknown at the type level.
        const paths = (await ctx.client.rpc(WhiteboardPaths).paths({})) as {
          root?: unknown
          configPath?: unknown
        }
        if (typeof paths.root !== "string" || paths.root.length === 0) {
          throw new Error("Whiteboard server did not report its package root.")
        }
        if (paths.configPath !== undefined && typeof paths.configPath !== "string") {
          throw new Error("Whiteboard server reported an invalid config path.")
        }

        const created = createBackend({
          root: paths.root,
          configPath: paths.configPath || undefined,
          env: process.env,
          // In Electron, process.execPath is the app binary. ELECTRON_RUN_AS_NODE
          // makes the spawned canvas a plain Node process.
          nodePath: process.env.WHITEBOARD_NODE || process.execPath,
          spawnEnv: process.versions["electron"] ? { ELECTRON_RUN_AS_NODE: "1" } : undefined,
          log: (level, message, data) => ctx.log.write(level, message, data),
        })

        const resolved = created.config.url.replace(/\/+$/, "")
        if (configured && configured !== resolved) {
          ctx.log.write("warn", "whiteboard boardUrl option does not match whiteboard.config.json", {
            option: configured,
            config: resolved,
          })
        }

        return created
      })()

      // Let Retry resolve paths again after a failed RPC or a server restart.
      void backendPromise.catch(() => {
        backendPromise = undefined
      })
    }
    return backendPromise
  }

  const ensure = async (): Promise<Ensure> => {
    try {
      const created = await backend()
      const result = await created.ensure()
      return {
        ok: true,
        started: !result.alreadyRunning,
        url: created.config.url.replace(/\/+$/, ""),
        error: null,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.log.write("warn", "whiteboard backend cold start failed", {
        error: message,
        url: fallbackUrl,
      })
      return { ok: false, started: false, url: fallbackUrl, error: message }
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
      if (!window) return { id: null, url: fallbackUrl, error: "Desktop window not found." }

      // Cold start (or reuse) the one shared, validated backend. A failure is
      // returned to the panel, which keeps its Retry action; the next call
      // starts a fresh attempt.
      const started = await ensure()
      if (!started.ok) return { id: null, url: started.url, error: started.error }
      if (caller.signal.aborted) return { id: null, url: started.url, error: "Cancelled." }

      const origin = originOf(started.url)
      let entry = entries.get(caller.window)
      if (entry && (entry.view.webContents.isDestroyed() || entry.origin !== origin)) {
        dispose(caller.window)
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
        entry = { view, embed, origin }
        entries.set(caller.window, entry)

        try {
          await view.webContents.loadURL(started.url)
        } catch (error) {
          dispose(caller.window)
          return {
            id: null,
            url: started.url,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }

      entry.embed.show(true)
      return { id: entry.embed.id, url: started.url, error: null }
    },
  })
}
