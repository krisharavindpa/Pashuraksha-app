import React from "react";
import { formatDelta, formatNumber, STATISTICS } from "../constants";

/**
 * The row of headline statistic cards.
 *
 * These double as the map's mode switch — the incovid19 pattern where the cards
 * are the control surface rather than sitting next to one. Selecting a card
 * re-colours the map, the legend and the table's sort in one action.
 */
export default function Level({ totals, deltas, samples, statistic, onSelect }) {
  return (
    <div className="Level">
      {STATISTICS.map((s) => {
        const delta = deltas?.[s.key] || 0;
        return (
          <button
            type="button"
            key={s.key}
            className={`level-item is-${s.key} ${statistic === s.key ? "selected" : ""}`}
            onClick={() => onSelect(s.key)}
            aria-pressed={statistic === s.key}
            title={`Show ${s.label.toLowerCase()} on the map and table`}
          >
            <h5>{s.label}</h5>
            <span className="delta tabular">{formatDelta(delta)}</span>
            <h1 className="tabular">{formatNumber(totals?.[s.key] ?? 0)}</h1>
          </button>
        );
      })}

      {/* Lab samples are not a per-region statistic, so this one is a readout
          rather than a map selector — hence no onSelect and no pressed state. */}
      <div className="level-item is-samples" aria-hidden="false">
        <h5>Samples</h5>
        <span className="delta tabular">
          {samples?.positive ? `${formatNumber(samples.positive)} pos` : ""}
        </span>
        <h1 className="tabular">{formatNumber(samples?.total ?? 0)}</h1>
      </div>
    </div>
  );
}
