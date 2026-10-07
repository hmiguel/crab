import { describe, expect, it } from "vitest";
import type { RequestBlock } from "../api";
import { lineAtOffset, requestIndexAt } from "./outline";

const req = (startLine: number, endLine: number): RequestBlock => ({
  name: null, method: "GET", url: "http://x", headers: [], body: null, span: { startLine, endLine }, requestLine: startLine + 1,
});

describe("lineAtOffset", () => {
  it("counts newlines before the offset (0-based)", () => {
    const text = "a\nbb\nccc";
    expect(lineAtOffset(text, 0)).toBe(0);
    expect(lineAtOffset(text, 1)).toBe(0); // end of line 0
    expect(lineAtOffset(text, 2)).toBe(1);
    expect(lineAtOffset(text, 5)).toBe(2);
  });

  it("clamps offsets past the end", () => {
    expect(lineAtOffset("a\nb", 99)).toBe(1);
  });
});

describe("requestIndexAt", () => {
  const requests = [req(2, 5), req(6, 12)];

  it("finds the request whose span contains the line, bounds included", () => {
    expect(requestIndexAt(requests, 2)).toBe(0);
    expect(requestIndexAt(requests, 5)).toBe(0);
    expect(requestIndexAt(requests, 6)).toBe(1);
    expect(requestIndexAt(requests, 12)).toBe(1);
  });

  it("returns null outside every request (e.g. file variables above the first ###)", () => {
    expect(requestIndexAt(requests, 0)).toBeNull();
    expect(requestIndexAt(requests, 13)).toBeNull();
    expect(requestIndexAt([], 0)).toBeNull();
  });
});
