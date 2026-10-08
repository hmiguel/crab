import type { RequestBlock } from "../api";

/** 0-based line of a character offset in LF text. */
export function lineAtOffset(text: string, offset: number): number {
  let line = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Index of the request whose span contains `line`, or null. */
export function requestIndexAt(requests: RequestBlock[], line: number): number | null {
  const i = requests.findIndex((r) => r.span.startLine <= line && line <= r.span.endLine);
  return i >= 0 ? i : null;
}
/** Groups a request's runs in history. Must match `crab_core::request_key`. */
export const requestKeyOf = (r: RequestBlock): string => r.name ?? `${r.method} ${r.url}`;

export function requestKeyAt(requests: RequestBlock[], line: number): string | null {
  const i = requestIndexAt(requests, line);
  return i === null ? null : requestKeyOf(requests[i]);
}
