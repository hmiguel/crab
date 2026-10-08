import { api } from "../api";
import { requestKeyOf } from "../lib/outline";
import { useResponses } from "../state/responses";
import { useTabs } from "../state/tabs";
import { showError } from "./actions";

const exists = (path: string) => api.readTextFile(path).then(() => true, () => false);

/** Show a run from history: in its file at the request (matched by key), or read-only in the active tab if the file is gone. */
export async function openPastRun(id: number): Promise<void> {
  const run = await api.historyGet(id);
  if (!run) return showError(new Error("This run is no longer in history"));
  const { path, requestKey, requestLine } = run.summary;
  if (path && (await exists(path))) {
    const text = await api.readTextFile(path);
    const { requests } = await api.parseText(text);
    const line = requests.find((r) => requestKeyOf(r) === requestKey)?.requestLine ?? requestLine;
    await useTabs.getState().openFile(path, line);
    const tabId = useTabs.getState().activeId;
    if (tabId) useResponses.getState().showPast(tabId, run, line);
    return;
  }
  const active = useTabs.getState().activeId;
  if (active) useResponses.getState().showPast(active, run, 0);
  showError(new Error(`The file ${path ?? "(unsaved)"} no longer exists`));
}
