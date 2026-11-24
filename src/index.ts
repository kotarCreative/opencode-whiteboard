import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin, Skill } from "@opencode/plugin"
import {
  loadBoardConfig,
  MCP_NAME,
  resolveNodeCommand,
  UPLOAD_TOOL,
} from "../bin/lib/backend.mjs"
import { WhiteboardPaths } from "./rpc"

// The server part runs from either a checkout (src/index.ts) or a package
// installed by `opencode plugin add`. Both resolve the package root the same
// way; OpenCode's runtime keeps the source path for Git packages.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function optionString(options: { readonly [key: string]: unknown }, key: string) {
  const value = options[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One-reference install:
 *
 *   opencode plugin add github:kotarCreative/opencode-whiteboard#v0.2.1
 *
 * The server part registers the canvas MCP server itself, so the user does not
 * hand-edit `mcp.servers`. It also hides upstream's upload-to-excalidraw.com
 * tool from the model surface and contributes the pull-only skill.
 */
export default Plugin.define({
  id: "opencode-whiteboard",
  async setup(ctx) {
    const rootOption = optionString(ctx.options, "projectRoot")
    const projectRoot = rootOption ? resolve(packageRoot, rootOption) : packageRoot
    const configOption = optionString(ctx.options, "configPath")
    const configPath = configOption ? resolve(projectRoot, configOption) : undefined

    let board
    try {
      board = loadBoardConfig({ root: projectRoot, configPath, env: process.env })
    } catch (error) {
      // Let OpenCode mark this plugin failed instead of silently running with
      // no MCP server. The message names the package-relative fix.
      console.error(`[opencode-whiteboard] configuration failed: ${messageOf(error)}`)
      throw error
    }

    // The Desktop GUI bundle is CommonJS evaluated without __dirname or
    // import.meta.url. This ESM half owns that path resolution and hands the
    // result to the main process through the official plugin RPC bridge.
    await ctx.rpc.register(WhiteboardPaths, {
      paths: async () => ({ root: projectRoot, configPath: board.configPath }),
    })

    if (ctx.options.mcp !== false) {
      const command = [resolveNodeCommand(process.env), board.mcpEntry]
      await ctx.mcp.transform((editor) => {
        editor.set(MCP_NAME, {
          type: "local",
          command,
          // Relative tool paths (for example export_scene) should land in the
          // workspace, not the plugin cache.
          cwd: ctx.location.directory,
          environment: {
            EXPRESS_SERVER_URL: board.base,
            EXCALIDRAW_DATA_DIR: board.dataDir,
            EXCALIDRAW_EXPORT_DIR: board.exportDir,
            ENABLE_CANVAS_SYNC: "true",
            LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
          },
        })
      })
    }

    // Upstream's only network-upload tool is removed from the exposed tool
    // surface. This persists across MCP catalog refreshes. A project config can
    // still add a permission deny rule as defense in depth.
    if (ctx.options.allowUpload !== true) {
      await ctx.tool.transform((editor) => {
        editor.remove(`${MCP_NAME}_${UPLOAD_TOOL}`)
        editor.remove(UPLOAD_TOOL)
      })
    }

    if (ctx.options.skill !== false) {
      try {
        const skillPath = join(projectRoot, ".opencode", "skills", "whiteboard", "SKILL.md")
        const content = readFileSync(skillPath, "utf8")
        await ctx.skill.transform((editor) => {
          // A checkout already discovers .opencode/skills/whiteboard itself.
          // Only add the embedded copy when the project does not provide one.
          if (editor.get("whiteboard")) return
          editor.add({
            id: Skill.ID.make("whiteboard"),
            name: Skill.Name.make("whiteboard"),
            description:
              "Pull and edit the local OpenCode whiteboard (Excalidraw) with the whiteboard_* MCP tools.",
            autoinvoke: false,
            path: Skill.Info.fields.path.make(skillPath),
            content,
          })
        })
      } catch (error) {
        console.warn(`[opencode-whiteboard] skill registration skipped: ${messageOf(error)}`)
      }
    }
  },
})
