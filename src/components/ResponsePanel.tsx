import { useState } from "react";
import { api, type ResolvedRequest, type ResponseData } from "../api";
import { errorTitle, formatBytes, formatMs, formatRawResponse, formatRequest, pastBanner, prettyBody, statusClass } from "../lib/format";
import { colorOf, useEnvironments } from "../state/environments";
import { lineAtOffset } from "../lib/outline";
import { canRunAgain, useResponses, type PastInfo } from "../state/responses";
import { cancelActive, runAt } from "../state/run";
import { useTabs } from "../state/tabs";
import { showError } from "../ui/actions";
import { CodeView } from "./CodeView";
import { RunHistoryPicker } from "./RunHistoryPicker";
import { shortcutLabel } from "../lib/keys";

const VIEWS = ["body", "raw", "headers", "timing", "request"] as const;
type View = (typeof VIEWS)[number];
const LABELS: Record<View, string> = { body: "Body", raw: "Raw", headers: "Headers", timing: "Timing", request: "Request" };

export function ResponsePanel() {
  const activeId = useTabs((s) => s.activeId);
  const run = useResponses((s) => (activeId ? s.byTab[activeId] : undefined));
  const [view, setView] = useState<View>("body");

  if (!activeId || !run) {
    return <section className="response placeholder">Press <kbd>{shortcutLabel("Enter")}</kbd> or click ▶ to run a request</section>;
  }
  if (run.status === "running") {
    return (
      <section className="response placeholder">
        <span className="spinner" /> Sending request…
        <button onClick={() => cancelActive(activeId)}>Cancel (Esc)</button>
      </section>
    );
  }
  if (run.status === "error") {
    return (
      <section className="response">
        <header className="response-summary">
          <RunHistoryPicker tabId={activeId} pastId={run.past?.id ?? null} />
        </header>
        {run.past && <PastBanner tabId={activeId} past={run.past} />}
        <div className="response-error">
          <h3>{errorTitle(run.error.kind)}</h3>
          <pre>{run.error.message}</pre>
        </div>
      </section>
    );
  }

  const r = run.response;
  return (
    <section className="response">
      <header className="response-summary">
        <span className={`status ${statusClass(r.status)}`}>{r.status} {r.statusText}</span>
        <span>{formatMs(r.timing.totalMs)}</span>
        <span>{formatBytes(r.sizeBytes)}{r.truncated ? " (truncated)" : ""}</span>
        <RunHistoryPicker tabId={activeId} pastId={run.past?.id ?? null} />
      </header>
      {run.past && <PastBanner tabId={activeId} past={run.past} />}
      <nav className="subtabs">
        {VIEWS.map((v) => (
          <button key={v} className={v === view ? "active" : ""} onClick={() => setView(v)}>
            {LABELS[v]}{v === "headers" ? ` (${r.headers.length})` : ""}
          </button>
        ))}
      </nav>
      <div className="response-content">
        {view === "body" && <BodyView r={r} />}
        {view === "raw" && <CodeView text={formatRawResponse(r)} lang="text" />}
        {view === "headers" && <HeadersView r={r} />}
        {view === "timing" && <TimingView r={r} />}
        {view === "request" && <RequestView key={run.runId} runId={run.runId} r={run.past ? { ...r, hasSecrets: false } : r} />}
      </div>
    </section>
  );
}

function PastBanner({ tabId, past }: { tabId: string; past: PastInfo }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  return (
    <div className="past-banner">
      <span>{pastBanner(past)}</span>
      {tab && canRunAgain(past, tab.path) && (
        <button onClick={() => void runAt(tabId, lineAtOffset(tab.text, tab.cursor))}>Run again</button>
      )}
      <button onClick={() => useResponses.getState().latest(tabId)}>Latest</button>
    </div>
  );
}

/** What was sent, with its environment; secrets stay masked until revealed (re-masked on a new run). */
function RequestView({ runId, r }: { runId: string; r: ResponseData }) {
  const colors = useEnvironments((s) => s.colors);
  const [revealed, setRevealed] = useState<ResolvedRequest | null>(null);
  const toggle = () => {
    if (revealed) return setRevealed(null);
    api.revealRequest(runId).then((req) => { if (req) setRevealed(req); }).catch(showError);
  };
  return (
    <div className="request-view">
      <div className="request-env">
        Environment:{" "}
        {r.env ? <><span className={`env-dot env-${colorOf({ colors }, r.env)}`} aria-hidden="true">●</span> {r.env}</> : "none"}
        {r.hasSecrets && <button onClick={toggle}>{revealed ? "Hide secrets" : "Reveal secrets"}</button>}
      </div>
      <CodeView text={formatRequest(revealed ?? r.request)} lang="http" />
    </div>
  );
}

function BodyView({ r }: { r: ResponseData }) {
  if (r.contentType?.startsWith("image/") && r.bodyBase64) {
    return <div className="image-body"><img src={`data:${r.contentType};base64,${r.bodyBase64}`} alt="Response body" /></div>;
  }
  if (r.bodyText === "") return <div className="placeholder">(empty body)</div>;
  const { text, lang } = prettyBody(r.contentType, r.bodyText);
  return <CodeView text={text} lang={lang} />;
}

function HeadersView({ r }: { r: ResponseData }) {
  return (
    <table className="kv">
      <tbody>
        {r.headers.map((h, i) => (
          <tr key={i}><th>{h.name}</th><td>{h.value}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function TimingView({ r }: { r: ResponseData }) {
  const rows: Array<[string, string]> = [
    ["Total", formatMs(r.timing.totalMs)],
    ["Waiting (TTFB)", formatMs(r.timing.ttfbMs)],
    ["Download", formatMs(Math.max(0, r.timing.totalMs - r.timing.ttfbMs))],
    ["Size", formatBytes(r.sizeBytes) + (r.truncated ? " (truncated)" : "")],
    ["Protocol", r.httpVersion],
  ];
  return (
    <table className="kv">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}><th>{k}</th><td>{v}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
