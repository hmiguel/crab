import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { absolutizeLinks, buildLlmsFull } from "./website-llms.mjs";

const root = new URL("..", import.meta.url).pathname;

test("relative README links become absolute GitHub links; absolute links and anchors stay", () => {
  const md = "[a](LICENSE-MIT) [b](../../releases) [c](https://x.dev) [d](#license) ![i](docs/assets/crab-icon.png)";
  expect(absolutizeLinks(md)).toBe(
    "[a](https://github.com/hmiguel/crab/blob/main/LICENSE-MIT) [b](https://github.com/hmiguel/crab/releases) [c](https://x.dev) [d](#license) ![i](https://github.com/hmiguel/crab/blob/main/docs/assets/crab-icon.png)",
  );
});

test("website/llms-full.txt is up to date (run: pnpm site:llms)", () => {
  expect(readFileSync(`${root}website/llms-full.txt`, "utf8")).toBe(buildLlmsFull(root));
});
