import { beforeEach, expect, test, vi } from "vitest";
import type { ResponseData } from "../api";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { runRequest: vi.fn(), cancelRequest: vi.fn().mockResolvedValue(undefined) },
}));

import { api } from "../api";
import { useResponses } from "./responses";
import { cancelActive, runAt } from "./run";
import { useTabs } from "./tabs";

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
});

let tabId: string;
beforeEach(() => {
  vi.clearAllMocks();
  useResponses.setState({ byTab: {} });
  useTabs.setState({ tabs: [], activeId: null });
  tabId = useTabs.getState().addTab({ path: "/r/a.http", text: "GET https://x.test\n", savedText: "", eol: "\n", cursor: 0, scrollTop: 0 });
});

test("runAt sends the buffer text and stores the response", async () => {
  vi.mocked(api.runRequest).mockResolvedValueOnce(fakeResponse(200));
  await runAt(tabId, 0);
  expect(api.runRequest).toHaveBeenCalledWith({ runId: expect.any(String), path: "/r/a.http", text: "GET https://x.test\n", line: 0, env: null, root: null });
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
