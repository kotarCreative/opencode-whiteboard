export const SERVICE_ID: "mcp-excalidraw-canvas"

export interface BoardConfig {
  readonly name: string
  readonly url: string
  readonly dataDir: string
  readonly exportDir: string
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
  readonly projectRoot: string
  readonly url: string
  readonly dataDir: string
  readonly exportDir: string
  readonly logFile: string
  readonly upstream: { readonly package: string; readonly version: string; readonly license: string }
  readonly createdAt?: string
  readonly lastStartedAt?: string
  readonly pid?: number | null
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
  readonly manifestPath: string
  readonly logFile: string
  health(timeoutMs?: number): Promise<HealthResult>
  ensure(): Promise<EnsureResult>
  status(): Promise<StatusResult>
  stop(): Promise<StopResult>
  info(): Promise<StatusResult>
}

export function createBackend(options: {
  root: string
  configPath?: string
  env?: Record<string, string | undefined>
  nodePath?: string
  spawnEnv?: Record<string, string | undefined>
  serverEntry?: string
  log?: (level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>) => void
}): Backend
