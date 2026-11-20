---
name: Whiteboard
description: Pull, inspect, and edit the single local Excalidraw whiteboard bound to this project. Use for whiteboard, canvas, diagram, Excalidraw, architecture drawing, or "pull the board" requests.
---

# Project whiteboard

This project has one local board, bound explicitly to
`http://127.0.0.1:4317` and durable state in `.whiteboard/data`.

Run `node bin/whiteboard.mjs info` if you need the exact board id, paths, and
upstream version. Do not guess a different port or board.

## Pull, do not send

"Pull" means reading the board into the current conversation:

1. Call `whiteboard_describe_scene` (or `tools.whiteboard.describe_scene` under
   Code Mode) for a structured text summary.
2. Call `whiteboard_get_canvas_screenshot` when visual layout matters.
3. Summarize only what the user asked for.

Never call `whiteboard_export_to_excalidraw_url`. It is denied by project
permission and would upload the scene to excalidraw.com. Do not use any share or
upload path. Do not send board contents to remote services.

## Editing

- Call `whiteboard_read_diagram_guide` before drawing a new diagram.
- Prefer `whiteboard_batch_create_elements` with stable ids for shapes, then bind
  arrows with `startElementId` / `endElementId`.
- Export repo artifacts with `whiteboard_export_scene` to `boards/<name>.excalidraw`
  only when the user asks.
- After meaningful edits, pull again with `whiteboard_describe_scene` and, if
  layout matters, `whiteboard_get_canvas_screenshot`.

## Binding and freshness

- One board per project. The canvas is started on demand by the Desktop panel
  command or by the MCP server. If a tool call fails because the canvas is
  unreachable, retry once, then run `node bin/whiteboard.mjs start` and report
  the error. Do not start a second server on another port.
- MCP sees the canvas server state, not a browser tab's unsaved keystrokes.
  Pull again after the user says they edited in the browser.
- The board is loopback-only. Do not expose the port or add a tunnel.
