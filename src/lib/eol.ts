export type Eol = "\n" | "\r\n";

export const detectEol = (text: string): Eol => (text.includes("\r\n") ? "\r\n" : "\n");
export const toLf = (text: string) => text.replace(/\r\n/g, "\n");
export const fromLf = (text: string, eol: Eol) => (eol === "\n" ? text : text.replace(/\n/g, "\r\n"));

const BOM = "﻿";

/** Disk text → editor text: LF only and no BOM; remembers both so saving restores them. */
export function decodeDisk(raw: string): { text: string; eol: Eol; bom: boolean } {
  const bom = raw.startsWith(BOM);
  return { text: toLf(bom ? raw.slice(1) : raw), eol: detectEol(raw), bom };
}

export const encodeDisk = (text: string, eol: Eol, bom: boolean) => (bom ? BOM : "") + fromLf(text, eol);
