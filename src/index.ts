import { Plugin } from "@opencode/plugin"

/**
 * Minimal server part. Its presence gives the package a stable id and lets
 * OpenCode Desktop load the experimental GUI part; all board/MCP behavior is
 * in the pinned upstream MCP server configured by opencode.jsonc.
 */
export default Plugin.define({
  id: "opencode-whiteboard",
  setup() {},
})
