import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { readTextFile: vi.fn(), parseText: vi.fn() },
}));

import { api, type RequestBlock } from "../api";
import { useOutline } from "./outline";
import { searchItems, useSearchIndex } from "./search-index";
import { useWorkspace } from "./workspace";

const req = (method: string, url: string, requestLine: number, name: string | null = null): RequestBlock => ({
  name, method, url, headers: [], body: null, span: { startLine: requestLine, endLine: requestLine }, requestLine,
});

const disk: Record<string, RequestBlock[]> = {
  "/r/a.http": [req("GET", "https://x/users", 0, "List users")],
  "/r/sub/b.rest": [req("POST", "https://x/orders", 3)],
};

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ folders: [{ id: "f", name: "W", roots: ["/r"] }], files: { "/r": ["a.http", "sub/b.rest"] } });
  useOutline.setState({ byPath: {} });
  useSearchIndex.setState({ parsed: {}, indexing: false });
  vi.mocked(api.readTextFile).mockImplementation(async (p) => {
    if (!(p in disk)) throw new Error("gone");
    return p;
  });
  vi.mocked(api.parseText).mockImplementation(async (text) => ({ variables: [], requests: disk[text], diagnostics: [] }));
});

const current = () => searchItems(useWorkspace.getState(), useSearchIndex.getState().parsed, useOutline.getState().byPath);

test("indexes every file and its requests", async () => {
  await useSearchIndex.getState().ensure();
  expect(current()).toEqual([
    { kind: "file", path: "/r/a.http", display: "r/a.http" },
    { kind: "request", path: "/r/a.http", display: "r/a.http", method: "GET", label: "List users", url: "https://x/users", requestLine: 0 },
    { kind: "file", path: "/r/sub/b.rest", display: "r/sub/b.rest" },
    { kind: "request", path: "/r/sub/b.rest", display: "r/sub/b.rest", method: "POST", label: "https://x/orders", url: "https://x/orders", requestLine: 3 },
  ]);
  expect(useSearchIndex.getState().indexing).toBe(false);
});

test("ensure only reads files it hasn't parsed yet", async () => {
  await useSearchIndex.getState().ensure();
  await useSearchIndex.getState().ensure();
  expect(api.readTextFile).toHaveBeenCalledTimes(2);
});

test("open files use the editor outline instead of the disk", async () => {
  await useSearchIndex.getState().ensure();
  useOutline.getState().set("/r/a.http", [req("DELETE", "https://x/users/1", 5, "Unsaved")]);
  const reqs = current().filter((i) => i.kind === "request" && i.path === "/r/a.http");
  expect(reqs).toMatchObject([{ method: "DELETE", label: "Unsaved", requestLine: 5 }]);
});

test("invalidate re-reads changed files on the next ensure", async () => {
  await useSearchIndex.getState().ensure();
  disk["/r/a.http"] = [req("PUT", "https://x/users", 1)];
  useSearchIndex.getState().invalidate(["/r/a.http"]);
  await useSearchIndex.getState().ensure();
  expect(current().find((i) => i.kind === "request" && i.path === "/r/a.http")).toMatchObject({ method: "PUT" });
});

test("a file that fails to read still lists, without requests", async () => {
  useWorkspace.setState({ files: { "/r": ["a.http", "missing.http"] } });
  await useSearchIndex.getState().ensure();
  expect(current().filter((i) => i.path === "/r/missing.http")).toEqual([
    { kind: "file", path: "/r/missing.http", display: "r/missing.http" },
  ]);
});

test("files no longer in the workspace are not listed", async () => {
  await useSearchIndex.getState().ensure();
  useWorkspace.setState({ files: { "/r": ["a.http"] } });
  expect(current().some((i) => i.path === "/r/sub/b.rest")).toBe(false);
});
