import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { toCrabError } from "./api";

test("passes through structured backend errors", () => {
  expect(toCrabError({ kind: "timeout", message: "Request timed out" })).toEqual({ kind: "timeout", message: "Request timed out" });
});

test("wraps strings and Error objects as io errors", () => {
  expect(toCrabError("boom")).toEqual({ kind: "io", message: "boom" });
  expect(toCrabError(new Error("bad"))).toEqual({ kind: "io", message: "bad" });
});
