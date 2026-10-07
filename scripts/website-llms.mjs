// Builds website/llms-full.txt (the whole README and changelog as one Markdown file for LLMs).
//
//   node scripts/website-llms.mjs        regenerate it
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "https://github.com/hmiguel/crab";

/** Rewrites relative Markdown links (README-relative) to absolute GitHub URLs. */
export function absolutizeLinks(md) {
  return md.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (all, open, href, close) => {
    if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return all;
    if (href.startsWith("../../")) return open + `${REPO}/${href.slice(6)}` + close;
    return open + `${REPO}/blob/main/${href.replace(/^\.\//, "")}` + close;
  });
}

export function buildLlmsFull(root) {
  const readme = readFileSync(join(root, "README.md"), "utf8")
    .replace(/^<p align="center">.*<\/p>\n+/m, "") // logo
    .replace(/^\[!\[.*\n/gm, "") // badges
    .replace(/\n{3,}/g, "\n\n");
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8").replace(/^# Changelog\n/, "");
  return [
    "<!-- Generated from README.md and CHANGELOG.md by scripts/website-llms.mjs. Do not edit. -->",
    `Website: https://crab-ekq.pages.dev/ · Source: ${REPO}`,
    "",
    absolutizeLinks(readme).trim(),
    "",
    "# Changelog",
    absolutizeLinks(changelog).trim(),
    "",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  writeFileSync(join(root, "website/llms-full.txt"), buildLlmsFull(root));
  console.log("Wrote website/llms-full.txt");
}
