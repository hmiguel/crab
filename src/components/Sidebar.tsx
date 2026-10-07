import { useMemo, useState } from "react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type RequestBlock } from "../api";
import { basename, joinPath, samePath } from "../lib/paths";
import { buildTree, type TreeNode } from "../lib/tree";
import { useTabs } from "../state/tabs";
import { useWorkspace, type VirtualFolder } from "../state/workspace";
import { showError } from "../ui/actions";

export function Sidebar() {
  const folders = useWorkspace((s) => s.folders);
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Workspace</span>
        <button title="New virtual folder" onClick={() => useWorkspace.getState().addFolder("New folder")}>＋</button>
      </div>
      <div className="sidebar-body">
        {folders.map((f) => <FolderView key={f.id} folder={f} />)}
      </div>
    </aside>
  );
}

function FolderView({ folder }: { folder: VirtualFolder }) {
  const [expanded, setExpanded] = useState(true);
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
  const [expanded, setExpanded] = useState(true);
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
  const [expanded, setExpanded] = useState(false);
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
  const [requests, setRequests] = useState<RequestBlock[] | null>(null);
  const selected = useTabs((s) => s.tabs.some((t) => t.id === s.activeId && samePath(t.path, path)));

  const toggle = async () => {
    if (requests) {
      setRequests(null);
      return;
    }
    await useTabs.getState().openFile(path);
    const parsed = await api.parseText(await api.readTextFile(path));
    setRequests(parsed.requests);
  };

  return (
    <li>
      <div className={`row file${selected ? " selected" : ""}`} style={{ paddingLeft: depth * 12 }} onClick={() => toggle().catch(showError)}>
        <span className="twisty">{requests ? "▾" : "▸"}</span>
        <span className="label">{node.name}</span>
      </div>
      {requests && (
        <ul className="tree">
          {requests.map((r) => (
            <li key={r.requestLine}>
              <div
                className="row request"
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
