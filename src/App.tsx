import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Editor } from "./editor/Editor";
import { EnvAccent } from "./components/EnvAccent";
import { QuickOpen, openQuickOpen } from "./components/QuickOpen";
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

function WorkArea({ dock }: { dock: string }) {
  const id = `crab-work-${dock}`;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id, panelIds: ["editor", "response"] });
  return (
    <Group id={id} orientation={dock === "right" ? "horizontal" : "vertical"} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <Panel id="editor" minSize="20%">
        <div className="editor-column">
          <TabBar />
          <Editor />
        </div>
      </Panel>
      <Separator className="resize-handle" />
      <Panel id="response" defaultSize="45%" minSize="15%">
        <ResponsePanel />
      </Panel>
    </Group>
  );
}

export function App() {
  const dock = useLayout((s) => s.dock);
  const main = useDefaultLayout({ id: "crab-main", panelIds: ["sidebar", "work"] });
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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        openQuickOpen();
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
      <Group orientation="horizontal" className="main" id="crab-main" defaultLayout={main.defaultLayout} onLayoutChanged={main.onLayoutChanged}>
        <Panel id="sidebar" defaultSize="22%" minSize="12%">
          <Sidebar />
        </Panel>
        <Separator className="resize-handle" />
        <Panel id="work" minSize="30%">
          <WorkArea dock={dock} />
        </Panel>
      </Group>
      <StatusBar />
      <QuickOpen />
    </div>
  );
}
