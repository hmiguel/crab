import type { ErrorKind, ResolvedRequest, ResponseData } from "../api";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function statusClass(status: number): "info" | "ok" | "redirect" | "client-error" | "server-error" {
  if (status >= 500) return "server-error";
  if (status >= 400) return "client-error";
  if (status >= 300) return "redirect";
  if (status >= 200) return "ok";
  return "info";
}

/** Re-indent valid JSON text without parsing numbers (keeps big integers exact). */
export function reindentJson(text: string, indent = "  "): string {
  const s = text.trim();
  let out = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      continue;
    } else if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === close) {
        out += c + close;
        i = j;
      } else {
        depth++;
        out += c + "\n" + indent.repeat(depth);
      }
    } else if (c === "}" || c === "]") {
      depth--;
      out += "\n" + indent.repeat(depth) + c;
    } else if (c === ",") {
      out += ",\n" + indent.repeat(depth);
    } else if (c === ":") {
      out += ": ";
    } else {
      out += c;
    }
  }
  return out;
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function prettyBody(contentType: string | null, text: string): { text: string; lang: "json" | "text" } {
  const declared = !!contentType && /[/+]json\b/i.test(contentType);
  const looksLike = /^\s*[[{]/.test(text);
  if ((declared || looksLike) && isValidJson(text)) return { text: reindentJson(text), lang: "json" };
  return { text, lang: "text" };
}

export function formatRequest(req: ResolvedRequest): string {
  const head = [`${req.method} ${req.url}`, ...req.headers.map((h) => `${h.name}: ${h.value}`)].join("\n");
  return req.body ? `${head}\n\n${req.body}` : head;
}

export function formatRawResponse(r: ResponseData): string {
  const head = [`${r.httpVersion} ${r.status} ${r.statusText}`.trim(), ...r.headers.map((h) => `${h.name}: ${h.value}`)].join("\n");
  return `${head}\n\n${r.bodyText}`;
}

const ERROR_TITLES: Record<ErrorKind, string> = {
  parse: "Invalid request",
  unresolvedVars: "Unresolved variables",
  network: "Network error",
  timeout: "Timed out",
  cancelled: "Cancelled",
  io: "File error",
};

export const errorTitle = (kind: ErrorKind) => ERROR_TITLES[kind];
