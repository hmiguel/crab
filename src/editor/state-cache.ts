import type { EditorState } from "@codemirror/state";

/** Per-tab editor state (keeps undo history and selection while switching tabs). */
export const editorStates = new Map<string, EditorState>();

export function forgetEditorState(tabId: string) {
  editorStates.delete(tabId);
}
