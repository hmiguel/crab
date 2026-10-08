import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { rankItems, snippet, type Ranked } from "../lib/fuzzy";
import { useOutline } from "../state/outline";
import { searchItems, useSearchIndex, type SearchItem } from "../state/search-index";
import { useTabs } from "../state/tabs";
import { useWorkspace } from "../state/workspace";
import { showError } from "../ui/actions";

export const useQuickOpen = create<{ open: boolean }>(() => ({ open: false }));
export const openQuickOpen = () => useQuickOpen.setState({ open: true });
const close = () => useQuickOpen.setState({ open: false });

const itemLabel = (i: SearchItem) => (i.kind === "file" ? i.display : i.label);
const itemFields = (i: SearchItem) => (i.kind === "file" ? [i.display] : [i.label, i.url, `${i.method} ${i.label}`, i.display]);
const itemContent = (i: SearchItem) => (i.kind === "request" ? i.content : "");

/** ⌘P palette: fuzzy-find files and requests across the whole workspace. */
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

  useEffect(() => setSelected(0), [query]);
  useEffect(() => selectedRow.current?.scrollIntoView({ block: "nearest" }), [selected]);

  const choose = (item: SearchItem | undefined) => {
    if (!item) return;
    close();
    useTabs.getState().openFile(item.path, item.kind === "request" ? item.requestLine : undefined).catch(showError);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = results.length;
    if (e.key === "ArrowDown" && n) setSelected((s) => (s + 1) % n);
    else if (e.key === "ArrowUp" && n) setSelected((s) => (s - 1 + n) % n);
    else if (e.key === "Enter") choose(results[selected]?.item);
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
          {results.map(({ item, viaContent }, i) => (
            <li
              key={item.kind === "file" ? item.path : `${item.path}:${item.requestLine}`}
              ref={i === selected ? selectedRow : undefined}
              role="option"
              aria-selected={i === selected}
              className={`row${i === selected ? " selected" : ""}${viaContent ? " with-snippet" : ""}`}
              onMouseMove={() => setSelected(i)}
              onClick={() => choose(item)}
            >
              {item.kind === "request" ? (
                <>
                  <span className={`method m-${item.method.toLowerCase()}`}>{item.method}</span>
                  <span className="label">{item.label}</span>
                  <span className="where">{item.display}</span>
                  {viaContent && <span className="snippet">{snippet(q, item.content)}</span>}
                </>
              ) : (
                <>
                  <span className="method">FILE</span>
                  <span className="label">{item.display}</span>
                </>
              )}
            </li>
          ))}
        </ul>
        {(indexing || results.length === 0) && (
          <div className="quick-open-hint">{indexing ? "Indexing…" : "No matching files or requests"}</div>
        )}
      </div>
    </div>
  );
}
