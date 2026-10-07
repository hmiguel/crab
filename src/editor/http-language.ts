import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

type HttpState = { afterRequestLine: boolean; inBody: boolean };

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\b/i;
const HEADER_NAME = /^[\w!#$%&'*+.^`|~{}-]+(?=\s*:)/;

export const httpStreamParser: StreamParser<HttpState> = {
  name: "http",
  startState: () => ({ afterRequestLine: false, inBody: false }),
  copyState: (s) => ({ ...s }),
  blankLine(state) {
    if (state.afterRequestLine) state.inBody = true;
  },
  token(stream, state) {
    if (stream.sol()) {
      if (stream.match(/^\s*$/)) {
        if (state.afterRequestLine) state.inBody = true;
        return null;
      }
      if (stream.match(/^\s*###.*/)) {
        state.afterRequestLine = false;
        state.inBody = false;
        return "heading";
      }
      if (!state.inBody) {
        if (stream.match(/^\s*(#|\/\/).*/)) return "comment";
        if (!state.afterRequestLine) {
          if (stream.match(/^@[\w.-]+/)) return "atom";
          state.afterRequestLine = true;
          if (stream.match(METHOD)) return "keyword";
        } else if (stream.match(HEADER_NAME)) {
          return "propertyName";
        }
      }
    }
    if (stream.match(/^\{\{[^{}]*\}\}/)) return "variableName";
    stream.next();
    while (!stream.eol() && !stream.match(/^\{\{/, false)) stream.next();
    return state.inBody ? "string" : null;
  },
};

export const httpLanguage = StreamLanguage.define(httpStreamParser);

/** Shared by the editor and the read-only response views (JSON tokens included). */
export const httpHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading, color: "var(--hl-separator)", fontWeight: "bold" },
    { tag: t.comment, color: "var(--hl-comment)", fontStyle: "italic" },
    { tag: t.keyword, color: "var(--hl-method)", fontWeight: "bold" },
    { tag: t.propertyName, color: "var(--hl-header)" },
    { tag: [t.variableName, t.atom], color: "var(--hl-var)" },
    { tag: t.string, color: "var(--hl-body)" },
    { tag: t.number, color: "var(--hl-number)" },
    { tag: [t.bool, t.null], color: "var(--hl-method)" },
  ]),
);
