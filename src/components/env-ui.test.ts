import { expect, test } from "vitest";
import { envCssVars } from "./EnvAccent";

test("no colour keeps the bar invisible and the ▶ markers coral", () => {
  expect(envCssVars("none")).toEqual({ bar: "transparent", marker: "var(--accent)" });
});

test("a colour drives both the bar and the markers", () => {
  expect(envCssVars("red")).toEqual({ bar: "var(--env-red)", marker: "var(--env-red)" });
});
