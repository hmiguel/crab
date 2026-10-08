import { useEffect } from "react";
import type { RunSummary } from "../api";
import { errorTitle, formatBytes, formatMs, groupByDay, statusClass, timeLabel } from "../lib/format";
import { colorOf, useEnvironments } from "../state/environments";
import { useHistory } from "../state/history";
import { openPastRun } from "../ui/history-actions";
import { showError } from "../ui/actions";

/** Every saved run, newest first, grouped by day, with search. */
export function HistoryView() {
  const items = useHistory((s) => s.items);
  const query = useHistory((s) => s.query);
  const hasMore = useHistory((s) => s.hasMore);
  const status = useHistory((s) => s.status);
  const colors = useEnvironments((s) => s.colors);

  useEffect(() => { void useHistory.getState().refresh(); }, []);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (hasMore && el.scrollTop + el.clientHeight > el.scrollHeight - 80) void useHistory.getState().loadMore();
  };

  return (
    <div className="history">
      <input className="history-search" placeholder="Search history" value={query} onChange={(e) => useHistory.getState().setQuery(e.currentTarget.value)} />
      {(!status.enabled || status.error) && <div className="hint error">History is off: {status.error ?? "unavailable"}</div>}
      <div className="sidebar-body" onScroll={onScroll}>
        {items.length === 0 && <div className="hint">{query ? "No runs match" : "Runs you send appear here"}</div>}
        {groupByDay(items).map((g) => (
          <div key={g.label}>
            <div className="history-day">{g.label}</div>
            {g.items.map((r) => <HistoryRow key={r.id} r={r} envColor={colorOf({ colors }, r.env)} />)}
          </div>
        ))}
      </div>
      {items.length > 0 && (
        <button className="history-clear" onClick={() => useHistory.getState().clear().catch(showError)}>Clear history</button>
      )}
    </div>
  );
}

function HistoryRow({ r, envColor }: { r: RunSummary; envColor: string }) {
  const tip = [r.path ?? "unsaved", r.totalMs !== null ? formatMs(r.totalMs) : null, r.sizeBytes !== null ? formatBytes(r.sizeBytes) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="row history-row" title={tip} onClick={() => openPastRun(r.id).catch(showError)}>
      <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span>
      <span className="label">{r.name ?? r.url}</span>
      {r.status !== null
        ? <span className={`status ${statusClass(r.status)}`}>{r.status}</span>
        : <span className="status server-error">{errorTitle(r.errorKind ?? "network")}</span>}
      {r.env && <span className={`env-dot env-${envColor}`} title={r.env} aria-label={r.env}>●</span>}
      <span className="history-time">{timeLabel(r.atMs)}</span>
    </div>
  );
}
