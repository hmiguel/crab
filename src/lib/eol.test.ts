import { expect, test } from "vitest";
import { detectEol, fromLf, toLf } from "./eol";

test("CRLF files round-trip through LF editing", () => {
  const disk = "GET https://x.test\r\nAccept: */*\r\n";
  expect(detectEol(disk)).toBe("\r\n");
  expect(toLf(disk)).toBe("GET https://x.test\nAccept: */*\n");
  expect(fromLf(toLf(disk), "\r\n")).toBe(disk);
  expect(detectEol("a\nb")).toBe("\n");
  expect(fromLf("a\nb", "\n")).toBe("a\nb");
});
