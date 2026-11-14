import { useId, useState, type ReactNode } from "react";

/* Small, dependency-free SVG charts. Colours come from CSS variables so light/dark follow the app. */

// Enough distinct colours for every category to keep its own; the first eight follow the theme, the rest are fixed.
export const SERIES = [
  "var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)",
  "#0ea5e9", "#a855f7", "#14b8a6", "#84cc16", "#f43f5e", "#a16207", "#06b6d4", "#d946ef", "#818cf8", "#65a30d", "#fb923c", "#64748b",
  "#22d3ee", "#c084fc", "#4ade80", "#facc15", "#f472b6", "#94a3b8",
];
export const OTHER_COLOR = "var(--muted)";

export interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

export function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.content}
    </div>
  );
}

/** Position a tooltip relative to the chart wrapper. */
function tipAt(e: React.MouseEvent | React.TouchEvent, content: ReactNode): Tip {
  const wrap = (e.currentTarget as Element).closest(".viz") as HTMLElement | null;
  const r = wrap?.getBoundingClientRect();
  const p = "touches" in e ? e.touches[0] : (e as React.MouseEvent);
  return { x: (p?.clientX ?? 0) - (r?.left ?? 0), y: (p?.clientY ?? 0) - (r?.top ?? 0) - 12, content };
}

// ---------- Donut ----------

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Donut({ slices, total, center, format }: { slices: Slice[]; total: number; center: ReactNode; format: (n: number) => string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const size = 180, r = 74, stroke = 22, c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const gap = 2; // px of surface between segments
  return (
    <div className="viz donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Spending by category">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--card-2)" strokeWidth={stroke} />
        {total > 0 &&
          slices.map((s) => {
            const len = (s.value / total) * circ;
            const dash = Math.max(0, len - gap);
            const el = (
              <circle
                key={s.key}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={active === s.key ? stroke + 4 : stroke}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${c} ${c})`}
                style={{ transition: "stroke-width 0.15s", opacity: active && active !== s.key ? 0.45 : 1, cursor: "pointer" }}
                onMouseEnter={(e) => {
                  setActive(s.key);
                  setTip(tipAt(e, <><b>{s.label}</b><br />{format(s.value)} · {Math.round((s.value / total) * 100)}%</>));
                }}
                onMouseMove={(e) => setTip(tipAt(e, <><b>{s.label}</b><br />{format(s.value)} · {Math.round((s.value / total) * 100)}%</>))}
                onMouseLeave={() => {
                  setActive(null);
                  setTip(null);
                }}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="donut-center">{center}</div>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Grouped / single bars ----------

export interface BarGroup {
  label: string; // x label
  values: number[]; // one per series
  meta?: ReactNode; // tooltip body
}

export function Bars({
  groups,
  series,
  format,
  height = 160,
  highlight,
  onPick,
}: {
  groups: BarGroup[];
  series: { name: string; color: string }[];
  format: (n: number) => string;
  height?: number;
  highlight?: number;
  onPick?: (i: number) => void;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const id = useId();
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const n = groups.length;
  const w = 100; // percent-based x via viewBox width 100
  const padL = 0, padB = 18, padT = 6;
  const plotH = height - padB - padT;
  const groupW = w / Math.max(1, n);
  const barGap = 1.2;
  const barW = Math.max(1.5, (groupW - barGap * (series.length + 1)) / series.length);
  const ticks = niceTicks(max, 3);
  const every = n > 14 ? Math.ceil(n / 7) : 1;
  return (
    <div className="viz">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-labelledby={id}>
        <title id={id}>{series.map((s) => s.name).join(" vs ")}</title>
        {ticks.map((t) => {
          const y = padT + plotH - (t / max) * plotH;
          return <line key={t} x1={padL} x2={w} y1={y} y2={y} stroke="var(--line)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />;
        })}
        {groups.map((g, gi) => {
          const x0 = padL + gi * groupW + barGap;
          return (
            <g key={gi} style={{ cursor: onPick ? "pointer" : "default" }} onClick={() => onPick?.(gi)}>
              <rect
                x={gi * groupW}
                y={padT}
                width={groupW}
                height={plotH}
                fill="transparent"
                onMouseEnter={(e) => setTip(tipAt(e, <><b>{g.label}</b><br />{series.map((s, si) => <span key={si}>{s.name}: {format(g.values[si] ?? 0)}<br /></span>)}{g.meta}</>))}
                onMouseMove={(e) => setTip(tipAt(e, <><b>{g.label}</b><br />{series.map((s, si) => <span key={si}>{s.name}: {format(g.values[si] ?? 0)}<br /></span>)}{g.meta}</>))}
                onMouseLeave={() => setTip(null)}
              />
              {series.map((s, si) => {
                const v = g.values[si] ?? 0;
                const h = (v / max) * plotH;
                const x = x0 + si * (barW + barGap);
                return (
                  <rect
                    key={si}
                    x={x}
                    y={padT + plotH - h}
                    width={barW}
                    height={Math.max(h, v > 0 ? 0.8 : 0)}
                    rx={0.8}
                    fill={s.color}
                    opacity={highlight === undefined || highlight === gi ? 1 : 0.4}
                    style={{ pointerEvents: "none" }}
                  />
                );
              })}
              {gi % every === 0 && (
                <text x={gi * groupW + groupW / 2} y={height - 4} fontSize={3.2} textAnchor="middle" fill="var(--muted)" style={{ fontFamily: "inherit" }} textLength={undefined}>
                  {g.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------- Line / area ----------

export function Line({ points, labels, format, color = "var(--s1)", height = 140 }: { points: number[]; labels: string[]; format: (n: number) => string; color?: string; height?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const w = 100, padT = 8, padB = 18, padL = 0;
  const plotH = height - padT - padB;
  const min = Math.min(0, ...points);
  const max = Math.max(1, ...points);
  const span = max - min || 1;
  const n = points.length;
  const x = (i: number) => padL + (n > 1 ? (i / (n - 1)) * (w - padL) : w / 2);
  const y = (v: number) => padT + plotH - ((v - min) / span) * plotH;
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${path} L${x(n - 1).toFixed(2)},${y(min).toFixed(2)} L${x(0).toFixed(2)},${y(min).toFixed(2)} Z`;
  const ticks = niceTicks(max, 3);
  const every = n > 8 ? Math.ceil(n / 6) : 1;
  return (
    <div className="viz">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-labelledby={id}>
        <title id={id}>Trend</title>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <line key={t} x1={0} x2={w} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        ))}
        {n > 1 && <path d={area} fill={`url(#${id}-g)`} />}
        <path d={path} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="var(--muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 2" />}
        {points.map((v, i) => (
          <g key={i}>
            <rect
              x={x(i) - (w / Math.max(1, n)) / 2}
              y={0}
              width={w / Math.max(1, n)}
              height={height}
              fill="transparent"
              onMouseEnter={(e) => {
                setHover(i);
                setTip(tipAt(e, <><b>{labels[i]}</b><br />{format(v)}</>));
              }}
              onMouseMove={(e) => setTip(tipAt(e, <><b>{labels[i]}</b><br />{format(v)}</>))}
              onMouseLeave={() => {
                setHover(null);
                setTip(null);
              }}
            />
            {(hover === i || i === n - 1) && (
              <circle cx={x(i)} cy={y(v)} r={hover === i ? 2.4 : 1.8} fill={color} stroke="var(--card)" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
            )}
            {i % every === 0 && (
              <text x={x(i)} y={height - 4} fontSize={3.2} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fill="var(--muted)" style={{ fontFamily: "inherit" }}>
                {labels[i]}
              </text>
            )}
          </g>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function niceTicks(max: number, count: number): number[] {
  if (max <= 0) return [];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = step; v <= max; v += step) out.push(v);
  return out;
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <div key={i.label} className="legend-item">
          <span className="swatch" style={{ background: i.color }} />
          <span className="legend-label">{i.label}</span>
          {i.value && <span className="legend-value">{i.value}</span>}
        </div>
      ))}
    </div>
  );
}
