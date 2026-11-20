#!/usr/bin/env node
// Thin lifecycle wrapper around the pinned upstream canvas server.
// All validation and single-flight startup live in ./lib/backend.mjs, the same
// module OpenCode Desktop uses for cold starts.

import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createBackend } from "./lib/backend.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const backend = createBackend({ root })

async function start() {
  const result = await backend.ensure()
  console.log(JSON.stringify({ ...result.manifest, alreadyRunning: result.alreadyRunning, health: result.health }, null, 2))
}

async function status() {
  const result = await backend.status()
  console.log(JSON.stringify(result, null, 2))
  if (!result.running) process.exitCode = 1
}

async function stop() {
  console.log(JSON.stringify(await backend.stop(), null, 2))
}

async function info() {
  console.log(JSON.stringify(await backend.info(), null, 2))
}

const command = process.argv[2] ?? "status"
const commands = { start, ensure: start, status, stop, info }

if (!commands[command]) {
  console.error(`Usage: node bin/whiteboard.mjs <start|ensure|status|stop|info>`)
  process.exit(2)
}

try {
  await commands[command]()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
