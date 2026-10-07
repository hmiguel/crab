import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { api } from "../api";
import { debounce } from "../lib/debounce";
import { cancelActive, runAt } from "../state/run";
import { useTabs, type Tab } from "../state/tabs";
import { saveTab, showError } from "../ui/actions";
import { httpHighlight, httpLanguage } from "./http-language";
import { runGutter, setRequestLines } from "./run-gutter";
import { editorStates } from "./state-cache";
import { editorTheme } from "./theme";

const cursorLine = (state: EditorState) => state.doc.lineAt(state.selection.main.head).number - 1;

function createState(tab: Tab): EditorState {
  const id = tab.id;
  return EditorState.create({
    doc: tab.text,
    selection: { anchor: Math.min(tab.cursor, tab.text.length) },
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      runGutter((line) => void runAt(id, line)),
      lintGutter(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      bracketMatching(),
      httpLanguage,
      httpHighlight,
      editorTheme,
      keymap.of([
        { key: "Mod-Enter", run: (v) => { void runAt(id, cursorLine(v.state)); return true; } },
        { key: "Mod-s", run: () => { saveTab(id); return true; } },
        { key: "Escape", run: () => { cancelActive(id); return false; } },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) useTabs.getState().setText(id, u.state.doc.toString());
        if (u.docChanged || u.selectionSet) useTabs.getState().setView(id, u.state.selection.main.head, u.view.scrollDOM.scrollTop);
      }),
    ],
  });
}

export function Editor() {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const shownId = useRef<string | null>(null);
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const tabId = tab?.id ?? null;
  const text = tab?.text;
  const revealLine = tab?.revealLine ?? null;

  // One EditorView for the component's lifetime; documents are swapped per tab.
  useEffect(() => {
    const view = new EditorView({ parent: host.current! });
    viewRef.current = view;
    const onScroll = debounce(() => {
      const id = shownId.current;
      if (id) useTabs.getState().setView(id, view.state.selection.main.head, view.scrollDOM.scrollTop);
    }, 200);
    view.scrollDOM.addEventListener("scroll", onScroll);
    return () => {
      if (shownId.current && useTabs.getState().tabs.some((t) => t.id === shownId.current)) editorStates.set(shownId.current, view.state);
      view.scrollDOM.removeEventListener("scroll", onScroll);
      onScroll.cancel();
      view.destroy();
      viewRef.current = null;
      shownId.current = null;
    };
  }, []);

  // Swap documents when the active tab changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const prev = shownId.current;
    if (prev && useTabs.getState().tabs.some((t) => t.id === prev)) editorStates.set(prev, view.state);
    shownId.current = tabId;
    if (!tabId) return;
    const t = useTabs.getState().tabs.find((x) => x.id === tabId)!;
    view.setState(editorStates.get(tabId) ?? createState(t));
    if (t.revealLine === null) requestAnimationFrame(() => { view.scrollDOM.scrollTop = t.scrollTop; });
    view.focus();
  }, [tabId]);

  // Apply text changes that did not come from typing (reload from disk).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || text === undefined || shownId.current !== tabId) return;
    if (view.state.doc.toString() !== text) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, [text, tabId]);

  // Re-parse (debounced) to place ▶ markers and diagnostics.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || text === undefined) return;
    const timer = setTimeout(() => {
      api
        .parseText(text)
        .then((parsed) => {
          if (shownId.current !== tabId || view.state.doc.toString() !== text) return;
          const doc = view.state.doc;
          const diagnostics: CmDiagnostic[] = parsed.diagnostics
            .filter((d) => d.line < doc.lines)
            .map((d) => {
              const line = doc.line(d.line + 1);
              return { from: line.from, to: line.to, severity: "warning", message: d.message };
            });
          view.dispatch(setDiagnostics(view.state, diagnostics));
          view.dispatch({ effects: setRequestLines.of(parsed.requests.map((r) => r.requestLine)) });
        })
        .catch(console.error);
    }, 150);
    return () => clearTimeout(timer);
  }, [text, tabId]);

  // Jump to a request picked in the sidebar.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || revealLine === null || !tabId || shownId.current !== tabId) return;
    const line = view.state.doc.line(Math.min(revealLine + 1, view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "start" }) });
    view.focus();
    useTabs.getState().clearReveal(tabId);
  }, [revealLine, tabId]);

  return (
    <div className="editor-pane">
      {tab?.externallyChanged && (
        <div className="banner">
          This file changed on disk.
          <button onClick={() => useTabs.getState().reloadFromDisk(tab.id).catch(showError)}>Reload</button>
          <button onClick={() => useTabs.getState().keepMine(tab.id)}>Keep my changes</button>
        </div>
      )}
      <div className="editor-host" ref={host} hidden={!tab} />
      {!tab && <div className="placeholder">Open a .http file from the sidebar</div>}
    </div>
  );
}
