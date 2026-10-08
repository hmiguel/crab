import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { listEnvironments: vi.fn() },
}));

import { api } from "../api";
import { colorOf, isDanger, useEnvironments } from "./environments";

beforeEach(() => {
  vi.clearAllMocks();
  useEnvironments.getState().load(undefined);
  useEnvironments.setState({ names: [] });
});

test("defaults: nothing selected, confirmation on", () => {
  expect(useEnvironments.getState().settings()).toEqual({ selected: null, colors: {}, confirmDanger: true });
});

test("load fills missing fields with defaults", () => {
  useEnvironments.getState().load({ selected: "dev" });
  expect(useEnvironments.getState().settings()).toEqual({ selected: "dev", colors: {}, confirmDanger: true });
});

test("production-like names are red unless a colour is set", () => {
  expect(colorOf({ colors: {} }, "prod")).toBe("red");
  expect(colorOf({ colors: {} }, "Production-EU")).toBe("red");
  expect(colorOf({ colors: {} }, "live")).toBe("red");
  expect(colorOf({ colors: {} }, "dev")).toBe("none");
  expect(colorOf({ colors: {} }, null)).toBe("none");
  expect(colorOf({ colors: { prod: "none" } }, "prod")).toBe("none");
  expect(isDanger({ colors: { dev: "red" } }, "dev")).toBe(true);
  expect(isDanger({ colors: { prod: "amber" } }, "prod")).toBe(false);
});

test("select, setColor and setConfirmDanger update settings", () => {
  const s = useEnvironments.getState();
  s.select("prod");
  s.setColor("prod", "amber");
  s.setConfirmDanger(false);
  expect(useEnvironments.getState().settings()).toEqual({ selected: "prod", colors: { prod: "amber" }, confirmDanger: false });
});

test("refresh loads names and keeps a selection that disappeared", async () => {
  useEnvironments.getState().select("old");
  vi.mocked(api.listEnvironments).mockResolvedValue(["dev", "prod"]);
  await useEnvironments.getState().refresh(["/r"]);
  expect(api.listEnvironments).toHaveBeenCalledWith(["/r"]);
  expect(useEnvironments.getState().names).toEqual(["dev", "prod"]);
  expect(useEnvironments.getState().selected).toBe("old");
});

test("refresh failures leave the names empty", async () => {
  vi.mocked(api.listEnvironments).mockRejectedValue(new Error("boom"));
  await useEnvironments.getState().refresh(["/r"]);
  expect(useEnvironments.getState().names).toEqual([]);
});
