import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { readTextFile: vi.fn(), writeTextFile: vi.fn().mockResolvedValue(undefined) },
}));

import { api } from "../api";
import { isDirty, useTabs } from "./tabs";

const blank = { savedText: "", eol: "\n" as const, cursor: 0, scrollTop: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  useTabs.setState({ tabs: [], activeId: null });
});

test("openFile reads once and re-focuses the same file under another spelling", async () => {
  vi.mocked(api.readTextFile).mockResolvedValue("GET https://x.test\r\n");
  await useTabs.getState().openFile("C:\\repo\\a.http");
  await useTabs.getState().openFile("c:/repo/a.http", 3);
  const { tabs, activeId } = useTabs.getState();
  expect(tabs).toHaveLength(1);
  expect(api.readTextFile).toHaveBeenCalledTimes(1);
  expect(tabs[0]).toMatchObject({ title: "a.http", text: "GET https://x.test\n", eol: "\r\n", revealLine: 3 });
  expect(activeId).toBe(tabs[0].id);
});

test("save writes the original line endings and clears dirty", async () => {
  vi.mocked(api.readTextFile).mockResolvedValue("a\r\nb\r\n");
  await useTabs.getState().openFile("/r/a.http");
  const id = useTabs.getState().tabs[0].id;
  useTabs.getState().setText(id, "a\nb\nc\n");
  expect(isDirty(useTabs.getState().tabs[0])).toBe(true);
  await useTabs.getState().save(id);
  expect(api.writeTextFile).toHaveBeenCalledWith("/r/a.http", "a\r\nb\r\nc\r\n");
  expect(isDirty(useTabs.getState().tabs[0])).toBe(false);
});

test("external change reloads clean tabs and flags dirty ones", async () => {
  vi.mocked(api.readTextFile).mockResolvedValueOnce("one\n").mockResolvedValueOnce("two\n");
  await useTabs.getState().openFile("/r/a.http");
  await useTabs.getState().onDiskChange("/r/a.http");
  expect(useTabs.getState().tabs[0].text).toBe("two\n");

  const id = useTabs.getState().tabs[0].id;
  useTabs.getState().setText(id, "mine\n");
  vi.mocked(api.readTextFile).mockResolvedValueOnce("three\n");
  await useTabs.getState().onDiskChange("/r/a.http");
  expect(useTabs.getState().tabs[0]).toMatchObject({ text: "mine\n", externallyChanged: true });

  vi.mocked(api.readTextFile).mockResolvedValueOnce("three\n");
  await useTabs.getState().reloadFromDisk(id);
  expect(useTabs.getState().tabs[0]).toMatchObject({ text: "three\n", savedText: "three\n", externallyChanged: false });
});

test("closing the active tab activates its right neighbour, then the left one", () => {
  const s = useTabs.getState();
  const a = s.addTab({ path: "/a.http", text: "", ...blank });
  const b = s.addTab({ path: "/b.http", text: "", ...blank });
  const c = s.addTab({ path: "/c.http", text: "", ...blank });
  s.setActive(b);
  s.closeTab(b);
  expect(useTabs.getState().activeId).toBe(c);
  useTabs.getState().closeTab(c);
  expect(useTabs.getState().activeId).toBe(a);
});

test("BOM files open without the BOM in the text and keep it on save", async () => {
  vi.mocked(api.readTextFile).mockResolvedValue("﻿GET https://x.test\r\n");
  await useTabs.getState().openFile("/r/bom.http");
  const tab = useTabs.getState().tabs[0];
  expect(tab.text).toBe("GET https://x.test\n");
  useTabs.getState().setText(tab.id, "POST https://x.test\n");
  await useTabs.getState().save(tab.id);
  expect(api.writeTextFile).toHaveBeenCalledWith("/r/bom.http", "﻿POST https://x.test\r\n");
});
