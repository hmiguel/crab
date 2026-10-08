import { create } from "zustand";
import { api } from "../api";

export const ENV_COLORS = ["none", "green", "blue", "amber", "red"] as const;
export type EnvColor = (typeof ENV_COLORS)[number];
/** Crab-only settings, saved in the workspace state; env files stay compatible with other clients. */
export type EnvSettings = { selected: string | null; colors: Record<string, EnvColor>; confirmDanger: boolean };

const DEFAULTS: EnvSettings = { selected: null, colors: {}, confirmDanger: true };
const DANGER_NAME = /prod|production|live/i;

export function colorOf(s: Pick<EnvSettings, "colors">, name: string | null): EnvColor {
  if (!name) return "none";
  return s.colors[name] ?? (DANGER_NAME.test(name) ? "red" : "none");
}

export const isDanger = (s: Pick<EnvSettings, "colors">, name: string | null) => colorOf(s, name) === "red";

type EnvironmentsState = EnvSettings & {
  /** Environment names found in the workspace's env files. */
  names: string[];
  /** Env files that are ignored, e.g. both naming styles in one folder. */
  warnings: string[];
  load(saved: Partial<EnvSettings> | undefined): void;
  select(name: string | null): void;
  setColor(name: string, color: EnvColor): void;
  setConfirmDanger(on: boolean): void;
  refresh(roots: string[]): Promise<void>;
  settings(): EnvSettings;
};

export const useEnvironments = create<EnvironmentsState>((set, get) => ({
  ...DEFAULTS,
  names: [],
  warnings: [],
  load: (saved) => set({ ...DEFAULTS, ...saved }),
  select: (selected) => set({ selected }),
  setColor: (name, color) => set((s) => ({ colors: { ...s.colors, [name]: color } })),
  setConfirmDanger: (confirmDanger) => set({ confirmDanger }),
  async refresh(roots) {
    const { names, warnings } = await api.listEnvironments(roots).catch(() => ({ names: [], warnings: [] }));
    set({ names, warnings });
  },
  settings: () => {
    const { selected, colors, confirmDanger } = get();
    return { selected, colors, confirmDanger };
  },
}));
