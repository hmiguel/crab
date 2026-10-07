import { create } from "zustand";
import { api, toCrabError } from "../api";
import { samePath } from "../lib/paths";

export type VirtualFolder = { id: string; name: string; roots: string[] };
type Persisted = { version: 1; folders: VirtualFolder[] };

type WorkspaceState = {
  folders: VirtualFolder[];
  /** root -> `/`-separated relative paths of .http/.rest files */
  files: Record<string, string[]>;
  rootErrors: Record<string, string>;
  load(): Promise<void>;
  addFolder(name: string): void;
  renameFolder(id: string, name: string): void;
  removeFolder(id: string): void;
  addRoots(folderId: string, roots: string[]): Promise<void>;
  removeRoot(folderId: string, root: string): void;
  refreshRoot(root: string): Promise<void>;
  allRoots(): string[];
};

function uniqueRoots(folders: VirtualFolder[]): string[] {
  const out: string[] = [];
  for (const root of folders.flatMap((f) => f.roots)) if (!out.some((r) => samePath(r, root))) out.push(root);
  return out;
}

function persist(folders: VirtualFolder[]) {
  api.saveState("workspace", { version: 1, folders } satisfies Persisted).catch(console.error);
  api.watchRoots(uniqueRoots(folders)).catch(console.error);
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const update = (folders: VirtualFolder[]) => {
    set({ folders });
    persist(folders);
  };
  return {
    folders: [],
    files: {},
    rootErrors: {},
    async load() {
      const saved = await api.loadState<Persisted>("workspace").catch(() => null);
      const folders = saved?.version === 1 ? saved.folders : [{ id: crypto.randomUUID(), name: "Workspace", roots: [] }];
      set({ folders });
      const roots = uniqueRoots(folders);
      api.watchRoots(roots).catch(console.error);
      await Promise.all(roots.map((r) => get().refreshRoot(r)));
    },
    addFolder(name) {
      update([...get().folders, { id: crypto.randomUUID(), name, roots: [] }]);
    },
    renameFolder(id, name) {
      update(get().folders.map((f) => (f.id === id ? { ...f, name } : f)));
    },
    removeFolder(id) {
      update(get().folders.filter((f) => f.id !== id));
    },
    async addRoots(folderId, roots) {
      const added: string[] = [];
      const folders = get().folders.map((f) => {
        if (f.id !== folderId) return f;
        const next = [...f.roots];
        for (const r of roots) {
          if (!next.some((x) => samePath(x, r))) {
            next.push(r);
            added.push(r);
          }
        }
        return { ...f, roots: next };
      });
      update(folders);
      await Promise.all(added.map((r) => get().refreshRoot(r)));
    },
    removeRoot(folderId, root) {
      update(get().folders.map((f) => (f.id === folderId ? { ...f, roots: f.roots.filter((r) => r !== root) } : f)));
    },
    async refreshRoot(root) {
      try {
        const list = await api.listHttpFiles(root);
        set((s) => {
          const { [root]: _removed, ...rootErrors } = s.rootErrors;
          return { files: { ...s.files, [root]: list }, rootErrors };
        });
      } catch (e) {
        set((s) => ({ files: { ...s.files, [root]: [] }, rootErrors: { ...s.rootErrors, [root]: toCrabError(e).message } }));
      }
    },
    allRoots: () => uniqueRoots(get().folders),
  };
});
