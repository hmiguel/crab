import { create } from "zustand";
import { api, type RequestBlock } from "../api";
import { basename, joinPath, normPath, samePath } from "../lib/paths";
import { useWorkspace } from "./workspace";

export type SearchItem =
  | { kind: "file"; path: string; display: string }
  | { kind: "request"; path: string; display: string; method: string; label: string; url: string; requestLine: number; content: string };

type SearchIndexState = {
  /** normPath -> requests parsed from disk; null when the file couldn't be read. */
  parsed: Record<string, RequestBlock[] | null>;
  indexing: boolean;
  /** Read and parse every workspace file not parsed yet. */
  ensure(): Promise<void>;
  invalidate(paths: string[]): void;
};

const CONCURRENCY = 8;
const CONTENT_CAP = 4096;

/** Headers as `Name: value` lines plus the inline body; `< file` bodies are never read. */
function requestContent(r: RequestBlock): string {
  const lines = r.headers.map((h) => `${h.name}: ${h.value}`);
  if (r.body?.kind === "inline") lines.push(r.body.value);
  return lines.join("\n").slice(0, CONTENT_CAP);
}

type WorkspaceView = { folders: { roots: string[] }[]; files: Record<string, string[]> };

function workspaceFiles(ws: WorkspaceView): Array<{ path: string; display: string }> {
  const roots: string[] = [];
  for (const r of ws.folders.flatMap((f) => f.roots)) if (!roots.some((x) => samePath(x, r))) roots.push(r);
  return roots.flatMap((root) =>
    (ws.files[root] ?? []).map((rel) => ({ path: joinPath(root, rel), display: `${basename(root)}/${rel}` })),
  );
}

/** Files and their requests in tree order; open files use the editor outline (unsaved edits included). */
export function searchItems(
  ws: WorkspaceView,
  parsed: Record<string, RequestBlock[] | null>,
  outline: Record<string, RequestBlock[]>,
): SearchItem[] {
  return workspaceFiles(ws).flatMap(({ path, display }) => {
    const requests = outline[normPath(path)] ?? parsed[normPath(path)] ?? [];
    return [
      { kind: "file", path, display } as SearchItem,
      ...requests.map((r): SearchItem => ({
        kind: "request", path, display, method: r.method, label: r.name ?? r.url, url: r.url, requestLine: r.requestLine,
        content: requestContent(r),
      })),
    ];
  });
}

export const useSearchIndex = create<SearchIndexState>((set, get) => ({
  parsed: {},
  indexing: false,
  async ensure() {
    const queue = workspaceFiles(useWorkspace.getState())
      .map((f) => f.path)
      .filter((p) => !(normPath(p) in get().parsed));
    if (queue.length === 0) return;
    set({ indexing: true });
    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        const requests = await api.readTextFile(path).then(api.parseText).then((p) => p.requests, () => null);
        set((s) => ({ parsed: { ...s.parsed, [normPath(path)]: requests } }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    set({ indexing: false });
  },
  invalidate(paths) {
    set((s) => {
      const parsed = { ...s.parsed };
      for (const p of paths) delete parsed[normPath(p)];
      return { parsed };
    });
  },
}));
