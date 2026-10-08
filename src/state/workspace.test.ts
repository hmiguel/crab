import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: {
    loadState: vi.fn(),
    saveState: vi.fn().mockResolvedValue(undefined),
    watchRoots: vi.fn().mockResolvedValue(undefined),
    listHttpFiles: vi.fn(),
    listEnvironments: vi.fn().mockResolvedValue([]),
  },
}));

import { api } from "../api";
import { useEnvironments } from "./environments";
import { useWorkspace } from "./workspace";

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ folders: [], files: {}, rootErrors: {} });
});

test("load creates a default folder when nothing is saved", async () => {
  vi.mocked(api.loadState).mockResolvedValue(null);
  await useWorkspace.getState().load();
  expect(useWorkspace.getState().folders).toEqual([{ id: expect.any(String), name: "Workspace", roots: [] }]);
});

test("load restores saved folders and scans their roots", async () => {
  vi.mocked(api.loadState).mockResolvedValue({ version: 1, folders: [{ id: "f1", name: "APIs", roots: ["/r"] }] });
  vi.mocked(api.listHttpFiles).mockResolvedValue(["a.http"]);
  await useWorkspace.getState().load();
  expect(useWorkspace.getState().files["/r"]).toEqual(["a.http"]);
  expect(api.watchRoots).toHaveBeenCalledWith(["/r"]);
});

test("addRoots dedupes Windows paths, persists, watches and lists files", async () => {
  vi.mocked(api.listHttpFiles).mockResolvedValue(["a.http"]);
  useWorkspace.setState({ folders: [{ id: "f1", name: "W", roots: ["C:\\repo"] }] });
  await useWorkspace.getState().addRoots("f1", ["c:/repo", "D:\\other"]);
  const folders = useWorkspace.getState().folders;
  expect(folders[0].roots).toEqual(["C:\\repo", "D:\\other"]);
  expect(api.saveState).toHaveBeenCalledWith("workspace", { version: 1, folders, environments: expect.any(Object) });
  expect(api.watchRoots).toHaveBeenLastCalledWith(["C:\\repo", "D:\\other"]);
  expect(api.listHttpFiles).toHaveBeenCalledTimes(1);
  expect(useWorkspace.getState().files["D:\\other"]).toEqual(["a.http"]);
});

test("refreshRoot records an error for a missing folder", async () => {
  vi.mocked(api.listHttpFiles).mockRejectedValue({ kind: "io", message: "Folder not found: /gone" });
  await useWorkspace.getState().refreshRoot("/gone");
  expect(useWorkspace.getState().rootErrors["/gone"]).toBe("Folder not found: /gone");
  expect(useWorkspace.getState().files["/gone"]).toEqual([]);
});

test("load restores environment settings and saving includes them", async () => {
  vi.mocked(api.loadState).mockResolvedValue({
    version: 1,
    folders: [{ id: "f1", name: "W", roots: [] }],
    environments: { selected: "prod", colors: { prod: "amber" }, confirmDanger: false },
  });
  await useWorkspace.getState().load();
  expect(useEnvironments.getState().settings()).toEqual({ selected: "prod", colors: { prod: "amber" }, confirmDanger: false });
  vi.mocked(api.saveState).mockClear();
  useEnvironments.getState().select("dev");
  expect(api.saveState).toHaveBeenCalledWith("workspace", {
    version: 1,
    folders: [{ id: "f1", name: "W", roots: [] }],
    environments: { selected: "dev", colors: { prod: "amber" }, confirmDanger: false },
  });
});
