import { useResponses } from "../state/responses";
import { isDirty, useTabs } from "../state/tabs";
import { closeTabWithPrompt } from "../ui/actions";
import { shortcutLabel } from "../lib/keys";

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const runs = useResponses((s) => s.byTab);
  if (tabs.length === 0) return null;
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === activeId}
          className={`tab${t.id === activeId ? " active" : ""}`}
          title={t.path}
          onClick={() => useTabs.getState().setActive(t.id)}
          onAuxClick={(e) => { if (e.button === 1) void closeTabWithPrompt(t.id); }}
        >
          {runs[t.id]?.status === "running" && <span className="spinner small" />}
          <span className="tab-title">{t.title}</span>
          {isDirty(t) && <span className="tab-dirty" title="Unsaved changes">●</span>}
          <button className="tab-close" title={`Close (${shortcutLabel("W")})`} onClick={(e) => { e.stopPropagation(); void closeTabWithPrompt(t.id); }}>×</button>
        </div>
      ))}
    </div>
  );
}
