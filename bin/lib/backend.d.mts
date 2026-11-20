export const SERVICE_ID: "mcp-excalidraw-canvas"
export const MCP_NAME: "whiteboard"
export const UPLOAD_TOOL: "export_to_excalidraw_url"
export const DATA_HOME_ENV: "WHITEBOARD_HOME"

export interface BoardConfig {
  readonly name: string
  readonly url: string
  readonly dataDir?: string
  readonly exportDir?: string
  readonly stateDir?: string
  readonly storage?: "user" | "project"
  readonly dataRoot?: string
  readonly scope: string
}

export interface CanvasHealthBody {
  readonly service?: string
  readonly pid?: number
  readonly status?: string
  readonly elements_count?: number
  readonly durable_state_enabled?: boolean
  readonly [key: string]: unknown
}

export interface HealthResult {
  readonly ok: boolean
  readonly code?: "http" | "foreign" | "unreachable"
  readonly reason?: string
  readonly body?: CanvasHealthBody
}

export interface Manifest extends Record<string, unknown> {
  readonly boardId: string
  readonly boardName: string
  readonly scope: string
  readonly storage: "user" | "project"
  readonly projectRoot: string
  readonly dataRoot: string
  readonly url: string
  readonly dataDir: string
  readonly exportDir: string
  readonly logFile: string
  readonly upstream: { readonly package: string; readonly version: string; readonly license: string }
  readonly createdAt?: string
  readonly lastStartedAt?: string
  readonly pid?: number | null
}

export interface BoardPaths {
  readonly root: string
  readonly config: BoardConfig
  readonly configPath: string
  readonly configDir: string
  readonly storage: "user" | "project"
  readonly dataRoot: string
  readonly dataDir: string
  readonly exportDir: string
  readonly stateDir: string
  readonly base: string
  readonly url: URL
  readonly port: number
  readonly manifestPath: string
  readonly lockPath: string
  readonly logFile: string
  readonly serverEntry: string
  readonly mcpEntry: string
  readonly upstream: Manifest["upstream"]
}

export interface EnsureResult {
  readonly alreadyRunning: boolean
  readonly manifest: Manifest
  readonly health: CanvasHealthBody
}

export interface StatusResult extends Manifest {
  readonly running: boolean
  readonly health: CanvasHealthBody | { readonly error: string }
  readonly sync: unknown
}

export interface StopResult extends Record<string, unknown> {
  readonly stopped: boolean
  readonly pid?: number
  readonly message?: string
}

export interface Backend {
  readonly boardInfo: (extra?: Record<string, unknown>) => Manifest
  readonly config: BoardConfig
  readonly configPath: string
  readonly paths: BoardPaths
  readonly serverEntry: string
  readonly mcpEntry: string
  readonly manifestPath: string
  readonly logFile: string
  health(timeoutMs?: number): Promise<HealthResult>
  ensure(): Promise<EnsureResult>
  status(): Promise<StatusResult>
  stop(): Promise<StopResult>
  info(): Promise<StatusResult>
}

export function defaultDataRoot(
  env?: Record<string, string | undefined>,
  platform?: NodeJS.Platform,
): string

export function resolveNodeCommand(
  env?: Record<string, string | undefined>,
  execPath?: string,
): string

export function resolveServerEntry(root: string, explicit?: string): string

export function resolveMcpEntry(root: string, explicit?: string): string

export function loadBoardConfig(options: {
  root: string
  configPath?: string
  env?: Record<string, string | undefined>
  serverEntry?: string
  mcpEntry?: string
}): BoardPaths

export function createBackend(options: {
  root: string
  configPath?: string
  env?: Record<string, string | undefined>
  nodePath?: string
  spawnEnv?: Record<string, string | undefined>
  serverEntry?: string
  mcpEntry?: string
  log?: (level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>) => void
}): Backend
