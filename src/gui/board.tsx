import { Show, createSignal, onMount } from "solid-js"
import type { PanelProps, SetupContext } from "@opencode/plugin/gui"
import type { MountedSession } from "@opencode/plugin/gui"
import { WhiteboardEmbed } from "./contract"
import type { definition } from "./definition"

type ViewState =
  | { status: "loading" }
  | { status: "ready"; id: string }
  | { status: "error"; message: string }

export function BoardView(props: {
  panel: PanelProps
  ctx: SetupContext<typeof definition>
  boardUrl: string
  canOpenBrowser: (session: MountedSession) => boolean
  openBrowserPane: (session: MountedSession) => void
}) {
  const client = props.ctx.main(WhiteboardEmbed)
  const [state, setState] = createSignal<ViewState>({ status: "loading" })
  const ready = () => {
    const current = state()
    return current.status === "ready" ? current : undefined
  }

  const acquire = async () => {
    if (props.ctx.app.platform !== "desktop") {
      setState({ status: "error", message: props.ctx.t("panel.webOnly") })
      return
    }
    setState({ status: "loading" })
    try {
      const result = await client.acquire()
      if (result.id) setState({ status: "ready", id: result.id })
      else setState({ status: "error", message: result.error ?? props.ctx.t("panel.unavailable") })
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  onMount(() => {
    void acquire()
  })

  return (
    <div style="height:100%;min-height:0;display:flex;flex-direction:column;background:var(--background,#fff);color:var(--foreground,#111)">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent);font-size:12px">
        <span
          style={`width:7px;height:7px;border-radius:999px;flex:none;background:${
            state().status === "ready" ? "#2f9e44" : state().status === "loading" ? "#f59f00" : "#e03131"
          }`}
        />
        <span style="font-weight:600">{props.ctx.t("panel.subtitle")}</span>
        <span style="opacity:.55;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{props.boardUrl}</span>
        <span style="flex:1" />
        <button
          type="button"
          onClick={() => void acquire()}
          style="font:inherit;padding:2px 8px;border-radius:5px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit;cursor:pointer"
        >
          {props.ctx.t("panel.retry")}
        </button>
      </div>

      <Show
        when={ready()}
        fallback={
          <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:24px">
            <div style="max-width:380px;display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.5">
              <Show when={state().status === "loading"}>
                <div>{props.ctx.t("panel.loading")}</div>
              </Show>
              <Show when={state().status === "error"}>
                <strong>{props.ctx.t("panel.unavailable")}</strong>
                <div style="opacity:.7;overflow-wrap:anywhere">
                  {(state() as { message: string }).message}
                </div>
                <div style="opacity:.7">{props.ctx.t("panel.hint")}</div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
                  <button
                    type="button"
                    onClick={() => props.openBrowserPane(props.panel.session)}
                    style="font:inherit;padding:5px 10px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit;cursor:pointer"
                  >
                    {props.ctx.t("panel.openPane")}
                    {props.canOpenBrowser(props.panel.session) ? "" : " (system browser)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void props.ctx.system.openExternal(props.boardUrl)}
                    style="font:inherit;padding:5px 10px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit;cursor:pointer"
                  >
                    {props.ctx.t("panel.openSystem")}
                  </button>
                </div>
              </Show>
            </div>
          </div>
        }
      >
        {(ready) => (
          <div style="flex:1;min-height:0;position:relative">
            {/* The native view is laid out over this box. The host's View renders a plain div,
                so it must be given the box's full size; with the default auto height the view
                measures 0px and Electron never places the canvas (blank panel, no tools). */}
            <props.ctx.embeds.View
              id={ready().id}
              visible
              radius={8}
              page={props.boardUrl}
              class="absolute inset-0"
            />
          </div>
        )}
      </Show>
    </div>
  )
}
