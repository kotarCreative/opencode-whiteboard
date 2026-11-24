import { render } from "solid-js/web"
import { BoardView } from "../../src/gui/board"

// Mirrors the host SDK's `embeds.View`: a plain div whose box is its class. The host's embed
// measurement ignores a zero-height box, so the panel must give this div a non-zero size.
const View = (props: { class?: string; children?: unknown }) => (
  <div data-embed-view class={props.class}>
    {props.children as never}
  </div>
)

// The test sets the panel box explicitly so a narrow layout is tested even where the headless
// browser refuses a window narrower than its minimum.
const root = document.getElementById("root")!
const params = new URLSearchParams(location.search)
if (params.has("width")) root.style.width = `${params.get("width")}px`
if (params.has("height")) root.style.height = `${params.get("height")}px`

const ctx = {
  app: { platform: "desktop" },
  t: (key: string) => key,
  main: () => ({
    acquire: async () => ({ id: "embed-1", url: "http://127.0.0.1:1", error: null }),
  }),
  embeds: { View },
  system: { openExternal: () => {} },
}

render(
  () => (
    <BoardView
      panel={{ session: { id: "session-1" } } as never}
      ctx={ctx as never}
      boardUrl="http://127.0.0.1:1"
      canOpenBrowser={() => false}
      openBrowserPane={() => {}}
    />
  ),
  root,
)

function measure() {
  const view = document.querySelector<HTMLElement>("[data-embed-view]")
  const rect = view?.getBoundingClientRect()

  document.body.dataset.embedHeight = String(rect?.height ?? -1)
  document.body.dataset.embedClass = view?.className ?? ""
  document.body.dataset.embedWidth = String(rect?.width ?? -1)
  document.body.dataset.ready = view ? "yes" : "no"
}

// Leave time for Solid's onMount -> acquire -> ready transition and the browser's layout.
setTimeout(measure, 250)
