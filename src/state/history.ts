import { ask } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { api, type HistoryStatus, type RunSummary } from "../api";
import { debounce } from "../lib/debounce";

export const HISTORY_PAGE = 50;
export const REQUEST_PAGE = 20;

type HistoryState = {
  items: RunSummary[];
  query: string;
  hasMore: boolean;
  status: HistoryStatus;
  /** Past runs of the request under the cursor. */
  forRequest: { path: string; key: string; items: RunSummary[] } | null;
  setQuery(q: string): void;
  reload(): Promise<void>;
  loadMore(): Promise<void>;
  loadForRequest(path: string, key: string): Promise<void>;
  refresh(): Promise<void>;
  clear(): Promise<void>;
};

const queryArg = (q: string) => (q.trim() === "" ? null : q.trim());

export const useHistory = create<HistoryState>((set, get) => {
  const reloadSoon = debounce(() => void get().reload(), 200);
  return {
    items: [],
    query: "",
    hasMore: false,
    status: { enabled: true, error: null },
    forRequest: null,
    setQuery(query) {
      set({ query });
      reloadSoon();
    },
    async reload() {
      try {
        const items = await api.historyList({ query: queryArg(get().query), limit: HISTORY_PAGE });
        set({ items, hasMore: items.length === HISTORY_PAGE });
      } catch {
        set({ items: [], hasMore: false });
      }
    },
    async loadMore() {
      const { items, hasMore, query } = get();
      if (!hasMore || items.length === 0) return;
      try {
        const more = await api.historyList({ query: queryArg(query), before: items[items.length - 1].id, limit: HISTORY_PAGE });
        set({ items: [...items, ...more], hasMore: more.length === HISTORY_PAGE });
      } catch {
        set({ hasMore: false });
      }
    },
    async loadForRequest(path, key) {
      try {
        const items = await api.historyList({ path, key, limit: REQUEST_PAGE });
        set({ forRequest: { path, key, items } });
      } catch {
        set({ forRequest: { path, key, items: [] } });
      }
    },
    async refresh() {
      const fr = get().forRequest;
      await Promise.all([
        get().reload(),
        fr ? get().loadForRequest(fr.path, fr.key) : Promise.resolve(),
        api.historyStatus().then((status) => set({ status }), () => undefined),
      ]).catch(() => undefined);
    },
    async clear() {
      const ok = await ask("Delete every saved run? This can't be undone.", { title: "Crab", kind: "warning", okLabel: "Clear history", cancelLabel: "Cancel" });
      if (!ok) return;
      await api.historyClear().catch(() => undefined);
      await get().refresh();
    },
  };
});
