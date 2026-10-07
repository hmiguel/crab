import { ask, message } from "@tauri-apps/plugin-dialog";
import { toCrabError } from "../api";
import { forgetEditorState } from "../editor/state-cache";
import { useResponses } from "../state/responses";
import { isDirty, useTabs } from "../state/tabs";

export function showError(e: unknown): void {
  console.error(e);
  void message(toCrabError(e).message, { title: "Crab", kind: "error" });
}

export function saveTab(id: string): void {
  useTabs.getState().save(id).catch(showError);
}

export async function closeTabWithPrompt(id: string): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.id === id);
  if (!tab) return;
  if (isDirty(tab) && !(await ask(`Discard unsaved changes to ${tab.title}?`, { title: "Crab", kind: "warning" }))) return;
  useTabs.getState().closeTab(id);
  useResponses.getState().clear(id);
  forgetEditorState(id);
}
