import { debounce } from "../lib/debounce";
import { isHttpFile, isUnder } from "../lib/paths";
import { useSearchIndex } from "./search-index";
import { useTabs } from "./tabs";
import { useWorkspace } from "./workspace";

const pendingRoots = new Set<string>();
const refreshPending = debounce(() => {
  const roots = [...pendingRoots];
  pendingRoots.clear();
  for (const root of roots) void useWorkspace.getState().refreshRoot(root);
}, 300);

/** Paths with a non-.http extension (build output, assets…) never affect the tree. Extension-less paths may be folders. */
const isIrrelevant = (p: string) => !isHttpFile(p) && /\.[^\\/.]+$/.test(p);

export function handleFsChanged(paths: string[]): void {
  const roots = useWorkspace.getState().allRoots();
  for (const p of paths) {
    if (isIrrelevant(p)) continue;
    for (const root of roots) if (isUnder(p, root)) pendingRoots.add(root);
    if (isHttpFile(p)) void useTabs.getState().onDiskChange(p);
  }
  useSearchIndex.getState().invalidate(paths.filter(isHttpFile));
  if (pendingRoots.size > 0) refreshPending();
}
