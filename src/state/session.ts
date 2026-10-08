import { create } from "zustand";
import { api } from "../api";
import { debounce } from "../lib/debounce";
import { decodeDisk, type Eol } from "../lib/eol";
import { samePath } from "../lib/paths";
import { isDirty, useTabs, type Tab } from "./tabs";

export type Dock = "right" | "bottom";
export type SidebarTab = "workspace" | "history";
export type SessionTab = { path: string; draft: string | null; cursor: number; scrollTop: number };
export type Session = { version: 1; tabs: SessionTab[]; activePath: string | null; dock: Dock; sidebarTab?: SidebarTab };

type Layout = { dock: Dock; sidebarTab: SidebarTab; setDock(d: Dock): void; toggleDock(): void; setSidebarTab(t: SidebarTab): void };

export const useLayout = create<Layout>((set, get) => ({
  dock: "right",
  sidebarTab: "workspace",
  setDock: (dock) => set({ dock }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  toggleDock: () => set({ dock: get().dock === "right" ? "bottom" : "right" }),
}));

export function toSession(tabs: Tab[], activeId: string | null, dock: Dock, sidebarTab: SidebarTab = "workspace"): Session {
  return {
    version: 1,
    dock,
    sidebarTab,
    activePath: tabs.find((t) => t.id === activeId)?.path ?? null,
    tabs: tabs.map((t) => ({ path: t.path, draft: isDirty(t) ? t.text : null, cursor: t.cursor, scrollTop: t.scrollTop })),
  };
}

export async function restoreSession(): Promise<void> {
  const session = await api.loadState<Session>("session").catch(() => null);
  if (!session || session.version !== 1) return;
  useLayout.getState().setDock(session.dock ?? "right");
  useLayout.getState().setSidebarTab(session.sidebarTab ?? "workspace");
  for (const st of session.tabs) {
    let disk: string | null = null;
    let eol: Eol = "\n";
    let bom = false;
    try {
      ({ text: disk, eol, bom } = decodeDisk(await api.readTextFile(st.path)));
    } catch {
      // file deleted or moved: keep the tab only if it holds an unsaved draft
    }
    if (disk === null && st.draft === null) continue;
    useTabs.getState().addTab({
      path: st.path,
      text: st.draft ?? disk ?? "",
      savedText: disk ?? "",
      eol,
      bom,
      cursor: st.cursor,
      scrollTop: st.scrollTop,
    });
  }
  const { tabs } = useTabs.getState();
  const active = tabs.find((t) => session.activePath !== null && samePath(t.path, session.activePath)) ?? tabs[0];
  if (active) useTabs.getState().setActive(active.id);
}

export function startSessionAutosave(): { flush(): Promise<void>; stop(): void } {
  const save = () => {
    const { tabs, activeId } = useTabs.getState();
    return api.saveState("session", toSession(tabs, activeId, useLayout.getState().dock, useLayout.getState().sidebarTab)).catch(console.error);
  };
  const later = debounce(() => void save(), 1000);
  const unsubTabs = useTabs.subscribe(() => later());
  const unsubLayout = useLayout.subscribe(() => later());
  return {
    async flush() {
      later.cancel();
      await save();
    },
    stop() {
      later.cancel();
      unsubTabs();
      unsubLayout();
    },
  };
}
