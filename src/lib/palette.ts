import type { RunSummary } from "../api";
import type { SearchItem } from "../state/search-index";
import type { Ranked } from "./fuzzy";

export const PAST_RUNS_LIMIT = 8;

export type PaletteEntry = { kind: "item"; ranked: Ranked<SearchItem> } | { kind: "run"; run: RunSummary };

/** One list for keyboard navigation: ranked files and requests, then past runs. */
export function paletteEntries(results: Ranked<SearchItem>[], runs: RunSummary[]): PaletteEntry[] {
  return [
    ...results.map((ranked): PaletteEntry => ({ kind: "item", ranked })),
    ...runs.slice(0, PAST_RUNS_LIMIT).map((run): PaletteEntry => ({ kind: "run", run })),
  ];
}
