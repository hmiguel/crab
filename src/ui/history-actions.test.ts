import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { historyGet: vi.fn(), readTextFile: vi.fn(), parseText: vi.fn() },
}));
vi.mock("./actions", () => ({ showError: vi.fn() }));

import { api, type PastRun, type RequestBlock } from "../api";
import { useResponses } from "../state/responses";
import { useTabs } from "../state/tabs";
import { showError } from "./actions";
import { openPastRun } from "./history-actions";

const block = (name: string | null, method: string, url: string, line: number): RequestBlock => ({
  name, method, url, headers: [], body: null, span: { startLine: line, endLine: line + 1 }, requestLine: line,
});
const past = (key: string, line: number, path: string | null = "/r/a.http"): PastRun => ({
  summary: { id: 5, atMs: 1, path, requestKey: key, requestLine: line, name: null, method: "GET", url: "https://x",
    env: null, status: 200, errorKind: null, errorMessage: null, totalMs: 1, sizeBytes: 1 },
  request: { method: "GET", url: "https://x", headers: [], body: null },
  response: {
    status: 200, statusText: "OK", httpVersion: "HTTP/1.1", headers: [], contentType: null, bodyText: "old",
    bodyBase64: null, truncated: false, sizeBytes: 3, timing: { totalMs: 1, ttfbMs: 1 },
    request: { method: "GET", url: "https://x", headers: [], body: null }, hasSecrets: false, env: null, historyId: 5,
  },
});

let openFile: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  useResponses.setState({ byTab: {}, live: {} });
  useTabs.setState({ tabs: [], activeId: null });
  openFile = vi.fn(async (path: string) => {
    const id = useTabs.getState().addTab({ path, text: "TEXT", savedText: "TEXT", eol: "\n", cursor: 0, scrollTop: 0 });
    useTabs.getState().setActive(id);
  });
  useTabs.setState({ openFile } as never);
  vi.mocked(api.readTextFile).mockResolvedValue("TEXT");
});

test("opens the file at the request's current line, matched by key", async () => {
  vi.mocked(api.historyGet).mockResolvedValue(past("GET /orders", 0));
  vi.mocked(api.parseText).mockResolvedValue({ variables: [], diagnostics: [], requests: [block(null, "GET", "/users", 0), block(null, "GET", "/orders", 9)] });
  await openPastRun(5);
  expect(openFile).toHaveBeenCalledWith("/r/a.http", 9);
  const tabId = useTabs.getState().activeId!;
  expect(useResponses.getState().byTab[tabId]).toMatchObject({ status: "done", line: 9, past: { id: 5 }, response: { bodyText: "old" } });
});

test("falls back to the stored line when the request was renamed", async () => {
  vi.mocked(api.historyGet).mockResolvedValue(past("old-name", 4));
  vi.mocked(api.parseText).mockResolvedValue({ variables: [], diagnostics: [], requests: [block("new-name", "GET", "/x", 4)] });
  await openPastRun(5);
  expect(openFile).toHaveBeenCalledWith("/r/a.http", 4);
});

test("a deleted file still shows the run in the active tab, with a message", async () => {
  const other = useTabs.getState().addTab({ path: "/r/other.http", text: "", savedText: "", eol: "\n", cursor: 0, scrollTop: 0 });
  useTabs.getState().setActive(other);
  vi.mocked(api.historyGet).mockResolvedValue(past("k", 0, "/r/gone.http"));
  vi.mocked(api.readTextFile).mockRejectedValue(new Error("not found"));
  await openPastRun(5);
  expect(openFile).not.toHaveBeenCalled();
  expect(useResponses.getState().byTab[other]).toMatchObject({ past: { id: 5 } });
  expect(showError).toHaveBeenCalledWith(new Error("The file /r/gone.http no longer exists"));
});

test("a pruned run shows a message and changes nothing", async () => {
  vi.mocked(api.historyGet).mockResolvedValue(null);
  await openPastRun(5);
  expect(showError).toHaveBeenCalledWith(new Error("This run is no longer in history"));
  expect(useResponses.getState().byTab).toEqual({});
});
