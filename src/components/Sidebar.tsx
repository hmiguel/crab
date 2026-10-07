import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type RequestBlock } from "../api";
import { lineAtOffset, requestIndexAt } from "../lib/outline";
import { basename, isUnder, joinPath, normPath, samePath } from "../lib/paths";
import { buildTree, type TreeNode } from "../lib/tree";
import { useOutline } from "../state/outline";
import { useTabs } from "../state/tabs";
import { useWorkspace, type VirtualFolder } from "../state/workspace";
import { showError } from "../ui/actions";

/** The file and 0-based cursor line of the active tab; the tree follows it. */
type ActiveLocation = { path: string | null; line: number };
const Active = createContext<ActiveLocation>({ path: null, line: 0 });

/** Expand a tree level whenever the active file moves somewhere inside it. */
function useRevealExpanded(contains: (path: string) => boolean, initial: boolean) {
  const { path } = useContext(Active);
  const state = useState(initial);
  const [, setExpanded] = state;
  // Only on navigation, so the user can still collapse a level afterwards.
  useEffect(() => {
    if (path && contains(path)) setExpanded(true);
  }, [path]);
  return state;
}

export function Sidebar() {
  const folders = useWorkspace((s) => s.folders);
  const path = useTabs((s) => s.tabs.find((t) => t.id === s.activeId)?.path ?? null);
  const line = useTabs((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId);
    return t ? lineAtOffset(t.text, t.cursor) : 0;
  });
  const active = useMemo(() => ({ path, line }), [path, line]);
  return (
    <Active.Provider value={active}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <span>Workspace</span>
          <button title="New virtual folder" onClick={() => useWorkspace.getState().addFolder("New folder")}>＋</button>
        </div>
        <div className="sidebar-body">
          {folders.map((f) => <FolderView key={f.id} folder={f} />)}
        </div>
      </aside>
    </Active.Provider>
  );
}

function FolderView({ folder }: { folder: VirtualFolder }) {
  const [expanded, setExpanded] = useRevealExpanded((p) => folder.roots.some((r) => isUnder(p, r)), true);
  const [editing, setEditing] = useState(false);
  const ws = useWorkspace.getState();

  const addFolders = async () => {
    const picked = await openDialog({ directory: true, multiple: true, title: `Add folders to "${folder.name}"` });
    if (picked) await ws.addRoots(folder.id, Array.isArray(picked) ? picked : [picked]);
  };
  const remove = async () => {
    if (await ask(`Remove "${folder.name}" from the workspace? Files on disk are not touched.`, { title: "Crab", kind: "warning" })) {
      ws.removeFolder(folder.id);
    }
  };

  return (
    <div className="vfolder">
      <div className="row vfolder-row">
        <button className="twisty" onClick={() => setExpanded(!expanded)}>{expanded ? "▾" : "▸"}</button>
        {editing ? (
          <input
            autoFocus
            defaultValue={folder.name}
            onBlur={(e) => { ws.renameFolder(folder.id, e.currentTarget.value.trim() || folder.name); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        ) : (
          <span className="label" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>{folder.name}</span>
        )}
        <span className="actions">
          <button title="Add folder from disk" onClick={() => addFolders().catch(showError)}>＋</button>
          <button title="Remove virtual folder" onClick={() => remove().catch(showError)}>×</button>
        </span>
      </div>
      {expanded &&
        (folder.roots.length === 0 ? (
          <div className="hint">Click ＋ to add a folder that contains .http files</div>
        ) : (
          folder.roots.map((r) => <RootView key={r} folderId={folder.id} root={r} />)
        ))}
    </div>
  );
}

function RootView({ folderId, root }: { folderId: string; root: string }) {
  const files = useWorkspace((s) => s.files[root]);
  const error = useWorkspace((s) => s.rootErrors[root]);
  const [expanded, setExpanded] = useRevealExpanded((p) => isUnder(p, root), true);
  const tree = useMemo(() => buildTree(files ?? []), [files]);

  return (
    <div className="root">
      <div className="row" title={root}>
        <button className="twisty" onClick={() => setExpanded(!expanded)}>{expanded ? "▾" : "▸"}</button>
        <span className="label root-label">{basename(root)}</span>
        <span className="actions">
          <button title="Rescan" onClick={() => void useWorkspace.getState().refreshRoot(root)}>⟳</button>
          <button title="Remove from this virtual folder" onClick={() => useWorkspace.getState().removeRoot(folderId, root)}>×</button>
        </span>
      </div>
      {expanded &&
        (error ? (
          <div className="hint error">{error}</div>
        ) : files === undefined ? (
          <div className="hint">Scanning…</div>
        ) : tree.length === 0 ? (
          <div className="hint">No .http or .rest files</div>
        ) : (
          <ul className="tree">{tree.map((n) => <NodeView key={n.rel} node={n} root={root} depth={1} />)}</ul>
        ))}
    </div>
  );
}

function NodeView({ node, root, depth }: { node: TreeNode; root: string; depth: number }) {
  const [expanded, setExpanded] = useRevealExpanded((p) => isUnder(p, joinPath(root, node.rel)), false);
  if (node.children === null) return <FileNode node={node} root={root} depth={depth} />;
  return (
    <li>
      <div className="row" style={{ paddingLeft: depth * 12 }} onClick={() => setExpanded(!expanded)}>
        <span className="twisty">{expanded ? "▾" : "▸"}</span>
        <span className="label">{node.name}</span>
      </div>
      {expanded && <ul className="tree">{node.children.map((c) => <NodeView key={c.rel} node={c} root={root} depth={depth + 1} />)}</ul>}
    </li>
  );
}

function FileNode({ node, root, depth }: { node: TreeNode; root: string; depth: number }) {
  const path = joinPath(root, node.rel);
  const active = useContext(Active);
  const isActive = active.path !== null && samePath(active.path, path);
  const [expanded, setExpanded] = useRevealExpanded((p) => samePath(p, path), false);
  const [diskRequests, setDiskRequests] = useState<RequestBlock[] | null>(null);
  // While the file is open, list what the editor has (unsaved edits included).
  const isOpen = useTabs((s) => s.tabs.some((t) => samePath(t.path, path)));
  const live = useOutline((s) => s.byPath[normPath(path)]);
  const requests = (isOpen ? live : undefined) ?? diskRequests;
  const current = isActive && requests ? requestIndexAt(requests, active.line) : null;
  const currentRow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded || (isOpen && live)) return;
    let stale = false;
    api.readTextFile(path).then(api.parseText).then((p) => { if (!stale) setDiskRequests(p.requests); }).catch(showError);
    return () => { stale = true; };
  }, [expanded, path, isOpen]);

  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: "nearest" });
  }, [current, isActive, expanded]);

  const toggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    await useTabs.getState().openFile(path);
  };

  const fileSelected = isActive && (!expanded || current === null);
  return (
    <li>
      <div
        ref={fileSelected ? currentRow : undefined}
        className={`row file${fileSelected ? " selected" : ""}${isActive ? " current" : ""}`}
        style={{ paddingLeft: depth * 12 }}
        onClick={() => toggle().catch(showError)}
      >
        <span className="twisty">{expanded ? "▾" : "▸"}</span>
        <span className="label">{node.name}</span>
      </div>
      {expanded && requests && (
        <ul className="tree">
          {requests.map((r, i) => (
            <li key={r.requestLine}>
              <div
                ref={i === current ? currentRow : undefined}
                className={`row request${i === current ? " selected" : ""}`}
                style={{ paddingLeft: (depth + 1) * 12 }}
                onClick={() => useTabs.getState().openFile(path, r.requestLine).catch(showError)}
              >
                <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span>
                <span className="label">{r.name ?? r.url}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
