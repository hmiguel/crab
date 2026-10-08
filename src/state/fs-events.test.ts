import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: {
    saveState: vi.fn().mockResolvedValue(undefined),
    watchRoots: vi.fn().mockResolvedValue(undefined),
    listEnvironments: vi.fn().mockResolvedValue({ names: [], warnings: [] }),
  },
}));

import { useEnvironments } from "./environments";
import { handleFsChanged } from "./fs-events";
import { useSearchIndex } from "./search-index";
import { useTabs } from "./tabs";
import { useWorkspace } from "./workspace";

const refreshRoot = vi.fn().mockResolvedValue(undefined);
const onDiskChange = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ folders: [{ id: "f", name: "W", roots: ["/r"] }], refreshRoot });
  useTabs.setState({ onDiskChange });
});

test("rescans affected roots once and notifies tabs about .http changes only", () => {
  vi.useFakeTimers();
  handleFsChanged(["/r/x/new.http", "/r/target/foo.o", "/r/newdir", "/other/a.http"]);
  expect(onDiskChange.mock.calls.map((c) => c[0])).toEqual(["/r/x/new.http", "/other/a.http"]);
  vi.advanceTimersByTime(300);
  expect(refreshRoot).toHaveBeenCalledTimes(1);
  expect(refreshRoot).toHaveBeenCalledWith("/r");
  vi.useRealTimers();
});

test("drops changed .http files from the search index", () => {
  useSearchIndex.setState({ parsed: { "/r/a.http": [], "/r/b.http": [] } });
  handleFsChanged(["/r/a.http", "/r/target/foo.o"]);
  expect(Object.keys(useSearchIndex.getState().parsed)).toEqual(["/r/b.http"]);
});

test("env file changes refresh the environment names once", () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined);
  useEnvironments.setState({ refresh });
  handleFsChanged(["/r/http-client.env.json", "/r/sub/.env", "/r/package.json"]);
  vi.advanceTimersByTime(300);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledWith(["/r"]);
  vi.useRealTimers();
});
