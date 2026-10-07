import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { saveState: vi.fn().mockResolvedValue(undefined), watchRoots: vi.fn().mockResolvedValue(undefined) },
}));

import { handleFsChanged } from "./fs-events";
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
