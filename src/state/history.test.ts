import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { historyList: vi.fn(), historyStatus: vi.fn(), historyClear: vi.fn() },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

import { ask } from "@tauri-apps/plugin-dialog";
import { api, type RunSummary } from "../api";
import { HISTORY_PAGE, useHistory } from "./history";

const run = (id: number): RunSummary => ({
  id, atMs: id, path: "/r/a.http", requestKey: "k", requestLine: 0, name: null, method: "GET", url: "https://x",
  env: null, status: 200, errorKind: null, errorMessage: null, totalMs: 1, sizeBytes: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.historyStatus).mockResolvedValue({ enabled: true, error: null });
  useHistory.setState({ items: [], query: "", hasMore: false, forRequest: null, status: { enabled: true, error: null } });
});

test("reload asks for the first page and knows when more exist", async () => {
  vi.mocked(api.historyList).mockResolvedValue(Array.from({ length: HISTORY_PAGE }, (_, i) => run(100 - i)));
  await useHistory.getState().reload();
  expect(api.historyList).toHaveBeenCalledWith({ query: null, limit: HISTORY_PAGE });
  expect(useHistory.getState().items).toHaveLength(HISTORY_PAGE);
  expect(useHistory.getState().hasMore).toBe(true);
});

test("loadMore pages from the last id and appends", async () => {
  useHistory.setState({ items: [run(10), run(9)], hasMore: true });
  vi.mocked(api.historyList).mockResolvedValue([run(8)]);
  await useHistory.getState().loadMore();
  expect(api.historyList).toHaveBeenCalledWith({ query: null, before: 9, limit: HISTORY_PAGE });
  expect(useHistory.getState().items.map((r) => r.id)).toEqual([10, 9, 8]);
  expect(useHistory.getState().hasMore).toBe(false);
});

test("setQuery is debounced and searches", async () => {
  vi.useFakeTimers();
  vi.mocked(api.historyList).mockResolvedValue([run(1)]);
  useHistory.getState().setQuery("ord");
  useHistory.getState().setQuery("orders");
  expect(api.historyList).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(api.historyList).toHaveBeenCalledTimes(1);
  expect(api.historyList).toHaveBeenCalledWith({ query: "orders", limit: HISTORY_PAGE });
  vi.useRealTimers();
});

test("refresh reloads the list, the current request's runs and the status", async () => {
  useHistory.setState({ forRequest: { path: "/r/a.http", key: "k", items: [] } });
  vi.mocked(api.historyList).mockResolvedValue([run(3)]);
  vi.mocked(api.historyStatus).mockResolvedValue({ enabled: false, error: "disk full" });
  await useHistory.getState().refresh();
  expect(api.historyList).toHaveBeenCalledWith({ path: "/r/a.http", key: "k", limit: 20 });
  expect(useHistory.getState().forRequest?.items.map((r) => r.id)).toEqual([3]);
  expect(useHistory.getState().status).toEqual({ enabled: false, error: "disk full" });
});

test("clear asks first and does nothing on cancel", async () => {
  vi.mocked(ask).mockResolvedValueOnce(false);
  await useHistory.getState().clear();
  expect(api.historyClear).not.toHaveBeenCalled();
  vi.mocked(ask).mockResolvedValueOnce(true);
  vi.mocked(api.historyClear).mockResolvedValue(undefined);
  vi.mocked(api.historyList).mockResolvedValue([]);
  await useHistory.getState().clear();
  expect(api.historyClear).toHaveBeenCalledTimes(1);
});

test("failures leave the store usable", async () => {
  vi.mocked(api.historyList).mockRejectedValue(new Error("boom"));
  await expect(useHistory.getState().refresh()).resolves.toBeUndefined();
  expect(useHistory.getState().items).toEqual([]);
});
