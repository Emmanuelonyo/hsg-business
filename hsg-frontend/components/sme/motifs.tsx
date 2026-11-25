/**
 * Decorative motifs from the design system (docs/design/project/Main.dc.html):
 * arcs frame hero cards, the asterisk marks the "done" moment, the sparkle flags something new.
 * All are aria-hidden; they never carry meaning on their own.
 */
import type { CSSProperties } from "react";

/** Quarter-circle arcs anchored to the bottom-right corner of a square box. */
export function Arcs({ size, stroke, arcs, className = "", style }: {
  size: number; stroke: number;
  /** Each arc: its radius-offset start (the "M x size" point) and colour. */
  arcs: { start: number; color: string }[];
  className?: string; style?: CSSProperties;
}) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={`pointer-events-none absolute ${className}`} style={style}>
      {arcs.map((a) => (
        <path key={a.start} d={`M${a.start} ${size} A${size - a.start} ${size - a.start} 0 0 1 ${size} ${a.start}`} fill="none" stroke={a.color} strokeWidth={stroke} />
      ))}
    </svg>
  );
}

/** Bold asterisk (no tile) used for "done" moments. */
export function Asterisk({ size = 44, color = "#0D3542", className = "" }: { size?: number; color?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <g fill={color}>
        {[0, 45, 90, 135].map((r) => <rect key={r} x="20" y="2" width="8" height="44" rx="4" transform={`rotate(${r} 24 24)`} />)}
      </g>
    </svg>
  );
}

/** Four-point sparkle. */
export function Sparkle({ size = 22, color = "#0D3542", className = "" }: { size?: number; color?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path d="M24 0C25.5 15 33 22.5 48 24C33 25.5 25.5 33 24 48C22.5 33 15 25.5 0 24C15 22.5 22.5 15 24 0Z" fill={color} />
    </svg>
  );
}

/** Three small squares (the "· · ·" ornament on lime cards). */
export function Dots({ color = "#0D3542" }: { color?: string }) {
  return (
    <span aria-hidden="true" className="inline-flex gap-1">
      <span className="h-1.5 w-1.5" style={{ background: color }} />
      <span className="h-1.5 w-1.5" style={{ background: color }} />
      <span className="h-1.5 w-1.5" style={{ background: color }} />
    </span>
  );
}

const ICON_PATHS: Record<string, React.ReactNode> = {
  home: <path d="M3.5 9L10 3.5 16.5 9V16a1 1 0 0 1-1 1h-3.5v-5h-4v5H4.5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" />,
  send: <path d="M4.5 15.5L15.5 4.5M8 4.5h7.5V12" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />,
  funds: <path d="M15.5 4.5L4.5 15.5M12 15.5H4.5V8" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />,
  list: <path d="M4 6h12M4 10h12M4 14h8" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />,
  people: (
    <>
      <circle cx="8" cy="7" r="3" fill="none" stroke="currentColor" strokeWidth={1.7} />
      <path d="M2.5 16.5c.8-2.6 2.9-4 5.5-4s4.7 1.4 5.5 4M13 4.2a3 3 0 0 1 0 5.6M15 12.6c1.3.7 2.1 2 2.5 3.9" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
    </>
  ),
  signout: <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M12 13.5L15.5 10 12 6.5M15.5 10H8" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />,
  copy: (
    <>
      <rect x="7" y="7" width="9" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth={1.7} />
      <path d="M13 7V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" fill="none" stroke="currentColor" strokeWidth={1.7} />
    </>
  ),
  plus: <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />,
  close: <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />,
  back: <path d="M12 15l-5-5 5-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  arrow: <path d="M4 10h12M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  download: <path d="M10 3v10M6 9l4 4 4-4M4 16h12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />,
  alert: (
    <>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <path d="M10 6v5M10 14h.01" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </>
  ),
  clock: <><circle cx="10" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth={1.8} /><path d="M10 8v3.2l2 1.3M8 2.5h4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" /></>,
  shield: <path d="M10 2.5l6 2.5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />,
  menu: <path d="M3 6h14M3 10h14M3 14h14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />,
};

export type IconName = keyof typeof ICON_PATHS;
export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className={`shrink-0 ${className}`}>{ICON_PATHS[name]}</svg>;
}
