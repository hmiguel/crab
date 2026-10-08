import { create } from "zustand";
import type { CrabError, PastRun, ResponseData } from "../api";
import { samePath } from "../lib/paths";

/** Shown instead of a live result while the user looks at a run from history. */
export type PastInfo = { id: number; atMs: number; env: string | null; path: string | null };

/** "Run again" only makes sense in the past run's own file; elsewhere it would run an unrelated request. */
export const canRunAgain = (past: PastInfo, tabPath: string) => past.path !== null && samePath(past.path, tabPath);

export type RunState =
  | { status: "running"; runId: string; line: number }
  | { status: "done"; runId: string; line: number; response: ResponseData; past?: PastInfo }
  | { status: "error"; runId: string; line: number; error: CrabError; past?: PastInfo };

type ResponsesState = {
  /** Latest run per tab, or a past run being viewed. */
  byTab: Record<string, RunState>;
  /** The live state hidden while a past run is shown, restored by `latest`. */
  live: Record<string, RunState | undefined>;
  start(tabId: string, runId: string, line: number): void;
  finish(tabId: string, runId: string, response: ResponseData): void;
  fail(tabId: string, runId: string, error: CrabError): void;
  clear(tabId: string): void;
  showPast(tabId: string, run: PastRun, line: number): void;
  latest(tabId: string): void;
};

const without = <T,>(rec: Record<string, T>, key: string) => {
  const { [key]: _removed, ...rest } = rec;
  return rest;
};

export const useResponses = create<ResponsesState>((set, get) => {
  /** Only the run that is still current for the tab may settle it. */
  const settle = (tabId: string, runId: string, next: (cur: RunState) => RunState) => {
    const cur = get().byTab[tabId];
    if (cur?.runId === runId) return set((s) => ({ byTab: { ...s.byTab, [tabId]: next(cur) } }));
    // A past run is on screen: the live run settles in the stash, so Latest shows its result.
    const stashed = get().live[tabId];
    if (stashed?.runId === runId) set((s) => ({ live: { ...s.live, [tabId]: next(stashed) } }));
  };
  return {
    byTab: {},
    live: {},
    start: (tabId, runId, line) =>
      set((s) => ({ byTab: { ...s.byTab, [tabId]: { status: "running", runId, line } }, live: without(s.live, tabId) })),
    finish: (tabId, runId, response) => settle(tabId, runId, (c) => ({ status: "done", runId, line: c.line, response })),
    fail: (tabId, runId, error) => settle(tabId, runId, (c) => ({ status: "error", runId, line: c.line, error })),
    clear: (tabId) => set((s) => ({ byTab: without(s.byTab, tabId), live: without(s.live, tabId) })),
    showPast: (tabId, run, line) =>
      set((s) => {
        const cur = s.byTab[tabId];
        const live = cur && !("past" in cur && cur.past) ? { ...s.live, [tabId]: cur } : s.live;
        const past: PastInfo = { id: run.summary.id, atMs: run.summary.atMs, env: run.summary.env, path: run.summary.path };
        const runId = `past-${run.summary.id}`;
        const next: RunState = run.response
          ? { status: "done", runId, line, response: run.response, past }
          : {
              status: "error", runId, line, past,
              error: { kind: run.summary.errorKind ?? "network", message: run.summary.errorMessage ?? "" },
            };
        return { byTab: { ...s.byTab, [tabId]: next }, live };
      }),
    latest: (tabId) =>
      set((s) => {
        const live = s.live[tabId];
        return { byTab: live ? { ...s.byTab, [tabId]: live } : without(s.byTab, tabId), live: without(s.live, tabId) };
      }),
  };
});
