import { create } from "zustand";
import type { CrabError, ResponseData } from "../api";

export type RunState =
  | { status: "running"; runId: string; line: number }
  | { status: "done"; runId: string; line: number; response: ResponseData }
  | { status: "error"; runId: string; line: number; error: CrabError };

type ResponsesState = {
  /** Latest run per tab. */
  byTab: Record<string, RunState>;
  start(tabId: string, runId: string, line: number): void;
  finish(tabId: string, runId: string, response: ResponseData): void;
  fail(tabId: string, runId: string, error: CrabError): void;
  clear(tabId: string): void;
};

export const useResponses = create<ResponsesState>((set, get) => {
  /** Only the run that is still current for the tab may settle it. */
  const settle = (tabId: string, runId: string, next: (cur: RunState) => RunState) => {
    const cur = get().byTab[tabId];
    if (cur?.runId === runId) set((s) => ({ byTab: { ...s.byTab, [tabId]: next(cur) } }));
  };
  return {
    byTab: {},
    start: (tabId, runId, line) => set((s) => ({ byTab: { ...s.byTab, [tabId]: { status: "running", runId, line } } })),
    finish: (tabId, runId, response) => settle(tabId, runId, (c) => ({ status: "done", runId, line: c.line, response })),
    fail: (tabId, runId, error) => settle(tabId, runId, (c) => ({ status: "error", runId, line: c.line, error })),
    clear: (tabId) =>
      set((s) => {
        const { [tabId]: _removed, ...byTab } = s.byTab;
        return { byTab };
      }),
  };
});
