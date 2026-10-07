import { expect, test } from "vitest";
import { StringStream } from "@codemirror/language";
import { httpStreamParser } from "./http-language";

function tokens(text: string): Array<[string, string]> {
  const state = httpStreamParser.startState!(2);
  const out: Array<[string, string]> = [];
  for (const line of text.split("\n")) {
    if (line === "") {
      httpStreamParser.blankLine?.(state, 2);
      continue;
    }
    const stream = new StringStream(line, 2, 2);
    while (!stream.eol()) {
      const style = httpStreamParser.token(stream, state);
      if (style) out.push([stream.current(), style]);
      stream.start = stream.pos;
    }
  }
  return out;
}

test("classifies separators, variables, methods, headers and body", () => {
  expect(tokens('### Create\n@host = x\n# note\nPOST https://{{host}}/a\nContent-Type: json\n\n{"a": "{{v}}"}')).toEqual([
    ["### Create", "heading"],
    ["@host", "atom"],
    ["# note", "comment"],
    ["POST", "keyword"],
    ["{{host}}", "variableName"],
    ["Content-Type", "propertyName"],
    ['{"a": "', "string"],
    ["{{v}}", "variableName"],
    ['"}', "string"],
  ]);
});

test("whitespace-only line before the request does not start the headers", () => {
  expect(tokens("   \nGET https://x.test")).toEqual([["GET", "keyword"]]);
});
