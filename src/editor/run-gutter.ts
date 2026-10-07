import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { gutter, GutterMarker } from "@codemirror/view";
import { shortcutLabel } from "../lib/keys";

/** 0-based request lines, as reported by the Rust parser. */
export const setRequestLines = StateEffect.define<number[]>();

export const requestLinesField = StateField.define<number[]>({
  create: () => [],
  update(lines, tr) {
    for (const e of tr.effects) if (e.is(setRequestLines)) return e.value;
    if (!tr.docChanged) return lines;
    // Keep markers attached to their lines until the next parse arrives.
    const before = tr.startState.doc;
    return lines
      .filter((l) => l < before.lines)
      .map((l) => tr.state.doc.lineAt(tr.changes.mapPos(before.line(l + 1).from, 1)).number - 1);
  },
});

class RunMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-run-marker";
    el.textContent = "▶";
    el.title = `Run request (${shortcutLabel("Enter")})`;
    return el;
  }
}
const runMarker = new RunMarker();

export function runGutter(onRun: (line: number) => void) {
  return [
    requestLinesField,
    gutter({
      class: "cm-run-gutter",
      markers: (view) => {
        const doc = view.state.doc;
        const lines = view.state.field(requestLinesField).filter((l) => l < doc.lines);
        return RangeSet.of(lines.map((l) => runMarker.range(doc.line(l + 1).from)), true);
      },
      domEventHandlers: {
        mousedown(view, block) {
          const line = view.state.doc.lineAt(block.from).number - 1;
          if (!view.state.field(requestLinesField).includes(line)) return false;
          onRun(line);
          return true;
        },
      },
    }),
  ];
}
