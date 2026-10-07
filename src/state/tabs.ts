import { create } from "zustand";
import { api } from "../api";
import { decodeDisk, encodeDisk, type Eol } from "../lib/eol";
import { basename, samePath } from "../lib/paths";

export type Tab = {
  id: string;
  path: string;
  title: string;
  /** Always LF; `eol` is restored on save. */
  text: string;
  savedText: string;
  eol: Eol;
  /** The file started with a UTF-8 BOM (kept out of `text`, written back on save). */
  bom: boolean;
  cursor: number;
  scrollTop: number;
  externallyChanged: boolean;
  /** 0-based line to move the cursor to once the editor shows this tab. */
  revealLine: number | null;
};
export type NewTab = Pick<Tab, "path" | "text" | "savedText" | "eol" | "cursor" | "scrollTop"> & { bom?: boolean };

export const isDirty = (t: Tab) => t.text !== t.savedText;

type TabsState = {
  tabs: Tab[];
  activeId: string | null;
  addTab(t: NewTab): string;
  openFile(path: string, revealLine?: number): Promise<void>;
  setActive(id: string): void;
  setText(id: string, text: string): void;
  setView(id: string, cursor: number, scrollTop: number): void;
  clearReveal(id: string): void;
  save(id: string): Promise<void>;
  closeTab(id: string): void;
  onDiskChange(path: string): Promise<void>;
  reloadFromDisk(id: string): Promise<void>;
  keepMine(id: string): void;
};

async function readDisk(path: string): Promise<{ text: string; eol: Eol; bom: boolean }> {
  return decodeDisk(await api.readTextFile(path));
}

export const useTabs = create<TabsState>((set, get) => {
  const byId = (id: string) => get().tabs.find((t) => t.id === id);
  const patch = (id: string, p: Partial<Tab>) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...p } : t)) }));

  return {
    tabs: [],
    activeId: null,
    addTab(t) {
      const id = crypto.randomUUID();
      set((s) => ({ tabs: [...s.tabs, { bom: false, ...t, id, title: basename(t.path), externallyChanged: false, revealLine: null }] }));
      return id;
    },
    async openFile(path, revealLine) {
      const existing = get().tabs.find((t) => samePath(t.path, path));
      let id = existing?.id;
      if (!id) {
        const { text, eol, bom } = await readDisk(path);
        id = get().addTab({ path, text, savedText: text, eol, bom, cursor: 0, scrollTop: 0 });
      }
      set({ activeId: id });
      if (revealLine !== undefined) patch(id, { revealLine });
    },
    setActive(id) {
      set({ activeId: id });
    },
    setText(id, text) {
      if (byId(id)?.text !== text) patch(id, { text });
    },
    setView(id, cursor, scrollTop) {
      const t = byId(id);
      if (t && (t.cursor !== cursor || t.scrollTop !== scrollTop)) patch(id, { cursor, scrollTop });
    },
    clearReveal(id) {
      patch(id, { revealLine: null });
    },
    async save(id) {
      const t = byId(id);
      if (!t) return;
      await api.writeTextFile(t.path, encodeDisk(t.text, t.eol, t.bom));
      patch(id, { savedText: t.text, externallyChanged: false });
    },
    closeTab(id) {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id);
        const tabs = s.tabs.filter((t) => t.id !== id);
        const activeId = s.activeId !== id ? s.activeId : (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null);
        return { tabs, activeId };
      });
    },
    async onDiskChange(path) {
      for (const t of get().tabs.filter((x) => samePath(x.path, path))) {
        let disk: string;
        try {
          disk = (await readDisk(t.path)).text;
        } catch {
          continue;
        }
        const cur = byId(t.id);
        if (!cur || disk === cur.savedText) continue;
        if (isDirty(cur)) patch(t.id, { externallyChanged: true });
        else patch(t.id, { text: disk, savedText: disk });
      }
    },
    async reloadFromDisk(id) {
      const t = byId(id);
      if (!t) return;
      const { text, eol, bom } = await readDisk(t.path);
      patch(id, { text, savedText: text, eol, bom, externallyChanged: false });
    },
    keepMine(id) {
      patch(id, { externallyChanged: false });
    },
  };
});
