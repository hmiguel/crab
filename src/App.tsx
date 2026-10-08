import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Editor } from "./editor/Editor";
import { EnvAccent } from "./components/EnvAccent";
import { ResponsePanel } from "./components/ResponsePanel";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { handleFsChanged } from "./state/fs-events";
import { cancelActive } from "./state/run";
import { restoreSession, startSessionAutosave, useLayout } from "./state/session";
import { useTabs } from "./state/tabs";
import { useWorkspace } from "./state/workspace";
import { closeTabWithPrompt, showError } from "./ui/actions";

export function App() {
  const dock = useLayout((s) => s.dock);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    (async () => {
      await useWorkspace.getState().load();
      await restoreSession();
      const autosave = startSessionAutosave();
      cleanups.push(autosave.stop);
      cleanups.push(await listen<string[]>("fs-changed", (e) => handleFsChanged(e.payload)));
      cleanups.push(await getCurrentWindow().onCloseRequested(async () => { await autosave.flush(); }));
    })()
      .catch(showError)
      .finally(() => setReady(true));
    return () => cleanups.forEach((c) => c());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = useTabs.getState().activeId;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (id) void closeTabWithPrompt(id);
      } else if (e.key === "Escape" && id) {
        cancelActive(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) return <div className="placeholder">Loading workspace…</div>;

  return (
    <div className="app">
      <EnvAccent />
      <PanelGroup direction="horizontal" autoSaveId="crab-main" className="main">
        <Panel defaultSize={22} minSize={12}>
          <Sidebar />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel minSize={30}>
          <PanelGroup key={dock} direction={dock === "right" ? "horizontal" : "vertical"} autoSaveId={`crab-work-${dock}`}>
            <Panel minSize={20}>
              <div className="editor-column">
                <TabBar />
                <Editor />
              </div>
            </Panel>
            <PanelResizeHandle className="resize-handle" />
            <Panel defaultSize={45} minSize={15}>
              <ResponsePanel />
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
      <StatusBar />
    </div>
  );
}
