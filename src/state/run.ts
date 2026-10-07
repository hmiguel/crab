import { api, toCrabError } from "../api";
import { useResponses } from "./responses";
import { useTabs } from "./tabs";

/** Run the request whose block contains `line` (0-based) using the tab's current, possibly unsaved, text. */
export async function runAt(tabId: string, line: number): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  cancelActive(tabId);
  const runId = crypto.randomUUID();
  useResponses.getState().start(tabId, runId, line);
  try {
    const response = await api.runRequest({ runId, path: tab.path, text: tab.text, line });
    useResponses.getState().finish(tabId, runId, response);
  } catch (e) {
    useResponses.getState().fail(tabId, runId, toCrabError(e));
  }
}

export function cancelActive(tabId: string): void {
  const current = useResponses.getState().byTab[tabId];
  if (current?.status === "running") api.cancelRequest(current.runId).catch(console.error);
}
