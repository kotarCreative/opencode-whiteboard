import { Rpc } from "@opencode/plugin/rpc"

/**
 * Server -> Desktop main path handoff.
 *
 * OpenCode evaluates the GUI bundle as CommonJS text with only `require`,
 * `module`, and `exports` in scope, so the bundle has no `__dirname`,
 * `__filename`, or `import.meta.url`. The ESM server part does have
 * `import.meta.url`; it resolves the package root once and returns it here.
 * Desktop's main process starts the local backend from those paths instead of
 * guessing at its own location.
 */
export const WhiteboardPaths = Rpc.define({
  id: "opencode-whiteboard",
  methods: {
    paths: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          root: { type: "string" },
          configPath: { type: "string" },
        },
        required: ["root", "configPath"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
