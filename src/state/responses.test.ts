import { beforeEach, expect, test } from "vitest";
import type { PastRun, ResponseData } from "../api";
import { useResponses } from "./responses";

const resp = (status: number): ResponseData => ({
  status, statusText: "OK", httpVersion: "HTTP/1.1", headers: [], contentType: null, bodyText: "", bodyBase64: null,
  truncated: false, sizeBytes: 0, timing: { totalMs: 1, ttfbMs: 1 },
  request: { method: "GET", url: "https://x", headers: [], body: null }, hasSecrets: false, env: "dev", historyId: 7,
});
const summary = { id: 7, atMs: 1000, path: "/r/a.http", requestKey: "k", requestLine: 0, name: null, method: "GET",
  url: "https://x", env: "dev", status: 200, errorKind: null, errorMessage: null, totalMs: 1, sizeBytes: 0 };

beforeEach(() => useResponses.setState({ byTab: {}, live: {} }));

test("showPast displays a past run and latest restores the live one", () => {
  const s = useResponses.getState();
  s.start("t", "run1", 3);
  s.finish("t", "run1", resp(201));
  s.showPast("t", { summary, request: resp(200).request, response: resp(200) } satisfies PastRun, 3);
  expect(useResponses.getState().byTab.t).toMatchObject({ status: "done", past: { id: 7, atMs: 1000, env: "dev" }, response: { status: 200 } });
  useResponses.getState().latest("t");
  expect(useResponses.getState().byTab.t).toMatchObject({ status: "done", response: { status: 201 } });
  expect(useResponses.getState().byTab.t).not.toHaveProperty("past");
});

test("an errored past run shows as an error with its message", () => {
  const errored = { ...summary, status: null, errorKind: "network" as const, errorMessage: "refused" };
  useResponses.getState().showPast("t", { summary: errored, request: resp(200).request, response: null }, 0);
  expect(useResponses.getState().byTab.t).toMatchObject({ status: "error", error: { kind: "network", message: "refused" }, past: { id: 7 } });
});

test("a new run replaces a past run and forgets the stashed live one", () => {
  const s = useResponses.getState();
  s.showPast("t", { summary, request: resp(200).request, response: resp(200) }, 0);
  s.start("t", "run2", 0);
  expect(useResponses.getState().byTab.t).toMatchObject({ status: "running" });
  expect(useResponses.getState().live.t).toBeUndefined();
});
