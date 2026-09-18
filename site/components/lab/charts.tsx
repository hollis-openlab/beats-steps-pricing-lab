'use client';
import { useEffect, useRef, useState } from 'react';
import { dateTime, money } from './provider';

export function LinePlot({ points, height = 210, color = '#16786b', zero = false, label = '价格路径', digits = 2, eventAt, highlight, step = false }: { points: { x: number; y: number }[]; height?: number; color?: string; zero?: boolean; label?: string; digits?: number; eventAt?: number; highlight?: { start: number; end: number }; step?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null), [width, setWidth] = useState(900);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(300, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (!points.length) return <div ref={container} className="line-plot empty-chart" style={{ height }}>等待价格数据…</div>;
  const w = width, h = height, left = 66, right = 22, top = 14, bottom = 28;
  const minX = points[0].x, maxX = Math.max(minX + 1, points.at(-1)!.x);
  let minY = zero ? 0 : Infinity, maxY = zero ? 0 : -Infinity;
  for (const p of points) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const padding = Math.max((maxY - minY) * 0.12, Math.abs(maxY) * 0.00002, 0.001); minY -= padding; maxY += padding;
  // A quiet instrument still needs five distinct, legal-price axis labels.
  const tickSize = 10 ** -digits;
  minY = Math.floor(minY / tickSize) * tickSize;
  maxY = minY + 4 * Math.max(tickSize, Math.ceil((maxY - minY) / (4 * tickSize)) * tickSize);
  const x = (v: number) => left + (v - minX) / (maxX - minX) * (w - left - right), y = (v: number) => top + (1 - (v - minY) / (maxY - minY)) * (h - top - bottom);
  const d = points.map((p, i) => i && step ? `H${x(p.x).toFixed(2)} V${y(p.y).toFixed(2)}` : `${i ? 'L' : 'M'}${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`).join(' ');
  const selected = hover === null ? null : points[Math.max(0, Math.min(points.length - 1, hover))];
  return <div ref={container} className="line-plot"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)} onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); const time = minX + ((e.clientX - r.left) / r.width * w - left) / (w - left - right) * (maxX - minX); let best = 0; for (let i = 1; i < points.length; i++) if (Math.abs(points[i].x - time) < Math.abs(points[best].x - time)) best = i; setHover(best); }}>
    {Array.from({ length: 5 }, (_, i) => { const v = minY + i / 4 * (maxY - minY); return <g key={i}><line x1={left} x2={w - right} y1={y(v)} y2={y(v)} stroke="#e9eef1" strokeDasharray="3 4" /><text x={left - 10} y={y(v) + 3} textAnchor="end" className="chart-label">{money(v, digits)}</text></g>; })}
    {highlight && highlight.start < maxX && highlight.end > minX && <rect x={x(Math.max(minX, highlight.start))} y={top} width={Math.max(0, x(Math.min(maxX, highlight.end)) - x(Math.max(minX, highlight.start)))} height={h - top - bottom} fill="#d39440" opacity=".15"><title>浅黄色：成交价未变时段（已回放部分）</title></rect>}
    {zero && <line x1={left} x2={w - right} y1={y(0)} y2={y(0)} stroke="#9caeb7" />}
    <path d={`${d} L${x(maxX)},${h - bottom} L${left},${h - bottom} Z`} fill={color} opacity="0.055" />
    <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    {[0, 0.25, 0.5, 0.75, 1].map(f => <text key={f} x={x(minX + f * (maxX - minX))} y={h - 5} textAnchor="middle" className="chart-label">{dateTime(minX + f * (maxX - minX)).split(' ')[1]}</text>)}
    {eventAt && eventAt >= minX && eventAt <= maxX ? <line x1={x(eventAt)} x2={x(eventAt)} y1={top} y2={h - bottom} stroke="#d39440" strokeDasharray="5 4" /> : null}
    {selected && <g><line x1={x(selected.x)} x2={x(selected.x)} y1={top} y2={h - bottom} stroke="#82978f" strokeDasharray="3 3" /><circle cx={x(selected.x)} cy={y(selected.y)} r="4" fill={color} stroke="white" strokeWidth="2" /></g>}
  </svg>{selected && <div className="chart-tooltip">{dateTime(selected.x)} UTC · <b>{money(selected.y, digits)}</b></div>}</div>;
}
export function CalibrationPlot({ bins }: { bins: { predicted: number; observed: number; lower: number; upper: number; count: number }[] }) {
  const size = 340, margin = 46, span = size - margin * 2, x = (v: number) => margin + v * span, y = (v: number) => size - margin - v * span;
  return <svg viewBox={`0 0 ${size} ${size}`} className="calibration-plot" role="img" aria-label="触碰概率校准图，横轴预测概率，纵轴实际触碰率，误差线为小时块自助法区间">
    {[0, .2, .4, .6, .8, 1].map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(1)} stroke="#edf0f3" /><line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="#edf0f3" /><text x={x(t)} y={size - 20} textAnchor="middle" className="chart-label">{t.toFixed(1)}</text><text x={margin - 8} y={y(t) + 3} textAnchor="end" className="chart-label">{t.toFixed(1)}</text></g>)}
    <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#96aaa4" strokeDasharray="5 5" />
    {bins.filter(b => b.count).map((b, i) => <g key={i}><title>{`预测 ${(b.predicted * 100).toFixed(1)}%，实际 ${(b.observed * 100).toFixed(1)}%，样本 ${b.count}`}</title><line x1={x(b.predicted)} x2={x(b.predicted)} y1={y(b.lower)} y2={y(b.upper)} stroke="#549a90" strokeWidth="2" /><circle cx={x(b.predicted)} cy={y(b.observed)} r={4 + Math.min(5, Math.sqrt(b.count) / 15)} fill="#238375" stroke="white" strokeWidth="2" /></g>)}
    <text x={size / 2} y={size - 3} textAnchor="middle" className="chart-label">预测概率</text>
    <text x={10} y={size / 2} textAnchor="middle" transform={`rotate(-90 10 ${size / 2})`} className="chart-label">实际触碰率</text>
  </svg>;
}
