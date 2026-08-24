import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { formatNumber, STATISTIC_BY_KEY } from "../constants";

/**
 * The India outbreak map.
 *
 * Two levels, the way incovid19.org does it: the country view is a choropleth
 * of states, and clicking a state zooms the projection to that state's bounds
 * and re-renders using its districts. Zoom is a projection refit rather than an
 * SVG transform, so district borders stay crisp and stroke widths stay honest
 * instead of scaling up into slabs.
 *
 * Two modes:
 *   choropleth — regions shaded by the selected statistic
 *   spread     — regions left flat, one bubble per region sized by value
 *
 * DBSCAN outbreak clusters are drawn on top in either mode, at their true
 * centroid coordinates, because a cluster is the thing the whole system exists
 * to surface and it should never be hidden behind a mode switch.
 */

const VIEW_W = 420;
const VIEW_H = 460;
const MAP_URL = `${import.meta.env.BASE_URL}maps/india.json`;

// Module-level cache: the topojson is ~480KB and never changes, so a remount
// (switching tabs, toggling roles) must not re-download or re-parse it.
let mapCache = null;
let mapPromise = null;

function loadMap() {
  if (mapCache) return Promise.resolve(mapCache);
  if (!mapPromise) {
    mapPromise = fetch(MAP_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Map data unavailable (${r.status})`);
        return r.json();
      })
      .then((topo) => {
        mapCache = {
          states: feature(topo, topo.objects.states),
          districts: feature(topo, topo.objects.districts),
        };
        return mapCache;
      })
      .catch((err) => {
        mapPromise = null; // let a later mount retry
        throw err;
      });
  }
  return mapPromise;
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Fill for a region with no cases.
 *
 * Not white. The whole `#chart` group is inverted in dark mode (see
 * --map-filter), and white inverts to pure black, which makes every unaffected
 * district vanish into the page background — the map stops reading as a map.
 * This mid-light grey inverts to roughly #23222f, which still reads as land
 * against the #161625 ground while staying quiet in light mode.
 */
const EMPTY_FILL = [220, 221, 224];

/**
 * Ramp from the empty-land grey toward the statistic colour.
 *
 * Authored light-first on purpose: dark mode is produced by inverting this
 * output rather than by a second palette, the same trick incovid19 uses, so a
 * light-to-saturated ramp here becomes a dark-to-saturated ramp there.
 */
function shade(color, t) {
  const [r, g, b] = hexToRgb(color);
  const [er, eg, eb] = EMPTY_FILL;
  const mix = (base, target) => Math.round(base + (target - base) * t);
  return `rgb(${mix(er, r)}, ${mix(eg, g)}, ${mix(eb, b)})`;
}

/**
 * Square-root intensity against the largest region.
 *
 * A linear ramp is unreadable on Indian outbreak data: one epicentre district
 * with 60 cases flattens the other 200 districts to indistinguishable white.
 * sqrt keeps small non-zero counts visible while still ranking the peak highest.
 */
function intensity(value, max) {
  if (!value || !max) return 0;
  return 0.12 + 0.88 * Math.sqrt(value / max);
}

export default function MapExplorer({ summary, clusters = [], statistic }) {
  const [geo, setGeo] = useState(mapCache);
  const [error, setError] = useState(null);
  const [zoomState, setZoomState] = useState(null); // state name, or null for India
  const [mode, setMode] = useState("choropleth"); // 'choropleth' | 'spread'
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadMap().then(
      (m) => alive && setGeo(m),
      (e) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, []);

  const stat = STATISTIC_BY_KEY[statistic] || STATISTIC_BY_KEY.reported;

  // --- data indexed by region name -------------------------------------------
  const stateData = useMemo(() => {
    const map = new Map();
    for (const s of summary?.states || []) map.set(s.name, s);
    return map;
  }, [summary]);

  const districtData = useMemo(() => {
    if (!zoomState) return new Map();
    const map = new Map();
    for (const d of stateData.get(zoomState)?.districts || []) map.set(d.name, d);
    return map;
  }, [stateData, zoomState]);

  // --- geometry for the current level ----------------------------------------
  const { features, projection, path, regionData, max } = useMemo(() => {
    if (!geo) return {};

    const zoomed = Boolean(zoomState);
    const shown = zoomed
      ? geo.districts.features.filter((f) => f.properties.st_nm === zoomState)
      : geo.states.features;

    // Fit to what is on screen. At country level that is India; zoomed in it is
    // the single state, which is what makes districts fill the frame.
    const fitTarget = zoomed
      ? { type: "FeatureCollection", features: shown }
      : geo.states;

    const proj = geoMercator().fitExtent(
      [
        [8, 8],
        [VIEW_W - 8, VIEW_H - 8],
      ],
      fitTarget,
    );

    const data = zoomed ? districtData : stateData;
    const values = shown.map(
      (f) => data.get(zoomed ? f.properties.district : f.properties.st_nm)?.[statistic] || 0,
    );

    return {
      features: shown,
      projection: proj,
      path: geoPath(proj),
      regionData: data,
      max: Math.max(0, ...values),
    };
  }, [geo, zoomState, stateData, districtData, statistic]);

  const nameOf = useCallback(
    (f) => (zoomState ? f.properties.district : f.properties.st_nm),
    [zoomState],
  );

  // Clusters that belong on the current view, positioned by real coordinates.
  const visibleClusters = useMemo(() => {
    if (!projection) return [];
    return clusters
      .filter((c) => !zoomState || (c.affected_states || []).includes(zoomState))
      .map((c) => {
        const [lat, lng] = c.center || [];
        if (lat == null || lng == null) return null;
        const xy = projection([lng, lat]);
        return xy ? { ...c, x: xy[0], y: xy[1] } : null;
      })
      .filter(Boolean);
  }, [clusters, projection, zoomState]);

  // Bubble radii for 'spread' mode.
  const bubbles = useMemo(() => {
    if (!projection || !features || mode !== "spread") return [];
    return features
      .map((f) => {
        const row = regionData.get(nameOf(f));
        const value = row?.[statistic] || 0;
        if (!value || row.latitude == null) return null;
        const xy = projection([row.longitude, row.latitude]);
        if (!xy) return null;
        // Area-proportional: radius on sqrt so a bubble twice the area reads as
        // twice the caseload, which is the only encoding people read correctly.
        const r = 3 + 22 * Math.sqrt(value / (max || 1));
        return { name: row.name, value, x: xy[0], y: xy[1], r };
      })
      .filter(Boolean)
      .sort((a, b) => b.r - a.r); // big behind small, so small stay clickable
  }, [projection, features, regionData, statistic, max, mode, nameOf]);

  const handleEnter = useCallback(
    (event, name, row) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      setHover({
        name,
        row,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [],
  );

  const total = zoomState
    ? stateData.get(zoomState)?.[statistic] || 0
    : summary?.totals?.[statistic] || 0;

  if (error) {
    return (
      <div className="card is-mortality">
        <div className="section-title">Outbreak map</div>
        <p className="map-footnote">
          Could not load the map geometry: {error}
        </p>
      </div>
    );
  }

  return (
    <div className={`MapExplorer card is-${stat.key}`} ref={wrapRef}>
      <div className="panel">
        <div>
          <h2>{zoomState || "India"}</h2>
          <div className="subline">
            {zoomState
              ? `${districtData.size} district${districtData.size === 1 ? "" : "s"} reporting`
              : `${stateData.size} state${stateData.size === 1 ? "" : "s"} reporting`}
          </div>
          <div className="headline tabular" style={{ marginTop: "0.4rem" }}>
            {formatNumber(total)}
          </div>
          <div className="subline">{stat.label.toLowerCase()}</div>
        </div>

        <div className="switch-type">
          <button
            type="button"
            className={`toggle ${mode === "choropleth" ? "is-highlighted" : ""}`}
            onClick={() => setMode("choropleth")}
            aria-pressed={mode === "choropleth"}
            title="Shade regions by value"
          >
            Map
          </button>
          <button
            type="button"
            className={`toggle ${mode === "spread" ? "is-highlighted" : ""}`}
            onClick={() => setMode("spread")}
            aria-pressed={mode === "spread"}
            title="One bubble per region, sized by value"
          >
            Spread
          </button>
        </div>
      </div>

      <div className="svg-parent" style={{ position: "relative" }}>
        {zoomState && (
          <button type="button" className="map-button" onClick={() => setZoomState(null)}>
            ← Back to India
          </button>
        )}

        {!geo ? (
          <div
            className="map-footnote"
            style={{ height: 280, display: "grid", placeItems: "center" }}
          >
            Loading map…
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            role="img"
            aria-label={`${stat.label} by ${zoomState ? "district" : "state"}`}
          >
            <g id="chart">
              {features.map((f) => {
                const name = nameOf(f);
                const row = regionData.get(name);
                const value = row?.[statistic] || 0;
                const fill =
                  mode === "choropleth"
                    ? shade(stat.color, intensity(value, max))
                    : `rgb(${EMPTY_FILL.join(", ")})`;
                return (
                  <path
                    key={`${f.properties.st_nm}-${name}`}
                    d={path(f)}
                    className={`map-region ${!zoomState ? "clickable" : ""} ${
                      hover?.name === name ? "is-highlighted" : ""
                    }`}
                    fill={fill}
                    stroke="rgba(108,117,125,0.45)"
                    strokeWidth={hover?.name === name ? 1.4 : 0.5}
                    onMouseMove={(e) => handleEnter(e, name, row)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => {
                      if (zoomState) return;
                      setHover(null);
                      setZoomState(name);
                    }}
                  >
                    <title>{`${name}: ${formatNumber(value)} ${stat.label.toLowerCase()}`}</title>
                  </path>
                );
              })}

              {bubbles.map((b) => (
                <circle
                  key={b.name}
                  className="map-bubble"
                  cx={b.x}
                  cy={b.y}
                  r={b.r}
                  fill={stat.color}
                  fillOpacity={0.35}
                  stroke={stat.color}
                  strokeWidth={0.8}
                />
              ))}
            </g>

            {/* Cluster ring + pulse. Outside #chart so the dark-mode inversion
                filter does not flip these to a colour that no longer reads as
                an alert. */}
            {visibleClusters.map((c) => (
              <g
                key={c.cluster_id}
                className="cluster-bubble"
                onMouseMove={(e) => handleEnter(e, c.cluster_id, null)}
                onMouseLeave={() => setHover(null)}
              >
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={6 + Math.min(10, c.case_count * 0.5)}
                  fill="none"
                  stroke="#fd7e14"
                  strokeWidth={1.4}
                  strokeDasharray="3 2"
                  opacity={0.9}
                />
                <circle cx={c.x} cy={c.y} r={2.4} fill="#fd7e14" />
                <title>
                  {`${c.cluster_id} · ${c.case_count} cases · ${c.primary_disease}`}
                </title>
              </g>
            ))}
          </svg>
        )}

        {hover && (
          <div className="map-tooltip" style={{ left: hover.x, top: hover.y }}>
            <div className="tt-name">{hover.name}</div>
            {hover.row ? (
              <>
                <div className="tt-row">
                  <span>{stat.label}</span>
                  <strong className="tabular">{formatNumber(hover.row[statistic])}</strong>
                </div>
                <div className="tt-row" style={{ opacity: 0.7 }}>
                  <span>Reported</span>
                  <span className="tabular">{formatNumber(hover.row.reported)}</span>
                </div>
                {!zoomState && (
                  <div className="tt-row" style={{ opacity: 0.55, marginTop: "0.25rem" }}>
                    <span>Click to zoom in</span>
                  </div>
                )}
              </>
            ) : (
              <div className="tt-row" style={{ opacity: 0.7 }}>
                <span>Outbreak cluster</span>
              </div>
            )}
          </div>
        )}
      </div>

      <Legend color={stat.color} max={max} label={stat.label} />

      <p className="map-footnote">
        {zoomState
          ? "Districts shaded by reported caseload. "
          : "States shaded by reported caseload — click any state to zoom into its districts. "}
        Dashed orange rings are active DBSCAN outbreak clusters at their computed
        centroid. Boundaries are illustrative and carry no political claim.
      </p>
    </div>
  );
}

/** Five-stop gradient strip, matching the choropleth's own ramp. */
function Legend({ color, max, label }) {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  if (!max) return null;
  return (
    <div className="maplegend">
      <svg viewBox="0 0 260 26" style={{ width: "100%", maxWidth: 260, height: 26 }}>
        {stops.map((t, i) => (
          <rect
            key={t}
            x={i * 44}
            y={0}
            width={44}
            height={9}
            fill={shade(color, intensity(t * max, max))}
          />
        ))}
        <text x={0} y={21}>0</text>
        <text x={198} y={21}>{formatNumber(max)}</text>
        <text x={92} y={21} opacity={0.7}>{label.toLowerCase()}</text>
      </svg>
    </div>
  );
}
