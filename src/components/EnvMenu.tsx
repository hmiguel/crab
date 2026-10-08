import { useEffect, useRef, useState } from "react";
import { colorOf, ENV_COLORS, useEnvironments } from "../state/environments";

/** Status bar control: pick the environment, its colour, and whether red environments ask before changes. */
export function EnvMenu() {
  const names = useEnvironments((s) => s.names);
  const warnings = useEnvironments((s) => s.warnings);
  const selected = useEnvironments((s) => s.selected);
  const colors = useEnvironments((s) => s.colors);
  const confirmDanger = useEnvironments((s) => s.confirmDanger);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const env = useEnvironments.getState();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Keep Escape from also cancelling a running request.
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const choose = (name: string | null) => { env.select(name); setOpen(false); };
  const color = colorOf({ colors }, selected);
  const missing = selected !== null && !names.includes(selected);

  return (
    <div className="env-menu" ref={ref}>
      <button className={`env-button env-${color}`} title={warnings.length ? `Environment (${warnings.length} warning${warnings.length > 1 ? "s" : ""})` : "Environment"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="env-dot" aria-hidden="true">●</span>
        {selected ?? "No environment"}{missing ? " (not found)" : ""}{warnings.length > 0 && <span className="env-warn-mark" aria-hidden="true"> ⚠</span>}
      </button>
      {open && (
        <div className="env-popup" role="menu">
          {names.length === 0 && (
            <div className="env-empty">No crab.env.json or http-client.env.json found in the workspace. See "Environments" in the README.</div>
          )}
          {warnings.map((w) => <div key={w} className="env-warning">⚠ {w}</div>)}
          {names.map((n) => (
            <button key={n} role="menuitemradio" aria-checked={n === selected} className={`env-item env-${colorOf({ colors }, n)}`} onClick={() => choose(n)}>
              <span className="check">{n === selected ? "✓" : ""}</span>
              <span className="env-dot" aria-hidden="true">●</span>
              {n}
            </button>
          ))}
          <button role="menuitemradio" aria-checked={selected === null} className="env-item" onClick={() => choose(null)}>
            <span className="check">{selected === null ? "✓" : ""}</span>No environment
          </button>
          {selected && (
            <>
              <hr />
              <div className="env-colors">
                <span>Colour of {selected}</span>
                {ENV_COLORS.map((c) => (
                  <button key={c} title={c} aria-label={`${c} colour`} aria-pressed={color === c} className={`swatch env-${c}`} onClick={() => env.setColor(selected, c)} />
                ))}
              </div>
            </>
          )}
          <hr />
          <label className="env-confirm">
            <input type="checkbox" checked={confirmDanger} onChange={(e) => env.setConfirmDanger(e.currentTarget.checked)} />
            Confirm before sending changes to red environments
          </label>
        </div>
      )}
    </div>
  );
}
