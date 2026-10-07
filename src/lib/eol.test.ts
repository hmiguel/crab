import { expect, test } from "vitest";
import { decodeDisk, detectEol, encodeDisk, fromLf, toLf } from "./eol";

test("CRLF files round-trip through LF editing", () => {
  const disk = "GET https://x.test\r\nAccept: */*\r\n";
  expect(detectEol(disk)).toBe("\r\n");
  expect(toLf(disk)).toBe("GET https://x.test\nAccept: */*\n");
  expect(fromLf(toLf(disk), "\r\n")).toBe(disk);
  expect(detectEol("a\nb")).toBe("\n");
  expect(fromLf("a\nb", "\n")).toBe("a\nb");
});

test("a UTF-8 BOM is kept out of the editor text and restored on save", () => {
  const disk = "﻿GET https://x.test\r\n";
  const d = decodeDisk(disk);
  expect(d).toEqual({ text: "GET https://x.test\n", eol: "\r\n", bom: true });
  expect(encodeDisk(d.text, d.eol, d.bom)).toBe(disk);
  expect(decodeDisk("a\n")).toEqual({ text: "a\n", eol: "\n", bom: false });
});
