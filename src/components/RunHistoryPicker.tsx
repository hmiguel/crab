import { useEffect } from "react";
import { api } from "../api";
import { formatMs, statusClass, timeLabel, dayLabel } from "../lib/format";
import { lineAtOffset, requestKeyAt } from "../lib/outline";
import { useHistory } from "../state/history";
import { useOutline } from "../state/outline";
import { useResponses } from "../state/responses";
import { useTabs } from "../state/tabs";
import { showError } from "../ui/actions";

/** "History (n)": past runs of the request under the cursor; picking one shows it read-only. */
export function RunHistoryPicker({ tabId, pastId }: { tabId: string; pastId: number | null }) {
  const path = useTabs((s) => s.tabs.find((t) => t.id === tabId)?.path ?? null);
  const line = useTabs((s) => {
    const t = s.tabs.find((x) => x.id === tabId);
    return t ? lineAtOffset(t.text, t.cursor) : 0;
  });
  const requests = useOutline((s) => (path ? s.get(path) : undefined));
  const key = requests ? requestKeyAt(requests, line) : null;
  const forRequest = useHistory((s) => s.forRequest);

  useEffect(() => {
    if (path && key) void useHistory.getState().loadForRequest(path, key);
  }, [path, key]);

  const runs = forRequest && forRequest.path === path && forRequest.key === key ? forRequest.items : [];
  if (runs.length === 0) return null;

  const pick = async (value: string) => {
    if (value === "latest") return useResponses.getState().latest(tabId);
    const run = await api.historyGet(Number(value));
    if (run) useResponses.getState().showPast(tabId, run, line);
  };

  return (
    <select className="run-history" value={pastId ?? "latest"} onChange={(e) => pick(e.currentTarget.value).catch(showError)} title="Past runs of this request">
      <option value="latest">History ({runs.length})</option>
      {runs.map((r) => (
        <option key={r.id} value={r.id} className={r.status !== null ? statusClass(r.status) : "server-error"}>
          {dayLabel(r.atMs)} {timeLabel(r.atMs)} · {r.status ?? r.errorKind} · {r.totalMs !== null ? formatMs(r.totalMs) : "–"}{r.env ? ` · ${r.env}` : ""}
        </option>
      ))}
    </select>
  );
}
