import { expect, test } from "vitest";
import type { RunSummary } from "../api";
import type { SearchItem } from "../state/search-index";
import { PAST_RUNS_LIMIT, paletteEntries } from "./palette";

const file: SearchItem = { kind: "file", path: "/r/a.http", display: "r/a.http" };
const run = (id: number) => ({ id }) as RunSummary;

test("past runs follow the ranked items and are capped", () => {
  const runs = Array.from({ length: 12 }, (_, i) => run(i));
  const entries = paletteEntries([{ item: file, viaContent: false }], runs);
  expect(entries[0]).toEqual({ kind: "item", ranked: { item: file, viaContent: false } });
  expect(entries.slice(1).every((e) => e.kind === "run")).toBe(true);
  expect(entries).toHaveLength(1 + PAST_RUNS_LIMIT);
});
