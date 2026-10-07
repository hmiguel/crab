import { expect, test } from "vitest";
import { shortcutLabel } from "./keys";

test("shortcut labels use ⌘ on macOS and Ctrl+ elsewhere", () => {
  expect(shortcutLabel("Enter", "Macintosh; Intel Mac OS X 10_15_7")).toBe("⌘Enter");
  expect(shortcutLabel("W", "Windows NT 10.0; Win64; x64")).toBe("Ctrl+W");
});
