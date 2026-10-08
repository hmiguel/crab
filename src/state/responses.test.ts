import { beforeEach, expect, test } from "vitest";
import type { PastRun, ResponseData } from "../api";
import { canRunAgain, useResponses } from "./responses";

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

test("a live run that settles while a past run is shown lands in the stash, not on the floor", () => {
  const s = useResponses.getState();
  s.start("t", "r1", 0);
  s.showPast("t", { summary, request: resp(200).request, response: resp(200) }, 0);
  s.finish("t", "r1", resp(201));
  expect(useResponses.getState().byTab.t).toMatchObject({ past: { id: 7 } });
  useResponses.getState().latest("t");
  expect(useResponses.getState().byTab.t).toMatchObject({ status: "done", runId: "r1", response: { status: 201 } });

  s.start("t", "r2", 0);
  s.showPast("t", { summary, request: resp(200).request, response: resp(200) }, 0);
  s.fail("t", "r2", { kind: "network", message: "down" });
  useResponses.getState().latest("t");
  expect(useResponses.getState().byTab.t).toMatchObject({ status: "error", runId: "r2" });
});

test("Run again only applies to the past run's own file", () => {
  const past = { id: 1, atMs: 1, env: null, path: "/r/a.http" };
  expect(canRunAgain(past, "/r/a.http")).toBe(true);
  expect(canRunAgain(past, "/r/other.http")).toBe(false);
  expect(canRunAgain({ ...past, path: null }, "/r/a.http")).toBe(false);
});
