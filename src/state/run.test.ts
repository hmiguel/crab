import { beforeEach, expect, test, vi } from "vitest";
import type { ResponseData } from "../api";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: {
    runRequest: vi.fn(),
    cancelRequest: vi.fn().mockResolvedValue(undefined),
    parseText: vi.fn(),
    saveState: vi.fn().mockResolvedValue(undefined),
    listEnvironments: vi.fn().mockResolvedValue({ names: [], warnings: [] }),
    historyList: vi.fn().mockResolvedValue([]),
    historyStatus: vi.fn().mockResolvedValue({ enabled: true, error: null }),
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useEnvironments } from "./environments";
import { useHistory } from "./history";
import { useOutline } from "./outline";
import { useResponses } from "./responses";
import { cancelActive, runAt } from "./run";
import { useTabs } from "./tabs";
import { useWorkspace } from "./workspace";

const fakeResponse = (status: number): ResponseData => ({
  status,
  statusText: "OK",
  httpVersion: "HTTP/1.1",
  headers: [],
  contentType: null,
  bodyText: "",
  bodyBase64: null,
  truncated: false,
  sizeBytes: 0,
  timing: { totalMs: 1, ttfbMs: 1 },
  request: { method: "GET", url: "https://x.test", headers: [], body: null },
  hasSecrets: false,
  env: null,
  historyId: null,
});

let tabId: string;
beforeEach(() => {
  vi.clearAllMocks();
  useResponses.setState({ byTab: {} });
  useTabs.setState({ tabs: [], activeId: null });
  useEnvironments.getState().load(undefined);
  useWorkspace.setState({ folders: [{ id: "f", name: "W", roots: ["/r"] }] });
  useOutline.setState({ byPath: {} });
  tabId = useTabs.getState().addTab({ path: "/r/a.http", text: "GET https://x.test\n", savedText: "", eol: "\n", cursor: 0, scrollTop: 0 });
});

test("runAt sends the buffer text and stores the response", async () => {
  vi.mocked(api.runRequest).mockResolvedValueOnce(fakeResponse(200));
  await runAt(tabId, 0);
  expect(api.runRequest).toHaveBeenCalledWith({ runId: expect.any(String), path: "/r/a.http", text: "GET https://x.test\n", line: 0, env: null, root: "/r" });
  expect(useResponses.getState().byTab[tabId]).toMatchObject({ status: "done", line: 0, response: { status: 200 } });
});

test("a newer run cancels the older one and the stale result is ignored", async () => {
  let rejectFirst!: (e: unknown) => void;
  vi.mocked(api.runRequest)
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
    .mockResolvedValueOnce(fakeResponse(201));
  const first = runAt(tabId, 0);
  const firstRunId = useResponses.getState().byTab[tabId].runId;
  const second = runAt(tabId, 0);
  expect(api.cancelRequest).toHaveBeenCalledWith(firstRunId);
  await second;
  rejectFirst({ kind: "cancelled", message: "Request cancelled" });
  await first;
  expect(useResponses.getState().byTab[tabId]).toMatchObject({ status: "done", response: { status: 201 } });
});

test("errors are stored and cancelActive only cancels running requests", async () => {
  vi.mocked(api.runRequest).mockRejectedValueOnce({ kind: "network", message: "refused" });
  await runAt(tabId, 0);
  expect(useResponses.getState().byTab[tabId]).toMatchObject({ status: "error", error: { kind: "network", message: "refused" } });
  cancelActive(tabId);
  expect(api.cancelRequest).not.toHaveBeenCalled();
});

const block = (method: string) => ({
  name: null, method, url: "https://x.test", headers: [], body: null, span: { startLine: 0, endLine: 0 }, requestLine: 0,
});

test("sends the selected environment", async () => {
  vi.mocked(api.runRequest).mockResolvedValueOnce(fakeResponse(200));
  useEnvironments.getState().select("dev");
  await runAt(tabId, 0);
  expect(api.runRequest).toHaveBeenCalledWith(expect.objectContaining({ env: "dev", root: "/r" }));
});

test("asks before sending a POST to a red environment and stops on cancel", async () => {
  vi.mocked(api.parseText).mockResolvedValue({ variables: [], requests: [block("POST")], diagnostics: [] });
  useEnvironments.getState().select("prod");
  vi.mocked(ask).mockResolvedValueOnce(false);
  await runAt(tabId, 0);
  expect(ask).toHaveBeenCalledWith("Send POST https://x.test to prod?", expect.objectContaining({ kind: "warning", okLabel: "Send" }));
  expect(api.runRequest).not.toHaveBeenCalled();
  expect(useResponses.getState().byTab[tabId]).toBeUndefined();
});

test("sends after the user confirms", async () => {
  vi.mocked(api.parseText).mockResolvedValue({ variables: [], requests: [block("DELETE")], diagnostics: [] });
  useEnvironments.getState().select("prod");
  vi.mocked(ask).mockResolvedValueOnce(true);
  vi.mocked(api.runRequest).mockResolvedValueOnce(fakeResponse(204));
  await runAt(tabId, 0);
  expect(api.runRequest).toHaveBeenCalledTimes(1);
});

test("lowercase methods are still checked", async () => {
  vi.mocked(api.parseText).mockResolvedValue({ variables: [], requests: [block("post")], diagnostics: [] });
  useEnvironments.getState().select("prod");
  vi.mocked(ask).mockResolvedValueOnce(false);
  await runAt(tabId, 0);
  expect(ask).toHaveBeenCalled();
});

test("GET, a non-red environment, or the setting turned off never asks", async () => {
  vi.mocked(api.runRequest).mockResolvedValue(fakeResponse(200));
  vi.mocked(api.parseText).mockResolvedValue({ variables: [], requests: [block("GET")], diagnostics: [] });
  useEnvironments.getState().select("prod");
  await runAt(tabId, 0);
  vi.mocked(api.parseText).mockResolvedValue({ variables: [], requests: [block("POST")], diagnostics: [] });
  useEnvironments.getState().select("dev");
  await runAt(tabId, 0);
  useEnvironments.getState().select("prod");
  useEnvironments.getState().setConfirmDanger(false);
  await runAt(tabId, 0);
  expect(ask).not.toHaveBeenCalled();
  expect(api.runRequest).toHaveBeenCalledTimes(3);
});

test("a file outside every root runs with root null", async () => {
  const outside = useTabs.getState().addTab({ path: "/elsewhere/b.http", text: "POST https://x.test\n", savedText: "", eol: "\n", cursor: 0, scrollTop: 0 });
  useEnvironments.getState().select("prod");
  vi.mocked(api.parseText).mockResolvedValueOnce({ variables: [], requests: [block("POST")], diagnostics: [] });
  vi.mocked(ask).mockResolvedValueOnce(true);
  vi.mocked(api.runRequest).mockResolvedValueOnce(fakeResponse(200));
  await runAt(outside, 0);
  expect(api.parseText).toHaveBeenCalledWith("POST https://x.test\n");
  expect(ask).toHaveBeenCalled();
  expect(api.runRequest).toHaveBeenCalledWith(expect.objectContaining({ path: "/elsewhere/b.http", env: "prod", root: null }));
});

test("a red environment checks the current text, not a stale outline", async () => {
  // The editor's outline still says GET; the text was just changed to POST.
  useOutline.getState().set("/r/a.http", [block("GET")]);
  useTabs.getState().setText(tabId, "POST https://x.test\n");
  vi.mocked(api.parseText).mockResolvedValueOnce({ variables: [], requests: [block("POST")], diagnostics: [] });
  useEnvironments.getState().select("prod");
  vi.mocked(ask).mockResolvedValueOnce(false);
  await runAt(tabId, 0);
  expect(api.parseText).toHaveBeenCalledWith("POST https://x.test\n");
  expect(ask).toHaveBeenCalled();
  expect(api.runRequest).not.toHaveBeenCalled();
});

test("ResponseData carries the history id the backend assigned", () => {
  const r: ResponseData = { ...fakeResponse(200), historyId: 42 };
  expect(r.historyId).toBe(42);
});

test("a failing history refresh never breaks a run", async () => {
  vi.mocked(api.runRequest).mockResolvedValueOnce(fakeResponse(200));
  const refresh = vi.fn().mockRejectedValue(new Error("history down"));
  useHistory.setState({ refresh });
  await runAt(tabId, 0);
  expect(useResponses.getState().byTab[tabId]).toMatchObject({ status: "done" });
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("Esc still cancels a run that is hidden behind a past run", () => {
  useResponses.getState().start(tabId, "r1", 0);
  const summary = { id: 7, atMs: 1, path: "/r/a.http", requestKey: "k", requestLine: 0, name: null, method: "GET",
    url: "https://x", env: null, status: 200, errorKind: null, errorMessage: null, totalMs: 1, sizeBytes: 0 };
  useResponses.getState().showPast(tabId, { summary, request: fakeResponse(200).request, response: fakeResponse(200) }, 0);
  cancelActive(tabId);
  expect(api.cancelRequest).toHaveBeenCalledWith("r1");
});
