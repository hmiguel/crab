import { ask } from "@tauri-apps/plugin-dialog";
import { api, toCrabError, type RequestBlock } from "../api";
import { requestIndexAt } from "../lib/outline";
import { isUnder } from "../lib/paths";
import { isDanger, useEnvironments } from "./environments";
import { useHistory } from "./history";
import { useResponses } from "./responses";
import { useTabs, type Tab } from "./tabs";
import { useWorkspace } from "./workspace";

/** Methods that never change data, so they never ask for confirmation. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Parses the current text, never the editor's debounced outline: a just-typed DELETE must not pass as the old GET. */
async function requestAt(tab: Tab, line: number): Promise<RequestBlock | null> {
  const { requests } = await api.parseText(tab.text);
  const i = requestIndexAt(requests, line);
  return i === null ? null : requests[i];
}

/** A red environment is selected and the confirmation setting is on. */
function dangerSelected(): boolean {
  const env = useEnvironments.getState();
  return env.selected !== null && env.confirmDanger && isDanger(env, env.selected);
}

/** Ask before a request that may change data goes to the (red) selected environment. */
async function confirmDanger(tab: Tab, line: number): Promise<boolean> {
  const request = await requestAt(tab, line);
  if (!request || SAFE_METHODS.has(request.method.toUpperCase())) return true;
  return ask(`Send ${request.method.toUpperCase()} ${request.url} to ${useEnvironments.getState().selected}?`, {
    title: "Crab", kind: "warning", okLabel: "Send", cancelLabel: "Cancel",
  });
}

/** Run the request whose block contains `line` (0-based) using the tab's current, possibly unsaved, text. */
export async function runAt(tabId: string, line: number): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  // Only await when a prompt is possible, so an ordinary run starts in the same tick.
  if (dangerSelected() && !(await confirmDanger(tab, line))) return;
  cancelActive(tabId);
  const runId = crypto.randomUUID();
  useResponses.getState().start(tabId, runId, line);
  const root = useWorkspace.getState().allRoots().find((r) => isUnder(tab.path, r)) ?? null;
  try {
    const response = await api.runRequest({ runId, path: tab.path, text: tab.text, line, env: useEnvironments.getState().selected, root });
    useResponses.getState().finish(tabId, runId, response);
  } catch (e) {
    useResponses.getState().fail(tabId, runId, toCrabError(e));
  }
  // History is best effort: a failing refresh must never surface as a run error.
  useHistory.getState().refresh().catch(() => undefined);
}

export function cancelActive(tabId: string): void {
  const current = useResponses.getState().byTab[tabId];
  if (current?.status === "running") api.cancelRequest(current.runId).catch(console.error);
}
