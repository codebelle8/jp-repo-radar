"use client";
// Two chart forms, both single-series (one accent color, no legend needed - the card title names the series):
//  - BarChart: ranked horizontal bars, value at each bar tip, tooltip per bar.
//  - TrendChart: line over time with a crosshair tooltip.
import { useEffect, useRef, useState } from "react";
import { useTooltip } from "@/components/providers";
import { compact, fmt, localTime } from "@/lib/format";

export function BarChart({ items, label, onSelect, tooltip }) {
  const { show, hide } = useTooltip();
  const top = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="hbar" role="list" aria-label={label}>
      {items.map((it) => {
        const pct = Math.max(0, it.value) / top;
        const content = <><div className="tt-title">{it.name}</div>{tooltip(it)}</>;
        const select = onSelect ? () => { hide(); onSelect(it); } : undefined;
        return (
          <div key={it.key} className={`hbar-row${onSelect ? " link" : ""}`} role="listitem" tabIndex={0}
            aria-label={`${it.name}: ${fmt(it.value)}`}
            onPointerMove={(e) => show(e, content)} onPointerLeave={hide}
            onFocus={(e) => show(e.currentTarget, content)} onBlur={hide}
            onClick={select} onKeyDown={select ? (e) => { if (e.key === "Enter") select(); } : undefined}>
            <div className="hbar-label" title={it.name}>{it.name}</div>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `calc((100% - 64px) * ${pct.toFixed(4)})` }} />
              <span className="hbar-value">{compact(it.value)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TooltipRow({ label, value, keyed = false }) {
  return (
    <div className="tt-row">
      <span className="muted">{keyed ? <span className="tt-key" /> : null}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function niceTicks(min, max, count = 3) {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = Math.max(1, (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag);
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) out.push(Math.round(v));
  return out;
}

export function TrendChart({ points, label }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  const { show, hide } = useTooltip();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) {
    return <div className="trend" ref={wrapRef}><div className="empty small">The trend line appears after the second collection.</div></div>;
  }

  const W = Math.max(240, Math.round(width || 320));
  const H = 150, padL = 46, padR = 14, padT = 12, padB = 24;
  const ts = points.map((p) => Date.parse(p.t));
  const vs = points.map((p) => p.v);
  const ticks = niceTicks(Math.min(...vs), Math.max(...vs), 3);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const t0 = ts[0], t1 = ts[ts.length - 1];
  const x = (t) => padL + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - y0) / (y1 - y0 || 1)) * (H - padT - padB);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(ts[i]).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const dateLabel = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const last = points.length - 1;

  function onMove(e) {
    const box = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    ts.forEach((t, i) => { if (Math.abs(x(t) - px) < Math.abs(x(ts[best]) - px)) best = i; });
    setHover(best);
    show(e, <><div className="tt-title">{localTime(points[best].t)}</div><TooltipRow label={label} value={fmt(vs[best])} keyed /></>);
  }

  return (
    <div className="trend" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} over time`}>
        {ticks.map((tv, i) => (
          <g key={tv}>
            <line className={i === 0 ? "baseline" : "gridline"} x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} />
            <text className="tick" x={padL - 8} y={y(tv) + 4} textAnchor="end">{compact(tv)}</text>
          </g>
        ))}
        <text className="tick" x={padL} y={H - 4} textAnchor="start">{dateLabel(t0)}</text>
        <text className="tick" x={W - padR} y={H - 4} textAnchor="end">{dateLabel(t1)}</text>
        <path className="line" d={d} />
        <circle className="dot" cx={x(ts[last])} cy={y(vs[last])} r={4} />
        {hover != null ? (
          <>
            <line className="crosshair" x1={x(ts[hover])} x2={x(ts[hover])} y1={padT} y2={H - padB} />
            <circle className="dot" cx={x(ts[hover])} cy={y(vs[hover])} r={4} />
          </>
        ) : null}
        <rect x={padL} y={0} width={W - padL - padR} height={H} fill="transparent"
          onPointerMove={onMove} onPointerLeave={() => { setHover(null); hide(); }} />
      </svg>
    </div>
  );
}
