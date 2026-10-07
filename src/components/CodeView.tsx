import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { foldGutter } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { httpHighlight, httpLanguage } from "../editor/http-language";
import { editorTheme } from "../editor/theme";

export function CodeView({ text, lang }: { text: string; lang: "json" | "text" | "http" }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const language = lang === "json" ? [json(), foldGutter()] : lang === "http" ? [httpLanguage] : [];
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text,
        extensions: [EditorState.readOnly.of(true), lineNumbers(), EditorView.lineWrapping, ...language, httpHighlight, editorTheme],
      }),
    });
    return () => view.destroy();
  }, [text, lang]);
  return <div className="codeview" ref={host} />;
}
