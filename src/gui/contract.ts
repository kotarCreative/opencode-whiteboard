import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

// The same RPC token the ESM server part registers. The GUI bundle imports the
// contract only; it never needs Node's module location.
export { WhiteboardPaths } from "../rpc"

/**
 * Window -> Electron main bridge for one embedded canvas per window.
 * `id` is null when the local canvas is not reachable; the panel then
 * renders its browser-pane fallback instead of a blank native view.
 *
 * `ensure` cold-starts the shared local backend (single-flight) and is used by
 * commands that open the board outside the panel. `acquire` also ensures the
 * backend before creating the view.
 */
export const WhiteboardEmbed = Ipc.define({
  id: "opencode-whiteboard.embed",
  methods: {
    acquire: {
      output: Schema.Struct({
        id: Schema.NullOr(Schema.String),
        url: Schema.String,
        error: Schema.NullOr(Schema.String),
      }),
    },
    ensure: {
      output: Schema.Struct({
        ok: Schema.Boolean,
        started: Schema.Boolean,
        url: Schema.String,
        error: Schema.NullOr(Schema.String),
      }),
    },
  },
})
