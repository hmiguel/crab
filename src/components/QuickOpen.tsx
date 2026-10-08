import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { api, type RunSummary } from "../api";
import { debounce } from "../lib/debounce";
import { dayLabel, timeLabel } from "../lib/format";
import { rankItems, snippet, type Ranked } from "../lib/fuzzy";
import { PAST_RUNS_LIMIT, paletteEntries, type PaletteEntry } from "../lib/palette";
import { useOutline } from "../state/outline";
import { searchItems, useSearchIndex, type SearchItem } from "../state/search-index";
import { useTabs } from "../state/tabs";
import { useWorkspace } from "../state/workspace";
import { showError } from "../ui/actions";
import { openPastRun } from "../ui/history-actions";

export const useQuickOpen = create<{ open: boolean }>(() => ({ open: false }));
export const openQuickOpen = () => useQuickOpen.setState({ open: true });
const close = () => useQuickOpen.setState({ open: false });

const itemLabel = (i: SearchItem) => (i.kind === "file" ? i.display : i.label);
const itemFields = (i: SearchItem) => (i.kind === "file" ? [i.display] : [i.label, i.url, `${i.method} ${i.label}`, i.display]);
const entryKey = (i: SearchItem) => (i.kind === "file" ? i.path : `${i.path}:${i.requestLine}`);
const itemContent = (i: SearchItem) => (i.kind === "request" ? i.content : "");

/** ⌘P palette: fuzzy-find files and requests across the whole workspace, plus matching past runs. */
export function QuickOpen() {
  const open = useQuickOpen((s) => s.open);
  return open ? <Palette /> : null;
}

function Palette() {
  const folders = useWorkspace((s) => s.folders);
  const files = useWorkspace((s) => s.files);
  const parsed = useSearchIndex((s) => s.parsed);
  const indexing = useSearchIndex((s) => s.indexing);
  const outline = useOutline((s) => s.byPath);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const selectedRow = useRef<HTMLLIElement>(null);

  useEffect(() => { void useSearchIndex.getState().ensure(); }, [files]);

  const items = useMemo(() => searchItems({ folders, files }, parsed, outline), [folders, files, parsed, outline]);
  const q = query.trim();
  const results = useMemo(
    (): Ranked<SearchItem>[] => (q === ""
      ? items.filter((i) => i.kind === "file").slice(0, 50).map((item) => ({ item, viaContent: false }))
      : rankItems(q, items, { fields: itemFields, label: itemLabel, content: itemContent })),
    [items, q],
  );

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const searchRuns = useMemo(
    () => debounce((text: string) => {
      api.historyList({ query: text, limit: PAST_RUNS_LIMIT }).then(setRuns, () => setRuns([]));
    }, 150),
    [],
  );
  useEffect(() => {
    if (q.length >= 3) searchRuns(q);
    else {
      searchRuns.cancel();
      setRuns([]);
    }
    return () => searchRuns.cancel();
  }, [q, searchRuns]);
  const entries = useMemo(() => paletteEntries(results, runs), [results, runs]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => selectedRow.current?.scrollIntoView({ block: "nearest" }), [selected]);

  const choose = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    close();
    if (entry.kind === "run") return void openPastRun(entry.run.id).catch(showError);
    const item = entry.ranked.item;
    useTabs.getState().openFile(item.path, item.kind === "request" ? item.requestLine : undefined).catch(showError);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = entries.length;
    if (e.key === "ArrowDown" && n) setSelected((s) => (s + 1) % n);
    else if (e.key === "ArrowUp" && n) setSelected((s) => (s - 1 + n) % n);
    else if (e.key === "Enter") choose(entries[selected]);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    // Keep Escape from also cancelling a running request in the global handler.
    e.stopPropagation();
  };

  return (
    <div className="quick-open-backdrop" onMouseDown={close}>
      <div className="quick-open" role="dialog" aria-label="Quick open" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Search files and requests"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="quick-open-results" role="listbox">
          {entries.map((entry, i) => (
            <Fragment key={entry.kind === "run" ? `run-${entry.run.id}` : entryKey(entry.ranked.item)}>
              {entry.kind === "run" && entries[i - 1]?.kind !== "run" && (
                <li className="quick-open-group" role="presentation">Past runs</li>
              )}
              <li
                ref={i === selected ? selectedRow : undefined}
                role="option"
                aria-selected={i === selected}
                className={`row${i === selected ? " selected" : ""}${entry.kind === "item" && entry.ranked.viaContent ? " with-snippet" : ""}`}
                onMouseMove={() => setSelected(i)}
                onClick={() => choose(entry)}
              >
                {entry.kind === "run" ? (
                  <>
                    <span className={`method m-${entry.run.method.toLowerCase()}`}>{entry.run.method}</span>
                    <span className="label">{entry.run.name ?? entry.run.url}</span>
                    <span className="where">{dayLabel(entry.run.atMs)} {timeLabel(entry.run.atMs)} · {entry.run.status ?? entry.run.errorKind}</span>
                  </>
                ) : entry.ranked.item.kind === "request" ? (
                  <>
                    <span className={`method m-${entry.ranked.item.method.toLowerCase()}`}>{entry.ranked.item.method}</span>
                    <span className="label">{entry.ranked.item.label}</span>
                    <span className="where">{entry.ranked.item.display}</span>
                    {entry.ranked.viaContent && <span className="snippet">{snippet(q, entry.ranked.item.content)}</span>}
                  </>
                ) : (
                  <>
                    <span className="method">FILE</span>
                    <span className="label">{entry.ranked.item.display}</span>
                  </>
                )}
              </li>
            </Fragment>
          ))}
        </ul>
        {(indexing || entries.length === 0) && (
          <div className="quick-open-hint">{indexing ? "Indexing…" : "No matching files or requests"}</div>
        )}
      </div>
    </div>
  );
}
