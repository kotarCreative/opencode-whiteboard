#!/usr/bin/env node
// Regression check for the Desktop panel's embed box.
//
// The host SDK's `ctx.embeds.View` renders a plain <div>: whatever class the plugin puts on it
// determines the measured box, and the host hides a native view whose box has zero width or
// height. v0.2.1 passed no class, so the canvas page loaded with a 0x0 viewport and the panel
// showed only its header. This renders the real BoardView with Solid in headless Chromium and
// asserts the view box actually fills the panel at a normal and a narrow width.

import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { readFile, rm } from "node:fs/promises"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "vite"
import solid from "vite-plugin-solid"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const fixture = resolve(scriptDir, "embed-layout")
const outDir = resolve(scriptDir, "..", ".whiteboard", "test-embed-layout")

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
}

function chromium() {
  const found = spawnSync("sh", ["-c", "command -v chromium || command -v chromium-browser"], {
    encoding: "utf8",
  })
  return found.status === 0 ? found.stdout.trim() : ""
}

// Async so the fixture's HTTP server keeps answering while Chromium loads it. spawnSync would
// block this process's event loop and the page could never finish loading.
function runBrowser(browser, args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(browser, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout)

    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (status, signal) => {
      clearTimeout(timer)
      resolve({ status, signal, stdout, stderr })
    })
  })
}

async function serve(directory) {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname)
    const file = join(directory, pathname === "/" ? "index.html" : pathname)

    if (!file.startsWith(directory + "/")) {
      response.writeHead(403).end()
      return
    }

    try {
      const body = await readFile(file)
      response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })

  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  const address = server.address()
  const origin = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : ""
  return { server, origin }
}

/** @returns {Promise<{ status: "pass" | "skip", detail: string }>} */
export async function verifyEmbedLayout() {
  const browser = chromium()
  if (!browser) return { status: "skip", detail: "chromium not installed" }

  await rm(outDir, { recursive: true, force: true })
  await build({
    root: fixture,
    base: "./",
    configFile: false,
    logLevel: "error",
    plugins: [solid()],
    resolve: {
      alias: { "@opencode/plugin/gui": join(fixture, "gui-stub.ts") },
    },
    build: { outDir, emptyOutDir: true },
  })

  const { server, origin } = await serve(outDir)
  try {
    const measured = []
    for (const width of [640, 390]) {
      const run = await runBrowser(browser, [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=1000,900",
        "--virtual-time-budget=5000",
        "--dump-dom",
        `${origin}/?width=${width}&height=800`,
      ])
      const dom = run.stdout ?? ""
      const height = Number(dom.match(/data-embed-height="([\d.]+)"/)?.[1] ?? -1)
      const boxWidth = Number(dom.match(/data-embed-width="([\d.]+)"/)?.[1] ?? -1)
      const className = dom.match(/data-embed-class="([^"]*)"/)?.[1] ?? ""
      const ready = dom.includes('data-ready="yes"')

      if (!ready) {
        throw new Error(
          `BoardView did not reach its ready state at ${width}px (status ${run.status}, stdout ${dom.length} bytes): ${run.stderr.slice(-400)}`,
        )
      }
      if (height <= 0 || Math.abs(boxWidth - width) > 1) {
        throw new Error(
          `embed box did not fill the panel at ${width}px: ${boxWidth}x${height}px, class "${className}"`,
        )
      }
      measured.push(`${width}px → ${Math.round(boxWidth)}x${Math.round(height)}`)
    }

    return { status: "pass", detail: measured.join(", ") }
  } finally {
    await new Promise((done) => server.close(done))
    await rm(outDir, { recursive: true, force: true })
  }
}

// Allow running this file directly for debugging.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await verifyEmbedLayout()
  console.log(result.status === "skip" ? `SKIP  ${result.detail}` : `PASS  ${result.detail}`)
}
