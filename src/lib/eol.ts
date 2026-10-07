export type Eol = "\n" | "\r\n";

export const detectEol = (text: string): Eol => (text.includes("\r\n") ? "\r\n" : "\n");
export const toLf = (text: string) => text.replace(/\r\n/g, "\n");
export const fromLf = (text: string, eol: Eol) => (eol === "\n" ? text : text.replace(/\n/g, "\r\n"));
