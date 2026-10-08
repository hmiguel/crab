import { invoke } from "@tauri-apps/api/core";

// Mirrors crab-core's serde types (camelCase). Line numbers are 0-based.
export type Span = { startLine: number; endLine: number };
export type Header = { name: string; value: string };
export type BodySource = { kind: "inline"; value: string } | { kind: "file"; value: string };
export type RequestBlock = {
  name: string | null;
  method: string;
  url: string;
  headers: Header[];
  body: BodySource | null;
  span: Span;
  requestLine: number;
};
export type FileVar = { name: string; value: string; line: number };
export type Diagnostic = { line: number; message: string };
export type ParsedFile = { variables: FileVar[]; requests: RequestBlock[]; diagnostics: Diagnostic[] };
export type ResolvedRequest = { method: string; url: string; headers: Header[]; body: string | null };
export type Timing = { totalMs: number; ttfbMs: number };
export type ResponseData = {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: Header[];
  contentType: string | null;
  bodyText: string;
  bodyBase64: string | null;
  truncated: boolean;
  sizeBytes: number;
  timing: Timing;
  request: ResolvedRequest;
  hasSecrets: boolean;
  env: string | null;
  historyId: number | null;
};
export type ErrorKind = "parse" | "unresolvedVars" | "network" | "timeout" | "cancelled" | "io" | "env";
export type CrabError = { kind: ErrorKind; message: string };
/** Environment names in the workspace, and warnings about env files that are ignored. */
export type EnvScan = { names: string[]; warnings: string[] };
export type RunSummary = {
  id: number; atMs: number; path: string | null; requestKey: string; requestLine: number; name: string | null;
  method: string; url: string; env: string | null; status: number | null; errorKind: ErrorKind | null;
  errorMessage: string | null; totalMs: number | null; sizeBytes: number | null;
};
export type PastRun = { summary: RunSummary; request: ResolvedRequest; response: ResponseData | null };
export type ListQuery = { query?: string | null; path?: string | null; key?: string | null; before?: number | null; limit: number };
export type HistoryStatus = { enabled: boolean; error: string | null };
export type StateName = "workspace" | "session";

export const api = {
  parseText: (text: string) => invoke<ParsedFile>("parse_text", { text }),
  runRequest: (args: { runId: string; path: string | null; text: string; line: number; env: string | null; root: string | null }) =>
    invoke<ResponseData>("run_request", args),
  cancelRequest: (runId: string) => invoke<void>("cancel_request", { runId }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  writeTextFile: (path: string, contents: string) => invoke<void>("write_text_file", { path, contents }),
  listHttpFiles: (root: string) => invoke<string[]>("list_http_files", { root }),
  loadState: <T>(name: StateName) => invoke<T | null>("load_state", { name }),
  saveState: (name: StateName, value: unknown) => invoke<void>("save_state", { name, value }),
  watchRoots: (roots: string[]) => invoke<void>("watch_roots", { roots }),
  listEnvironments: (roots: string[]) => invoke<EnvScan>("list_environments", { roots }),
  revealRequest: (runId: string) => invoke<ResolvedRequest | null>("reveal_request", { runId }),
  historyList: (query: ListQuery) => invoke<RunSummary[]>("history_list", { query }),
  historyGet: (id: number) => invoke<PastRun | null>("history_get", { id }),
  historyClear: () => invoke<void>("history_clear"),
  historyStatus: () => invoke<HistoryStatus>("history_status"),
};

export function toCrabError(e: unknown): CrabError {
  if (e && typeof e === "object" && "kind" in e && "message" in e) return e as CrabError;
  if (e instanceof Error) return { kind: "io", message: e.message };
  return { kind: "io", message: String(e) };
}
