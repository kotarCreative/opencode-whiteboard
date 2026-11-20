---
name: Whiteboard
description: Pull, inspect, and edit the one local Excalidraw whiteboard shared by OpenCode projects using this plugin. Use for whiteboard, canvas, diagram, Excalidraw, architecture drawing, or "pull the board" requests.
---

# Local whiteboard

There is one shared local board at `http://127.0.0.1:4317`. Its durable state
lives in the user-level OpenCode Whiteboard data root, outside this project and
outside the plugin cache. The board is shared by every OpenCode project that
loads this plugin.

In a checkout, `node bin/whiteboard.mjs info` reports the exact board id, data
paths, and upstream version. In an installed package, use the MCP tools below.
Do not guess a different port or board.

## Pull, do not send

"Pull" means reading the board into the current conversation:

1. Call `whiteboard_describe_scene` (or `tools.whiteboard.describe_scene` under
   Code Mode) for a structured text summary.
2. Call `whiteboard_get_canvas_screenshot` when visual layout matters.
3. Summarize only what the user asked for.

The upload tool is removed from the exposed tool surface. Never add or use a
share/upload path, and do not send board contents to remote services.

## Editing

- Call `whiteboard_read_diagram_guide` before drawing a new diagram.
- Prefer `whiteboard_batch_create_elements` with stable ids for shapes, then bind
  arrows with `startElementId` / `endElementId`.
- Export artifacts with `whiteboard_export_scene` only when the user asks, using
  the path they requested (or a clearly named path in the workspace).
- After meaningful edits, pull again with `whiteboard_describe_scene` and, if
  layout matters, `whiteboard_get_canvas_screenshot`.

## Binding and freshness

- One shared board, not one per project. A tool call cold-starts the canvas if
  needed. If it fails, retry once, then report the error. Do not start a second
  server on another port.
- MCP sees the canvas server state, not a browser tab's unsaved keystrokes.
  Pull again after the user says they edited in the browser.
- The board is loopback-only. Do not expose the port or add a tunnel.
