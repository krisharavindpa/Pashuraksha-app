import React, { useMemo, useState } from "react";
import { formatDelta, formatNumber, STATISTICS } from "../constants";

/**
 * State-wise breakdown, expandable to districts.
 *
 * Sorting is client-side over the already-loaded summary, so a column click is
 * instant and costs no request. Expanding a state reveals its districts inline
 * under the parent row, which is how the reference dashboard avoids a second
 * navigation level for what is really just a drill-down.
 */
export default function StateTable({ summary, statistic }) {
  const [sortKey, setSortKey] = useState(statistic);
  const [ascending, setAscending] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState("");

  // Following the selected statistic keeps the table and the map telling the
  // same story: pick "Mortality" on a card and the table ranks by mortality.
  const activeSort = STATISTICS.some((s) => s.key === sortKey) ? sortKey : statistic;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = summary?.states || [];
    if (needle) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          s.districts.some((d) => d.name.toLowerCase().includes(needle)),
      );
    }
    return [...list].sort((a, b) => {
      if (activeSort === "name") {
        return ascending
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      const diff = (a[activeSort] || 0) - (b[activeSort] || 0);
      return ascending ? diff : -diff;
    });
  }, [summary, activeSort, ascending, query]);

  const toggle = (name) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const sortBy = (key) => {
    if (key === activeSort) setAscending((v) => !v);
    else {
      setSortKey(key);
      setAscending(key === "name");
    }
  };

  if (!summary?.states?.length) {
    return (
      <div className="card">
        <div className="section-title">State-wise breakdown</div>
        <p className="map-footnote">
          No reports yet. Seed demo data from Admin Tools, or submit a report.
        </p>
      </div>
    );
  }

  return (
    <div className="Table card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "0.5rem",
        }}
      >
        <div className="section-title" style={{ marginBottom: 0 }}>
          State-wise breakdown
        </div>
        <input
          className="input"
          style={{ maxWidth: "14rem" }}
          placeholder="Filter state or district…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th
                className={activeSort === "name" ? "sorted" : ""}
                onClick={() => sortBy("name")}
              >
                State/UT
              </th>
              {STATISTICS.map((s) => (
                <th
                  key={s.key}
                  className={activeSort === s.key ? "sorted" : ""}
                  onClick={() => sortBy(s.key)}
                  style={activeSort === s.key ? { color: s.color } : undefined}
                >
                  {s.label}
                  {activeSort === s.key ? (ascending ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            <tr className="total-row">
              <td>All India</td>
              {STATISTICS.map((s) => (
                <td key={s.key} style={{ color: s.color }}>
                  {formatNumber(summary.totals?.[s.key] ?? 0)}
                  <span className="cell-delta" style={{ opacity: 0.65 }}>
                    {formatDelta(summary.deltas?.[s.key])}
                  </span>
                </td>
              ))}
            </tr>

            {rows.map((state) => {
              const open = expanded.has(state.name);
              return (
                <React.Fragment key={state.name}>
                  <tr className="state-row" onClick={() => toggle(state.name)}>
                    <td>
                      <span className={`expand-caret ${open ? "open" : ""}`}>▶</span>
                      {state.name}
                    </td>
                    {STATISTICS.map((s) => (
                      <td key={s.key} style={{ color: s.color }}>
                        {formatNumber(state[s.key] ?? 0)}
                        <span className="cell-delta" style={{ opacity: 0.65 }}>
                          {formatDelta(state.delta?.[s.key])}
                        </span>
                      </td>
                    ))}
                  </tr>

                  {open &&
                    state.districts.map((d) => (
                      <tr className="district-row" key={`${state.name}-${d.name}`}>
                        <td>{d.name}</td>
                        {STATISTICS.map((s) => (
                          <td key={s.key} style={{ color: s.color, opacity: 0.85 }}>
                            {formatNumber(d[s.key] ?? 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="map-footnote">
        Click a state to expand its districts. Small figures are the last 24 hours.
      </p>
    </div>
  );
}
