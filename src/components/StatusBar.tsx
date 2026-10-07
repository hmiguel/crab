import { errorTitle, formatBytes, formatMs, statusClass } from "../lib/format";
import { useResponses } from "../state/responses";
import { useLayout } from "../state/session";
import { useTabs } from "../state/tabs";

export function StatusBar() {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const run = useResponses((s) => (tab ? s.byTab[tab.id] : undefined));
  const dock = useLayout((s) => s.dock);
  return (
    <footer className="statusbar">
      <span className="path">{tab?.path ?? "No file open"}</span>
      <span className="spacer" />
      {run?.status === "running" && <span>Running…</span>}
      {run?.status === "done" && (
        <>
          <span className={`status ${statusClass(run.response.status)}`}>{run.response.status} {run.response.statusText}</span>
          <span>{formatMs(run.response.timing.totalMs)}</span>
          <span>{formatBytes(run.response.sizeBytes)}</span>
        </>
      )}
      {run?.status === "error" && <span className="status server-error">{errorTitle(run.error.kind)}</span>}
      <button title="Move the response panel" onClick={() => useLayout.getState().toggleDock()}>
        Response: {dock === "right" ? "right" : "bottom"}
      </button>
    </footer>
  );
}
