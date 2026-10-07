import { expect, test } from "vitest";
import { formatBytes, formatMs, formatRequest, prettyBody, reindentJson, statusClass } from "./format";

test("reindentJson keeps big integers and string contents intact", () => {
  const input = '{"id":12345678901234567890,"a":[1,2],"e":{},"s":"x, y: {z} \\"q\\""}';
  expect(reindentJson(input)).toBe(
    '{\n  "id": 12345678901234567890,\n  "a": [\n    1,\n    2\n  ],\n  "e": {},\n  "s": "x, y: {z} \\"q\\""\n}',
  );
});

test("prettyBody detects JSON by content type or shape", () => {
  expect(prettyBody("application/json; charset=utf-8", '{"a":1}')).toEqual({ text: '{\n  "a": 1\n}', lang: "json" });
  expect(prettyBody("application/problem+json", "[1]")).toEqual({ text: "[\n  1\n]", lang: "json" });
  expect(prettyBody(null, "[1]").lang).toBe("json");
  expect(prettyBody("application/json", "not json")).toEqual({ text: "not json", lang: "text" });
  expect(prettyBody("text/plain", "hello")).toEqual({ text: "hello", lang: "text" });
});

test("formatting helpers", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(2048)).toBe("2.0 KB");
  expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  expect(formatMs(12.4)).toBe("12 ms");
  expect(formatMs(1534)).toBe("1.53 s");
  expect([101, 204, 301, 404, 503].map(statusClass)).toEqual(["info", "ok", "redirect", "client-error", "server-error"]);
});

test("formatRequest renders method, url, headers and body", () => {
  const req = { method: "POST", url: "https://x.test", headers: [{ name: "A", value: "1" }], body: "hi" };
  expect(formatRequest(req)).toBe("POST https://x.test\nA: 1\n\nhi");
  expect(formatRequest({ ...req, body: null })).toBe("POST https://x.test\nA: 1");
});
