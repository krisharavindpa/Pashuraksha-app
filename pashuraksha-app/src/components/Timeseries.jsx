import React, { useMemo, useState } from "react";
import { formatNumber, STATISTICS } from "../constants";

/**
 * Small-multiple trend cards, one per statistic.
 *
 * Hand-rolled SVG rather than a charting library: these are ~30 bars each with
 * no axes, legends or interaction beyond a hover title, so a chart library would
 * cost more bundle than the whole component and give nothing back.
 */

const RANGES = [
  { key: 14, label: "2W" },
  { key: 30, label: "1M" },
  { key: 0, label: "All" },
];

export default function Timeseries({ timeseries = [] }) {
  const [range, setRange] = useState(30);
  const [cumulative, setCumulative] = useState(false);

  const points = useMemo(() => {
    if (!range) return timeseries;
    return timeseries.slice(-range);
  }, [timeseries, range]);

  if (!points.length) return null;

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "0.75rem",
        }}
      >
        <div className="section-title" style={{ marginBottom: 0 }}>
          {cumulative ? "Cumulative trend" : "Daily trend"}
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <div className="pills">
            <button
              type="button"
              className={`pill ${!cumulative ? "selected" : ""}`}
              onClick={() => setCumulative(false)}
            >
              Daily
            </button>
            <button
              type="button"
              className={`pill ${cumulative ? "selected" : ""}`}
              onClick={() => setCumulative(true)}
            >
              Cumulative
            </button>
          </div>
          <div className="pills">
            {RANGES.map((r) => (
              <button
                type="button"
                key={r.key}
                className={`pill ${range === r.key ? "selected" : ""}`}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="Timeseries">
        {STATISTICS.map((s) => (
          <TrendCard
            key={s.key}
            statistic={s}
            points={points}
            cumulative={cumulative}
          />
        ))}
      </div>
    </div>
  );
}

function TrendCard({ statistic, points, cumulative }) {
  const series = points.map((p) =>
    cumulative ? p.cumulative[statistic.key] : p.daily[statistic.key],
  );
  const max = Math.max(1, ...series);
  const latest = series[series.length - 1] ?? 0;

  const W = 200;
  const H = 46;
  const gap = 1;
  const barW = Math.max(1, W / series.length - gap);

  return (
    <div className={`trend-card is-${statistic.key}`}>
      <h5>{statistic.label}</h5>
      <div className="trend-value tabular">{formatNumber(latest)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {cumulative ? (
          <polyline
            points={series
              .map((v, i) => `${(i / Math.max(1, series.length - 1)) * W},${H - (v / max) * H}`)
              .join(" ")}
            fill="none"
            stroke={statistic.color}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          series.map((v, i) => {
            // Floor at 1px so a day with cases never renders as an empty slot
            // indistinguishable from a day with none.
            const h = v ? Math.max(1, (v / max) * H) : 0;
            return (
              <rect
                key={i}
                x={i * (barW + gap)}
                y={H - h}
                width={barW}
                height={h}
                fill={statistic.color}
                opacity={0.75}
              >
                <title>{`${points[i].date}: ${v}`}</title>
              </rect>
            );
          })
        )}
      </svg>
    </div>
  );
}
