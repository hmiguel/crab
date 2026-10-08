export function joinPath(root: string, rel: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  const base = /[\\/]$/.test(root) ? root.slice(0, -1) : root;
  return base + sep + rel.split("/").join(sep);
}

/** Forward slashes, no trailing slash; Windows drive paths compare case-insensitively. */
export function normPath(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(s) ? s.toLowerCase() : s;
}

export const samePath = (a: string, b: string) => normPath(a) === normPath(b);

export function basename(p: string): string {
  const s = p.replace(/[\\/]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

export function isUnder(path: string, root: string): boolean {
  const p = normPath(path);
  const r = normPath(root);
  return p === r || p.startsWith(r + "/");
}

export const isHttpFile = (p: string) => /\.(http|rest)$/i.test(p);

const ENV_FILES = ["crab.env.json", "crab.private.env.json", "http-client.env.json", "http-client.private.env.json", ".env"];
export const isEnvFile = (p: string) => ENV_FILES.includes(basename(p));
