import { Browser } from "@opencode/plugin/gui/browser"
import {
  Command,
  MenuItem,
  Panel,
  type PanelProps,
  type PanelTab,
  type Plugin,
} from "@opencode/plugin/gui"
import type { MountedSession } from "@opencode/plugin/gui"
import { BoardView } from "./board"
import { WhiteboardEmbed } from "./contract"
import type { definition } from "./definition"

const DEFAULT_URL = "http://127.0.0.1:4317"

export const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const boardUrl = (
    typeof ctx.options.boardUrl === "string" ? ctx.options.boardUrl : DEFAULT_URL
  ).replace(/\/+$/, "")
  const browser = ctx.use(Browser)
  const main = ctx.main(WhiteboardEmbed)
  const panelKey = `${ctx.id}:board`

  const canOpenBrowser = (session: MountedSession) => {
    const live = browser()
    return live.status === "active" && live.value.canOpen(session, boardUrl)
  }

  const openBrowserPane = (session: MountedSession, target = boardUrl) => {
    const live = browser()
    if (live.status === "active" && live.value.canOpen(session, target)) {
      live.value.open(session, target)
      return
    }
    // Browser pane unavailable (classic TUI/web or the built-in browser is
    // disabled): fall back to the user's system browser. This is the
    // documented, usable non-Desktop path.
    void ctx.system.openExternal(target)
  }

  // Cold start is shared with the panel: one single-flight backend in the
  // Electron main process, the same durable store the MCP server uses. Returns
  // the backend's configured URL, so a stale boardUrl option cannot open the
  // wrong port.
  const ensureBackend = async (): Promise<string | null> => {
    if (ctx.app.platform !== "desktop") return boardUrl
    try {
      const result = await main.ensure()
      if (!result.ok) {
        ctx.toast.show({
          title: ctx.t("panel.unavailable"),
          description: result.error ?? undefined,
          variant: "error",
          duration: 8000,
        })
        return null
      }
      return result.url
    } catch (error) {
      ctx.toast.show({
        title: ctx.t("panel.unavailable"),
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
        duration: 8000,
      })
      return null
    }
  }

  const withSession = (run: (session: MountedSession) => void | Promise<void>) => async () => {
    const session = ctx.sessions.current()
    if (session) await run(session)
  }

  const openBoardExternally = async () => {
    const target = await ensureBackend()
    if (target) void ctx.system.openExternal(target)
  }

  const openBoard = withSession(async (session) => {
    const target = await ensureBackend()
    if (target) openBrowserPane(session, target)
  })

  const openPanel = withSession((session) => {
    ctx.layout.open(panelKey, session)
  })

  // One command for the palette, shortcut settings, and the composer's
  // `/whiteboard` menu. The host's documented toggle opens the panel if it is
  // closed and closes it if it is open; no prompt or model call is involved.
  //
  // A fresh draft has no SessionRef, and every Layout call needs one, so the
  // side panel cannot open before the first message. Keep the slash command
  // usable there by opening the board in the system browser instead.
  const togglePanel = () => {
    const session = ctx.sessions.current()
    if (!session) return openBoardExternally()
    ctx.layout.toggle(panelKey, session)
  }

  ctx.add(Command, (): Command => ({
    id: "open-board",
    title: ctx.t("command.open"),
    description: `${ctx.t("panel.subtitle")} · ${boardUrl}`,
    keywords: "whiteboard excalidraw canvas diagram",
    section: "session",
    enabled: !!ctx.sessions.current(),
    run: openBoard,
  }))

  ctx.add(Command, (): Command => {
    const session = ctx.sessions.current()

    return {
      id: "toggle-board-panel",
      title: session ? ctx.t("command.toggle") : ctx.t("command.openDraft"),
      description: session ? ctx.t("command.toggle.description") : ctx.t("command.openDraft.description"),
      keywords: "whiteboard excalidraw canvas panel toggle open close",
      section: "session",
      slash: { name: "whiteboard" },
      // No session gate: a fresh draft must still list /whiteboard. There the
      // run opens the board externally, because Layout has no draft layout.
      run: togglePanel,
    }
  })

  ctx.add(MenuItem, (): MenuItem => {
    const session = ctx.sessions.current()
    return {
      menu: "session.panel",
      id: "board",
      title: ctx.t("menu.open"),
      description: ctx.t("menu.description"),
      opened: !!session && ctx.layout.state(panelKey, session) !== "closed",
      run: () => void openPanel(),
    }
  })

  const tab: PanelTab = {
    id: "board",
    get title() {
      return ctx.t("panel.title")
    },
    closable: "hover",
  }

  const render = (props: PanelProps) => (
    <BoardView
      panel={props}
      ctx={ctx}
      boardUrl={boardUrl}
      canOpenBrowser={canOpenBrowser}
      openBrowserPane={openBrowserPane}
    />
  )

  ctx.add(Panel, {
    id: "board",
    region: "side",
    width: 640,
    mobile: {
      get title() {
        return ctx.t("panel.title")
      },
      order: 45,
      kind: "menu",
      icon: "file-tree",
    },
    list: (input) => (input.open.includes("board") ? [tab] : []),
    render,
  })
}
