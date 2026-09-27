import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { formatMoney } from '@domain/money';
import { addDays, addMonths, diffDays, diffMonths, formatDate, formatMonth, startOfMonth } from '@domain/dates';
import { useApp } from '../lib/app';

/**
 * Small, dependency-free SVG charts. Every chart answers one question, has a table view,
 * a legend when there is more than one series, and hover details. One y-axis only.
 */

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

/** Shortens an axis label to fit roughly `px` of width (about 6.5px per character at axis size). */
function fitLabel(label: string, px: number): string {
  const max = Math.max(3, Math.floor((px - 6) / 6.5));
  return label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`;
}

/** Calendar-aligned x-axis labels: month starts for long ranges, evenly spaced days for short ones. */
export function timeTicks(first: string, last: string, max = 6): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  if (diffDays(first, last) > 75) {
    const step = Math.max(1, Math.ceil((diffMonths(first, last) + 1) / max));
    let m = startOfMonth(first);
    if (m < first) m = addMonths(m, 1);
    for (; m <= last; m = addMonths(m, step)) out.push({ date: m, label: formatMonth(m) });
  } else {
    const step = Math.max(1, Math.ceil(diffDays(first, last) / max));
    for (let d = first; d <= last; d = addDays(d, step)) out.push({ date: d, label: formatDate(d, { noYear: true }) });
  }
  return out;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(240, Math.floor(entries[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

function compactMoney(cents: number): string {
  const d = cents / 100;
  const abs = Math.abs(d);
  const sign = d < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function ChartFrame({ title, legend, table, children, summary }: { title: string; legend?: { label: string; color: string; line?: boolean }[]; table: ReactNode; children: ReactNode; summary?: string }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="chart" style={{ margin: 0 }} aria-label={title}>
      <div className="row-between" style={{ marginBottom: 4 }}>
        {legend && legend.length > 1 ? (
          <div className="chart-legend" aria-label="Legend">
            {legend.map((l) => <span key={l.label}><span className={`key ${l.line ? 'key-line' : ''}`} style={{ background: l.color }} />{l.label}</span>)}
          </div>
        ) : <span />}
        <button className="btn btn-ghost btn-sm" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>{showTable ? 'Show chart' : 'Show as table'}</button>
      </div>
      {summary && <figcaption className="sr-only">{summary}</figcaption>}
      {showTable ? table : children}
    </figure>
  );
}

/* ------------------------------ grouped columns ------------------------------ */

export interface ColumnDatum {
  label: string;
  values: number[];
  note?: string;
}

export function ColumnChart({ title, series, data, height = 220, summary }: { title: string; series: string[]; data: ColumnDatum[]; height?: number; summary?: string }) {
  const { privacy } = useApp();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 56, r: 10, t: 12, b: 26 };
  const all = data.flatMap((d) => d.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(1, ...all), 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const y = (v: number) => pad.t + innerH - ((v - lo) / (hi - lo)) * innerH;
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(24, (band * 0.7) / series.length);
  const fmt = (c: number) => (privacy ? '•••' : compactMoney(c));
  const table = (
    <div className="table-wrap"><table className="table"><thead><tr><th>Period</th>{series.map((s) => <th key={s} className="num">{s}</th>)}</tr></thead>
      <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}{d.note ? ` (${d.note})` : ''}</td>{d.values.map((v, i) => <td key={i} className="num">{privacy ? '$•••••' : formatMoney(v)}</td>)}</tr>)}</tbody></table></div>
  );
  return (
    <ChartFrame title={title} legend={series.map((s, i) => ({ label: s, color: SERIES[i] }))} table={table} summary={summary}>
      <div ref={ref} style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
        <svg height={height} role="img" aria-label={summary ?? title}>
          <g className="axis">
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
                <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>
              </g>
            ))}
            {data.map((d, i) => (i % Math.ceil(data.length / 12) === 0 ? <text key={d.label} x={pad.l + band * i + band / 2} y={height - 8} textAnchor="middle"><title>{d.label}</title>{fitLabel(d.label, band * Math.ceil(data.length / 12))}</text> : null))}
          </g>
          <line className="baseline" x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} />
          {data.map((d, i) => {
            const groupW = barW * series.length + 2 * (series.length - 1);
            const x0 = pad.l + band * i + (band - groupW) / 2;
            return (
              <g key={d.label} opacity={hover === null || hover === i ? 1 : 0.55}>
                {d.values.map((v, s) => {
                  const top = y(Math.max(0, v));
                  const h = Math.max(1, Math.abs(y(v) - y(0)));
                  const r = Math.min(4, h, barW / 2);
                  const x = x0 + s * (barW + 2);
                  // Rounded data end, square at the baseline.
                  const path = v >= 0
                    ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`
                    : `M${x},${y(0)} V${y(0) + h - r} Q${x},${y(0) + h} ${x + r},${y(0) + h} H${x + barW - r} Q${x + barW},${y(0) + h} ${x + barW},${y(0) + h - r} V${y(0)} Z`;
                  return <path key={s} d={path} fill={SERIES[s]} />;
                })}
                <rect x={pad.l + band * i} y={pad.t} width={band} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
        {hover !== null && data[hover] && (
          <div className="chart-tip" style={{ left: Math.min(width - 180, pad.l + band * hover + band / 2 + 8), top: 8 }}>
            <div className="tip-title">{data[hover].label}{data[hover].note ? ` · ${data[hover].note}` : ''}</div>
            {series.map((s, i) => (
              <div className="tip-row" key={s}><span><span className="key" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: SERIES[i], marginRight: 6 }} />{s}</span><span className="num">{privacy ? '$•••••' : formatMoney(data[hover].values[i])}</span></div>
            ))}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

/* ------------------------------ line chart ------------------------------ */

export interface LineSeries {
  name: string;
  points: { date: string; value: number }[];
}

export function LineChart({ title, series, height = 240, reference, summary, area }: { title: string; series: LineSeries[]; height?: number; reference?: { value: number; label: string }; summary?: string; area?: boolean }) {
  const { privacy } = useApp();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const pad = { l: 60, r: series.length === 1 ? 70 : 12, t: 12, b: 26 };
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  if (!dates.length) return <div className="muted">No data to chart yet.</div>;
  const t0 = new Date(dates[0]).getTime();
  const t1 = new Date(dates[dates.length - 1]).getTime() || t0 + 1;
  const vals = series.flatMap((s) => s.points.map((p) => p.value)).concat(reference ? [reference.value] : []);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals, 1), 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const innerW = width - pad.l - pad.r, innerH = height - pad.t - pad.b;
  const x = (d: string) => pad.l + ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0)) * innerW;
  const y = (v: number) => pad.t + innerH - ((v - lo) / (hi - lo)) * innerH;
  const fmt = (c: number) => (privacy ? '•••' : compactMoney(c));
  const xLabels = timeTicks(dates[0], dates[dates.length - 1], Math.max(2, Math.floor(innerW / 110)));
  const nearest = hoverX === null ? null : dates.reduce((best, d) => (Math.abs(x(d) - hoverX) < Math.abs(x(best) - hoverX) ? d : best), dates[0]);
  const table = (
    <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}><table className="table"><thead><tr><th>Date</th>{series.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
      <tbody>{dates.map((d) => <tr key={d}><td>{formatDate(d)}</td>{series.map((s) => { const p = s.points.find((q) => q.date === d); return <td key={s.name} className="num">{p ? (privacy ? '$•••••' : formatMoney(p.value)) : '—'}</td>; })}</tr>)}</tbody></table></div>
  );
  return (
    <ChartFrame title={title} legend={series.map((s, i) => ({ label: s.name, color: SERIES[i], line: true }))} table={table} summary={summary}>
      <div ref={ref} style={{ position: 'relative' }}
        onMouseMove={(e) => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); setHoverX(e.clientX - r.left); }}
        onMouseLeave={() => setHoverX(null)}>
        <svg height={height} role="img" aria-label={summary ?? title}>
          <g className="axis">
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
                <text x={pad.l - 8} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>
              </g>
            ))}
            {xLabels.map((t) => <text key={t.date} x={x(t.date)} y={height - 8} textAnchor="middle">{t.label}</text>)}
          </g>
          {lo < 0 && <line className="baseline" x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} />}
          {reference && (
            <g>
              <line x1={pad.l} x2={width - pad.r} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--text-3)" strokeWidth={1} />
              <text x={width - pad.r} y={y(reference.value) - 5} textAnchor="end" fontSize={11} fill="var(--text-2)">{reference.label}</text>
            </g>
          )}
          {series.map((s, i) => {
            const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
            const last = s.points[s.points.length - 1];
            return (
              <g key={s.name}>
                {area && series.length === 1 && s.points.length > 1 && (
                  <path d={`${d} L${x(last.date)},${y(Math.max(lo, 0))} L${x(s.points[0].date)},${y(Math.max(lo, 0))} Z`} fill={SERIES[i]} opacity={0.1} />
                )}
                <path d={d} fill="none" stroke={SERIES[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {series.length === 1 && last && (
                  <g>
                    <circle cx={x(last.date)} cy={y(last.value)} r={4} fill={SERIES[i]} stroke="var(--surface)" strokeWidth={2} />
                    <text x={x(last.date) + 8} y={y(last.value) + 4} fontSize={11} fill="var(--text-2)">{fmt(last.value)}</text>
                  </g>
                )}
              </g>
            );
          })}
          {nearest && (
            <g>
              <line x1={x(nearest)} x2={x(nearest)} y1={pad.t} y2={pad.t + innerH} stroke="var(--border-strong)" strokeWidth={1} />
              {series.map((s, i) => { const p = s.points.find((q) => q.date === nearest); return p ? <circle key={s.name} cx={x(p.date)} cy={y(p.value)} r={4} fill={SERIES[i]} stroke="var(--surface)" strokeWidth={2} /> : null; })}
            </g>
          )}
        </svg>
        {nearest && (
          <div className="chart-tip" style={{ left: Math.min(width - 190, x(nearest) + 10), top: 8 }}>
            <div className="tip-title">{formatDate(nearest)}</div>
            {series.map((s, i) => { const p = s.points.find((q) => q.date === nearest); return p ? <div className="tip-row" key={s.name}><span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: SERIES[i], marginRight: 6 }} />{s.name}</span><span className="num">{privacy ? '$•••••' : formatMoney(p.value)}</span></div> : null; })}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

/* ------------------------------ horizontal bars ------------------------------ */

export function BarList({ title, rows, onSelect, summary }: { title: string; rows: { key: string; label: string; value: number; note?: string }[]; onSelect?: (key: string) => void; summary?: string }) {
  const { privacy } = useApp();
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const table = (
    <div className="table-wrap"><table className="table"><thead><tr><th>Category</th><th className="num">Amount</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key}><td>{r.label}{r.note ? ` (${r.note})` : ''}</td><td className="num">{privacy ? '$•••••' : formatMoney(r.value)}</td></tr>)}</tbody></table></div>
  );
  return (
    <ChartFrame title={title} table={table} summary={summary}>
      <div className="barlist" role="list" aria-label={title}>
        {rows.map((r) => (
          <div className="barlist-row" role="listitem" key={r.key}>
            {onSelect ? <button onClick={() => onSelect(r.key)} title={r.label}>{r.label}</button> : <span title={r.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>}
            <div className="barlist-track"><div className="barlist-bar" style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} /></div>
            <span className="num small">{privacy ? '$•••••' : formatMoney(r.value, { wholeDollars: Math.abs(r.value) >= 100000 })}</span>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

export function Meter({ value, label, max = 1 }: { value: number; label: string; max?: number }) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
      <span style={{ width: `${pct * 100}%` }} />
    </div>
  );
}
