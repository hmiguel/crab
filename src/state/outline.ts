import { create } from "zustand";
import type { RequestBlock } from "../api";
import { normPath } from "../lib/paths";

/** Requests of open files, parsed from the editor text (unsaved edits included). */
type OutlineState = {
  byPath: Record<string, RequestBlock[]>;
  get(path: string): RequestBlock[] | undefined;
  set(path: string, requests: RequestBlock[]): void;
  forget(path: string): void;
};

export const useOutline = create<OutlineState>((set, get) => ({
  byPath: {},
  get: (path) => get().byPath[normPath(path)],
  set: (path, requests) => set((s) => ({ byPath: { ...s.byPath, [normPath(path)]: requests } })),
  forget: (path) =>
    set((s) => {
      const { [normPath(path)]: _, ...rest } = s.byPath;
      return { byPath: rest };
    }),
}));
