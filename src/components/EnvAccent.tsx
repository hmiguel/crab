import { useEffect } from "react";
import { colorOf, useEnvironments, type EnvColor } from "../state/environments";

export function envCssVars(color: EnvColor): { bar: string; marker: string } {
  return color === "none" ? { bar: "transparent", marker: "var(--accent)" } : { bar: `var(--env-${color})`, marker: `var(--env-${color})` };
}

/** A bar across the top of the window in the environment's colour; also tints the ▶ markers and, for red, the status bar. */
export function EnvAccent() {
  const color = useEnvironments((s) => colorOf(s, s.selected));
  useEffect(() => {
    const root = document.documentElement;
    const vars = envCssVars(color);
    root.style.setProperty("--env-color", vars.bar);
    root.style.setProperty("--env-marker", vars.marker);
    root.dataset.envDanger = String(color === "red");
  }, [color]);
  return <div className="env-bar" aria-hidden="true" />;
}
