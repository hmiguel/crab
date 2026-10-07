import { expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { requestLinesField, setRequestLines } from "./run-gutter";

test("request lines are replaced by the effect and follow edits above them", () => {
  let state = EditorState.create({ doc: "a\nb\nGET https://x.test\n", extensions: [requestLinesField] });
  state = state.update({ effects: setRequestLines.of([2]) }).state;
  expect(state.field(requestLinesField)).toEqual([2]);
  state = state.update({ changes: { from: 0, insert: "new line\n" } }).state;
  expect(state.field(requestLinesField)).toEqual([3]);
});
