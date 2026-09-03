import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cx, formatCompact } from "@/lib/cx";

/*
  Every chart here is styled from tokens. Nothing is left at a Recharts
  default, including the tooltip, axes, grid and series colours, so a
  tenant re-skin carries into the data visuals instead of leaving
  library blue behind.
*/

const AXIS = {
  stroke: "var(--chart-axis)",
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "var(--font-body)",
};

/* Shared dark tooltip with a caret, matching the reference shots. */
function ChartTooltip({ active, payload, label, formatter, labelSuffix }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="relative">
      <div className="rounded-[var(--radius-sm)] bg-[var(--ink-950)] px-3 py-2 shadow-[var(--shadow-lg)] min-w-[132px] animate-rise">
        <div className="text-2xs font-bold text-[var(--ink-400)] tracking-wide mb-1.5">
          {label}
          {labelSuffix}
        </div>
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="size-2 rounded-[3px] shrink-0" style={{ background: p.color }} />
            <span className="text-[var(--ink-300)] capitalize flex-1">{p.name ?? p.dataKey}</span>
            <span className="font-bold text-white tnum">
              {formatter ? formatter(p.value ?? 0, p.dataKey) : p.value}
            </span>
          </div>
        ))}
      </div>
      <span
        className="absolute left-1/2 -translate-x-1/2 -bottom-1 size-2 rotate-45 bg-[var(--ink-950)]"
        aria-hidden="true"
      />
    </div>
  );
}

/* Dashed horizontal rules. A full grid adds noise at dashboard size. */
function Rules({ count = 4, top = 12, gap = 26 }) {
  return Array.from({ length: count }).map((_, i) => (
    <line
      key={i}
      x1="0%"
      x2="100%"
      y1={`${top + i * gap}%`}
      y2={`${top + i * gap}%`}
      stroke="var(--chart-grid)"
      strokeDasharray="3 5"
    />
  ));
}

/* ------------------------------------------------------------------ */
/* Engagement area                                                     */
/* ------------------------------------------------------------------ */

export function EngagementArea({ data, height = 216, compareLabel }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="cc-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--portal-accent)" stopOpacity={0.26} />
              <stop offset="100%" stopColor="var(--portal-accent)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <Rules />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={AXIS}
            dy={6}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS}
            width={46}
            tickFormatter={(v) => formatCompact(Number(v))}
          />
          <Tooltip
            cursor={{ stroke: "var(--portal-accent)", strokeWidth: 1, strokeDasharray: "4 4" }}
            content={<ChartTooltip />}
          />
          {compareLabel && (
            <Area
              type="monotone"
              dataKey="compare"
              name={compareLabel}
              stroke="var(--ink-300)"
              strokeWidth={1.6}
              strokeDasharray="4 4"
              fill="none"
              dot={false}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            name="Active learners"
            stroke="var(--portal-accent)"
            strokeWidth={2.4}
            fill="url(#cc-area)"
            dot={false}
            activeDot={{
              r: 4.5,
              fill: "var(--portal-accent)",
              stroke: "var(--surface)",
              strokeWidth: 2.5,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Revenue bars                                                        */
/* ------------------------------------------------------------------ */

/*
  Hover raises one bar to full accent and leaves the rest soft, the
  pattern from the Filllo reference. Reads far better than colouring
  every bar identically and relying on the tooltip alone.
*/
export function RevenueBars({ data, height = 216, currencyPrefix = "Rs " }) {
  const [hover, setHover] = useState(null);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
          onMouseMove={(s) =>
            setHover(typeof s.activeTooltipIndex === "number" ? s.activeTooltipIndex : null)
          }
          onMouseLeave={() => setHover(null)}
          barCategoryGap="26%"
        >
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} dy={6} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS}
            width={46}
            tickFormatter={(v) => formatCompact(Number(v))}
          />
          <Tooltip
            cursor={false}
            content={<ChartTooltip formatter={(v) => `${currencyPrefix}${v.toLocaleString("en-US")}`} />}
          />
          <Bar dataKey="value" name="Revenue" radius={[7, 7, 3, 3]} maxBarSize={44}>
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={
                  hover === i ? "var(--portal-accent)" : "var(--portal-accent-soft)"
                }
                className="transition-[fill] duration-[var(--dur-fast)]"
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pass rate donut                                                     */
/* ------------------------------------------------------------------ */

export function PassRateDonut({ data, height = 180 }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className="flex items-center gap-5">
      <div style={{ height, width: height }} className="relative shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="66%"
              outerRadius="94%"
              paddingAngle={2.5}
              cornerRadius={5}
              stroke="none"
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            {/*
              allowEscapeViewBox is the fix for the tooltip sitting on
              top of the donut. The chart container is only as wide as
              the donut, and Recharts clips the tooltip to that box by
              default, so it had nowhere to go but over the segments.
              Letting it escape, nudging it clear of the cursor, and
              lifting it above the ring makes it readable.
            */}
            <Tooltip
              allowEscapeViewBox={{ x: true, y: true }}
              offset={14}
              wrapperStyle={{ zIndex: 30, pointerEvents: "none" }}
              content={
                <ChartTooltip formatter={(v) => `${v} (${Math.round((v / total) * 100)}%)`} />
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold font-display tnum leading-none">
            {Math.round(((data[0]?.value ?? 0) / total) * 100)}%
          </span>
          <span className="text-2xs text-ink-500 mt-1">passing</span>
        </div>
      </div>
      <ul className="flex-1 min-w-0 space-y-2.5">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2.5 text-sm">
            <span className="size-2.5 rounded-[4px] shrink-0" style={{ background: d.color }} />
            <span className="text-ink-600 flex-1 truncate">{d.label}</span>
            <span className="font-semibold tnum">{d.value}</span>
            <span className="text-2xs text-ink-400 tnum w-9 text-right">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

/*
  Hand rolled rather than a chart instance. The Parent dashboard renders
  one per subject, and spinning up a Recharts container for an 86 pixel
  wide trend is wasteful.
*/
export function Sparkline({ values, width = 86, height = 28, tone }) {
  const { path, areaPath, last, gid } = useMemo(() => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = width / Math.max(1, values.length - 1);
    const pts = values.map((v, i) => {
      const x = i * step;
      const y = height - 3 - ((v - min) / span) * (height - 6);
      return [x, y];
    });
    const d = pts.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ");
    return {
      path: d,
      areaPath: `${d} L${width},${height} L0,${height} Z`,
      last: pts[pts.length - 1],
      gid: `sp-${values.join("-")}`,
    };
  }, [values, width, height]);

  const color = tone ?? "var(--portal-accent)";

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gid})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      {last && <circle cx={last[0]} cy={last[1]} r={2.4} fill={color} />}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Attendance heatmap                                                  */
/* ------------------------------------------------------------------ */

const HEAT_FILL = {
  present: "var(--success-mid)",
  late: "var(--warning-mid)",
  absent: "var(--danger-mid)",
  none: "var(--ink-100)",
};

/*
  Calendar heatmap for the Parent portal. Built by hand because the
  chart libraries model this as a scatter plot, which loses the calendar
  reading that is the entire point for a parent scanning a month.
*/
export function AttendanceHeatmap({ weeks, onSelect }) {
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div className="flex gap-2">
      <div className="flex flex-col gap-1 pt-0.5">
        {days.map((d, i) => (
          <span
            key={i}
            className="text-2xs text-ink-400 font-semibold h-5 leading-5 w-3 text-center"
          >
            {d}
          </span>
        ))}
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((cell) => (
              <button
                key={cell.date}
                onClick={() => onSelect?.(cell)}
                title={`${cell.date}: ${cell.mark}`}
                disabled={cell.mark === "none"}
                className={cx(
                  "size-5 rounded-[5px] transition-transform duration-[var(--dur-fast)]",
                  cell.mark !== "none" && "hover:scale-115 cursor-pointer",
                )}
                style={{ background: HEAT_FILL[cell.mark] }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HeatmapLegend() {
  const items = [
    ["present", "Present"],
    ["late", "Late"],
    ["absent", "Absent"],
    ["none", "No class"],
  ];
  return (
    <div className="flex items-center gap-3.5 flex-wrap">
      {items.map(([k, label]) => (
        <span key={k} className="flex items-center gap-1.5 text-2xs text-ink-500 font-semibold">
          <span className="size-2.5 rounded-[4px]" style={{ background: HEAT_FILL[k] }} />
          {label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Multi line, used by Super Admin for MRR                             */
/* ------------------------------------------------------------------ */

export function TrendLines({ data, series, height = 230, valuePrefix = "" }) {
  /*
    The gutter is sized from the prefix rather than fixed. It was fixed
    at 52px, which fit "$1.6k" and clipped "Rs 1.6k" to a stub once the
    platform figures moved to rupees. Deriving it means a longer
    currency label cannot silently lose its first characters.
  */
  const axisWidth = 52 + valuePrefix.length * 7;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 10, bottom: 0, left: valuePrefix ? -4 : -14 }}
        >
          <Rules top={10} gap={27} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} dy={6} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS}
            width={axisWidth}
            tickFormatter={(v) => `${valuePrefix}${formatCompact(Number(v))}`}
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "4 4" }}
            content={<ChartTooltip formatter={(v) => `${valuePrefix}${v.toLocaleString("en-US")}`} />}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2.2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2.5, stroke: "var(--surface)" }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* Compact stacked bar used for tier mix. */
/*
  A proportional bar with a legend.

  `format` exists because the same component carries two kinds of
  number. On Platform health the segments are tenant counts, where a
  bare "3" is right. On Subscriptions they are rupee sums, where a bare
  "75000" is not a figure anyone can read at a glance.
*/
export function StackedMix({ segments, height = 10, format = (v) => v }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <div
        className="flex w-full overflow-hidden rounded-[var(--radius-pill)] gap-0.5"
        style={{ height }}
      >
        {segments.map((s) => (
          <div
            key={s.label}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${format(s.value)}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-2xs font-semibold">
            <span className="size-2 rounded-[3px]" style={{ background: s.color }} />
            <span className="text-ink-600">{s.label}</span>
            <span className="text-ink-950 tnum">{format(s.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
