import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { loadState: vi.fn(), saveState: vi.fn().mockResolvedValue(undefined), readTextFile: vi.fn() },
}));

import { api } from "../api";
import { restoreSession, startSessionAutosave, toSession, useLayout } from "./session";
import { useTabs } from "./tabs";

beforeEach(() => {
  vi.clearAllMocks();
  useTabs.setState({ tabs: [], activeId: null });
  useLayout.setState({ dock: "right" });
});

test("toSession stores drafts only for dirty tabs", () => {
  const s = useTabs.getState();
  const clean = s.addTab({ path: "/a.http", text: "x", savedText: "x", eol: "\n", cursor: 1, scrollTop: 5 });
  s.addTab({ path: "/b.http", text: "new", savedText: "old", eol: "\n", cursor: 0, scrollTop: 0 });
  const { tabs } = useTabs.getState();
  expect(toSession(tabs, clean, "bottom")).toEqual({
    version: 1,
    dock: "bottom",
    sidebarTab: "workspace",
    activePath: "/a.http",
    tabs: [
      { path: "/a.http", draft: null, cursor: 1, scrollTop: 5 },
      { path: "/b.http", draft: "new", cursor: 0, scrollTop: 0 },
    ],
  });
});

test("restoreSession reopens tabs, keeps drafts and skips missing clean files", async () => {
  vi.mocked(api.loadState).mockResolvedValue({
    version: 1,
    dock: "bottom",
    activePath: "/r/b.http",
    tabs: [
      { path: "/r/a.http", draft: null, cursor: 3, scrollTop: 10 },
      { path: "/r/b.http", draft: "draft\n", cursor: 0, scrollTop: 0 },
      { path: "/r/gone.http", draft: null, cursor: 0, scrollTop: 0 },
    ],
  });
  vi.mocked(api.readTextFile).mockImplementation(async (p: string) => {
    if (p === "/r/gone.http") throw { kind: "io", message: "missing" };
    return "disk\r\n";
  });
  await restoreSession();
  const { tabs, activeId } = useTabs.getState();
  expect(tabs.map((t) => t.path)).toEqual(["/r/a.http", "/r/b.http"]);
  expect(tabs[0]).toMatchObject({ text: "disk\n", savedText: "disk\n", eol: "\r\n", cursor: 3, scrollTop: 10 });
  expect(tabs[1]).toMatchObject({ text: "draft\n", savedText: "disk\n" });
  expect(activeId).toBe(tabs[1].id);
  expect(useLayout.getState().dock).toBe("bottom");
});

test("autosave is debounced to 1 s and flush saves immediately", async () => {
  vi.useFakeTimers();
  const autosave = startSessionAutosave();
  useTabs.getState().addTab({ path: "/a.http", text: "", savedText: "", eol: "\n", cursor: 0, scrollTop: 0 });
  useLayout.getState().toggleDock();
  expect(api.saveState).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(api.saveState).toHaveBeenCalledTimes(1);
  await autosave.flush();
  expect(api.saveState).toHaveBeenCalledTimes(2);
  autosave.stop();
  vi.useRealTimers();
});

test("toSession and restore keep the sidebar tab", () => {
  expect(toSession([], null, "right", "history")).toMatchObject({ sidebarTab: "history" });
});
