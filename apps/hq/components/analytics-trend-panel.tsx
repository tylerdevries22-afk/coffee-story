'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import type { AnalyticsMetric } from '@/lib/analytics-dashboard';
import type { AnalyticsReport } from '@/lib/analytics-report';

type AnalyticsTrendPanelProps = { report: AnalyticsReport; primaryMetric?: AnalyticsMetric };
type Point = AnalyticsReport['points'][number] & { x: number; y: number };

const WIDTH = 820;
const HEIGHT = 270;
const X_PAD = 34;
const Y_PAD = 28;

function plottedPoints(report: AnalyticsReport): readonly Point[] {
  const values = report.points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(1, maximum - minimum);
  return report.points.map((point, index) => ({
    ...point,
    x: Number((X_PAD + (index / Math.max(1, report.points.length - 1)) * (WIDTH - X_PAD * 2)).toFixed(2)),
    y: Number((Y_PAD + ((maximum - point.value) / spread) * (HEIGHT - Y_PAD * 2)).toFixed(2)),
  }));
}

function lineOf(points: readonly Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export function AnalyticsTrendPanel({ report, primaryMetric }: AnalyticsTrendPanelProps) {
  const reduceMotion = useReducedMotion();
  const points = plottedPoints(report);
  const [activeDay, setActiveDay] = useState(points.at(-1)?.day ?? '');
  const active = points.find((point) => point.day === activeDay) ?? points.at(-1);
  const line = lineOf(points);
  const area = points.length > 0
    ? `${line} L ${points.at(-1)?.x ?? X_PAD} ${HEIGHT - Y_PAD} L ${points[0]?.x ?? X_PAD} ${HEIGHT - Y_PAD} Z`
    : '';
  return (
    <section className="analytics-card analytics-trend-panel" aria-labelledby="analytics-trend-title">
      <div className="analytics-card-heading">
        <h2 id="analytics-trend-title">{report.trendLabel} trend</h2>
        <span>{report.latestLabel}</span>
      </div>
      <div className="analytics-trend-summary">
        <span>{primaryMetric?.label ?? report.trendLabel}</span>
        <div><strong>{primaryMetric?.value ?? 'Collecting'}</strong><em className={`is-${report.direction}`}>{report.deltaLabel}</em></div>
      </div>
      {points.length === 0 ? <div className="analytics-trend-empty">
        <span aria-hidden="true">···</span><strong>Collecting the first complete window</strong>
        <p>The chart will appear after verified daily records are available.</p>
      </div> : <div className="analytics-chart-wrap">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${report.trendLabel} by day`} aria-describedby="analytics-chart-desc">
          <desc id="analytics-chart-desc">{points.map((point) => `${point.label}: ${point.formattedValue}`).join(', ')}</desc>
          <defs><linearGradient id="analytics-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--analytics-accent)" stopOpacity=".28" /><stop offset="1" stopColor="var(--analytics-accent)" stopOpacity=".02" /></linearGradient></defs>
          {[0, 1, 2, 3].map((row) => <line key={row} className="analytics-chart-grid" x1={X_PAD} x2={WIDTH - X_PAD} y1={Y_PAD + row * 71} y2={Y_PAD + row * 71} />)}
          <motion.path d={area} fill="url(#analytics-area)" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} />
          <motion.path className="analytics-chart-line" d={line} initial={reduceMotion ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduceMotion ? 0 : .65 }} />
          {points.map((point) => <g key={point.day} className="analytics-chart-target" data-active={point.day === active?.day || undefined} tabIndex={0} role="img" aria-label={`${point.label}: ${point.formattedValue}`} onFocus={() => setActiveDay(point.day)} onMouseEnter={() => setActiveDay(point.day)}>
            <circle className="analytics-chart-hit" cx={point.x} cy={point.y} r="22" />
            <circle className="analytics-chart-point" cx={point.x} cy={point.y} r="5" />
          </g>)}
        </svg>
        {active ? <div className="analytics-chart-tooltip" style={{ left: `${(active.x / WIDTH) * 100}%`, top: `${(active.y / HEIGHT) * 100}%` }}><strong>{active.label}</strong><span><i /> {report.trendLabel} <b>{active.formattedValue}</b></span></div> : null}
        <div className="analytics-chart-labels" aria-hidden="true">{points.map((point) => <span key={point.day}>{point.label}</span>)}</div>
      </div>}
    </section>
  );
}
