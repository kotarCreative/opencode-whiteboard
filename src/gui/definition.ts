import { Plugin } from "@opencode/plugin/gui"

export const definition = Plugin.define({
  i18n: {
    en: {
      "panel.title": "Whiteboard",
      "panel.subtitle": "Shared local board",
      "panel.loading": "Starting or connecting to the local whiteboard…",
      "panel.unavailable": "Local whiteboard is not reachable",
      "panel.hint": "The local backend starts on demand. Retry to start it again.",
      "panel.retry": "Retry",
      "panel.openPane": "Open browser pane",
      "panel.openSystem": "Open in system browser",
      "panel.webOnly": "The embedded canvas needs OpenCode Desktop. Use the browser pane or your system browser.",
      "command.open": "Whiteboard: Open board",
      "command.toggle": "Whiteboard: Toggle board panel",
      "command.toggle.description": "Open the whiteboard panel, or close it if it is open",
      "command.openDraft": "Whiteboard: Open board",
      "command.openDraft.description":
        "Open the shared local board in your browser. The side panel is available once a session starts.",
      "menu.open": "Whiteboard",
      "menu.description": "Shared local board",
    },
  },
})
