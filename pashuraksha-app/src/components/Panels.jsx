import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import {
  SAMPLE_TYPES,
  SEVERITY_STATISTIC,
  formatNumber,
} from "../constants";
import Modal from "./Modal";

function SeverityBadge({ level }) {
  return (
    <span className={`badge is-${SEVERITY_STATISTIC[level] || "mortality"}`}>
      {level}
    </span>
  );
}

function ReportCard({ report, children }) {
  return (
    <div className="card" style={{ padding: "0.9rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.75rem",
          alignItems: "flex-start",
        }}
      >
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: "0.85rem" }}>
            <span className="tabular">{report.pashu_aadhaar || report.tag_id}</span>
            {" · "}
            {report.species}
          </p>
          <p className="map-footnote" style={{ margin: "0.15rem 0 0" }}>
            {[report.village, report.district, report.state].filter(Boolean).join(", ")}
          </p>
          <p className="map-footnote" style={{ margin: "0.1rem 0 0", opacity: 0.75 }}>
            {report.owner_name ? `Owner: ${report.owner_name} · ` : ""}
            filed by {report.reported_by}
            {report.server_received_at
              ? ` · ${new Date(report.server_received_at).toLocaleString()}`
              : ""}
          </p>
        </div>
        <SeverityBadge level={report.severity_level} />
      </div>

      <p style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
        <strong>Suspected:</strong> {report.suspected_disease}
      </p>
      {report.cluster_id && (
        <p className="map-footnote" style={{ margin: "0.25rem 0 0", color: "var(--critical)" }}>
          In cluster {report.cluster_id}
        </p>
      )}
      {children}
    </div>
  );
}

// --- FARMER: MY REPORTS -----------------------------------------------------
export function MyReportsPanel({ authUser, setFeedbackMsg }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await apiFetch("/reports/mine", { authUser }));
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message });
    }
    setLoading(false);
  }, [authUser, setFeedbackMsg]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <button type="button" className="btn" onClick={load} style={{ justifySelf: "start" }}>
        Refresh
      </button>
      {loading && <p className="map-footnote">Loading…</p>}
      {!loading && !reports.length && (
        <p className="map-footnote">
          Nothing yet — reports you file, and reports a vet files against your
          animals, both appear here.
        </p>
      )}
      {reports.map((r) => <ReportCard key={r.id} report={r} />)}
    </div>
  );
}

// --- VET/ADMIN: ALL REPORTS -------------------------------------------------
export function AllReportsPanel({ authUser, setFeedbackMsg }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sampleFor, setSampleFor] = useState(null);
  const [sampleType, setSampleType] = useState(SAMPLE_TYPES[0]);
  const [labName, setLabName] = useState("");

  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await apiFetch("/reports", { authUser }));
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message });
    }
    setLoading(false);
  }, [authUser, setFeedbackMsg]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id) => {
    try {
      await apiFetch(`/reports/${id}/resolve`, { method: "PATCH", authUser });
      setFeedbackMsg({ type: "success", text: "Marked resolved." });
      load();
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message });
    }
  };

  const createSample = async (reportId) => {
    try {
      const data = await apiFetch("/lab/samples", {
        method: "POST",
        authUser,
        body: { report_id: reportId, sample_type: sampleType, lab_name: labName || null },
      });
      setFeedbackMsg({ type: "success", text: `Sample ${data.sample_id} registered.` });
      setSampleFor(null);
      setLabName("");
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message });
    }
  };

  // Filtering and sorting run over the already-loaded list, so results are
  // instant and no backend contract changes are needed.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom).getTime() : null;
    const to = dateTo ? new Date(dateTo).getTime() + 86_399_999 : null;

    const filtered = reports.filter((r) => {
      if (needle) {
        const hay = [
          r.id, r.tag_id, r.village, r.district, r.state, r.suspected_disease,
          r.reported_by, r.owner_name, r.severity_level, r.species, r.cluster_id,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (from !== null || to !== null) {
        const t = r.server_received_at ? new Date(r.server_received_at).getTime() : null;
        if (t === null) return false;
        if (from !== null && t < from) return false;
        if (to !== null && t > to) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const ta = a.server_received_at ? new Date(a.server_received_at).getTime() : 0;
      const tb = b.server_received_at ? new Date(b.server_received_at).getTime() : 0;
      return sortOrder === "desc" ? tb - ta : ta - tb;
    });
    return filtered;
  }, [reports, query, dateFrom, dateTo, sortOrder]);

  // The full report list runs to thousands of rows once demo data is seeded, so
  // render a page at a time — mounting every card locks the main thread for
  // seconds and the user only ever looks at the top of the list.
  const [limit, setLimit] = useState(40);
  useEffect(() => { setLimit(40); }, [query, dateFrom, dateTo, sortOrder]);

  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "1 1 14rem" }}>
          <label htmlFor="q">Search</label>
          <input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tag, owner, district, disease…"
          />
        </div>
        <div className="field">
          <label htmlFor="from">From</label>
          <input id="from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input id="to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => setSortOrder((p) => (p === "desc" ? "asc" : "desc"))}
        >
          {sortOrder === "desc" ? "Newest first ↓" : "Oldest first ↑"}
        </button>
        <button type="button" className="btn" onClick={load}>Refresh</button>
      </div>

      {loading && <p className="map-footnote">Loading…</p>}
      {!loading && (
        <p className="map-footnote">
          Showing {formatNumber(Math.min(limit, visible.length))} of{" "}
          {formatNumber(visible.length)} matching · {formatNumber(reports.length)} total
        </p>
      )}

      {visible.slice(0, limit).map((r) => (
        <ReportCard key={r.id} report={r}>
          {r.severity_level !== "RESOLVED" && (
            <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={() => resolve(r.id)}>
                Mark resolved
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setSampleFor(sampleFor === r.id ? null : r.id)}
              >
                Refer lab sample
              </button>
            </div>
          )}

          {sampleFor === r.id && (
            <div
              style={{
                display: "flex",
                gap: "0.6rem",
                marginTop: "0.7rem",
                paddingTop: "0.7rem",
                borderTop: "1px solid var(--line)",
                flexWrap: "wrap",
                alignItems: "flex-end",
              }}
            >
              <div className="field">
                <label>Sample type</label>
                <select value={sampleType} onChange={(e) => setSampleType(e.target.value)}>
                  {SAMPLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Lab (optional)</label>
                <input value={labName} onChange={(e) => setLabName(e.target.value)} />
              </div>
              <button type="button" className="btn btn-primary" onClick={() => createSample(r.id)}>
                Submit referral
              </button>
            </div>
          )}
        </ReportCard>
      ))}

      {visible.length > limit && (
        <button type="button" className="btn" onClick={() => setLimit((l) => l + 40)}>
          Show 40 more
        </button>
      )}
    </div>
  );
}

// --- VET/ADMIN: CLUSTERS ----------------------------------------------------
export function ClustersPanel({ clusters, reloadClusters, setFeedbackMsg }) {
  const [radiusKm, setRadiusKm] = useState(5);
  const [minCases, setMinCases] = useState(3);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await reloadClusters({ radiusKm, minCases });
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message });
    }
    setBusy(false);
  };

  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <div className="card" style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field">
          <label htmlFor="radius">Radius (km)</label>
          <input
            id="radius" type="number" min="1" step="0.5" style={{ width: "6rem" }}
            value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="mincases">Min cases</label>
          <input
            id="mincases" type="number" min="1" style={{ width: "6rem" }}
            value={minCases} onChange={(e) => setMinCases(Number(e.target.value))}
          />
        </div>
        <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
          {busy ? "Scanning…" : "Run detection"}
        </button>
        <p className="map-footnote" style={{ margin: 0, flexBasis: "100%" }}>
          DBSCAN over active HIGH/CRITICAL cases from the last 14 days, grouped
          per suspected disease. Results also drive the rings on the map.
        </p>
      </div>

      {!clusters.length && (
        <p className="map-footnote">
          No active clusters at these thresholds. Try a wider radius or fewer
          minimum cases.
        </p>
      )}

      {clusters.map((c) => (
        <div key={c.cluster_id} className="card is-critical" style={{ padding: "0.9rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 900, color: "var(--critical)" }}>
                {c.cluster_id}
              </p>
              <p style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>{c.primary_disease}</p>
            </div>
            <span className="badge is-critical">{c.case_count} cases</span>
          </div>

          <p className="map-footnote" style={{ marginTop: "0.5rem" }}>
            {(c.affected_districts || []).join(", ")}
            {c.affected_states?.length ? ` · ${c.affected_states.join(", ")}` : ""}
          </p>
          {c.affected_owners?.length > 0 && (
            <p className="map-footnote" style={{ margin: "0.2rem 0 0" }}>
              Owners to contact: {c.affected_owners.slice(0, 6).join(", ")}
              {c.affected_owners.length > 6 ? ` +${c.affected_owners.length - 6} more` : ""}
            </p>
          )}

          <ul style={{ margin: "0.6rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem", lineHeight: 1.6 }}>
            {c.recommended_protocols.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

// --- VET/ADMIN: LAB SAMPLES -------------------------------------------------
export function LabSamplesPanel({ authUser, setFeedbackMsg }) {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSamples(await apiFetch("/lab/samples", { authUser }));
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message });
    }
    setLoading(false);
  }, [authUser, setFeedbackMsg]);

  useEffect(() => { load(); }, [load]);

  const update = async (id, status, result) => {
    try {
      await apiFetch(`/lab/samples/${id}`, {
        method: "PATCH", authUser, body: { status, result },
      });
      setFeedbackMsg({ type: "success", text: `Sample ${id} updated.` });
      load();
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message });
    }
  };

  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      <button type="button" className="btn" onClick={load} style={{ justifySelf: "start" }}>
        Refresh
      </button>
      {loading && <p className="map-footnote">Loading…</p>}
      {!loading && !samples.length && (
        <p className="map-footnote">No samples yet — refer one from a report.</p>
      )}

      {samples.map((s) => (
        <div key={s.sample_id} className="card" style={{ padding: "0.9rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: "0.85rem" }}>
                {s.sample_id} · {s.sample_type}
              </p>
              <p className="map-footnote" style={{ margin: "0.15rem 0 0" }}>
                Lab: {s.lab_name || "unassigned"}
              </p>
            </div>
            <span className={`badge is-${s.result === "POSITIVE" ? "reported" : s.result === "NEGATIVE" ? "resolved" : "mortality"}`}>
              {s.status}
            </span>
          </div>
          {s.result && (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
              <strong>Result:</strong> {s.result}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
            {["IN_TRANSIT", "TESTING", "CONFIRMED"].map((st) => (
              <button key={st} type="button" className="btn" onClick={() => update(s.sample_id, st, s.result)}>
                {st.replace("_", " ")}
              </button>
            ))}
            {["POSITIVE", "NEGATIVE", "INCONCLUSIVE"].map((res) => (
              <button key={res} type="button" className="btn" onClick={() => update(s.sample_id, "CONFIRMED", res)}>
                {res}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- ADMIN TOOLS ------------------------------------------------------------
export function AdminToolsPanel({ authUser, setFeedbackMsg, onDataChanged }) {
  const [confirmText, setConfirmText] = useState("");
  const [count, setCount] = useState(700);
  const [hotspots, setHotspots] = useState(14);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const seed = async () => {
    setBusy(true);
    try {
      const data = await apiFetch(
        `/admin/seed-demo?count=${count}&days=30&hotspots=${hotspots}`,
        { method: "POST", authUser },
      );
      setFeedbackMsg({
        type: "success",
        text: `Seeded ${data.reports_created} reports across ${data.epicentres.length} outbreak epicentres.`,
      });
      onDataChanged?.();
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message });
    }
    setBusy(false);
  };

  const clearAll = async () => {
    setConfirmOpen(false);
    try {
      await apiFetch("/reports", { method: "DELETE", authUser });
      setFeedbackMsg({ type: "success", text: "All reports and samples cleared." });
      setConfirmText("");
      onDataChanged?.();
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message });
    }
  };

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Seed demo data</div>
        <p className="map-footnote" style={{ margin: 0 }}>
          Generates backdated reports across the national registry. Most of the
          volume is concentrated into randomly chosen epicentre districts so
          DBSCAN has real clusters to find; the rest is background noise.
        </p>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field">
            <label htmlFor="count">Reports</label>
            <input
              id="count" type="number" min="1" max="4000" style={{ width: "7rem" }}
              value={count} onChange={(e) => setCount(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="hot">Epicentres</label>
            <input
              id="hot" type="number" min="0" max="40" style={{ width: "7rem" }}
              value={hotspots} onChange={(e) => setHotspots(Number(e.target.value))}
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={seed} disabled={busy}>
            {busy ? "Seeding…" : "Seed"}
          </button>
        </div>
      </div>

      <div className="card is-reported" style={{ display: "grid", gap: "0.6rem" }}>
        <div className="section-title" style={{ marginBottom: 0, color: "var(--reported)" }}>
          Danger zone
        </div>
        <p className="map-footnote" style={{ margin: 0 }}>
          Permanently deletes every report and lab sample. The Pashu Aadhaar
          registry itself is not touched and re-seeds on the next start.
        </p>
        <input
          className="input"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder='Type "DELETE ALL" to enable'
        />
        <button
          type="button"
          className="btn btn-danger"
          disabled={confirmText !== "DELETE ALL"}
          onClick={() => setConfirmOpen(true)}
        >
          Clear all reports &amp; samples
        </button>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete everything?"
        icon="⚠"
        closeLabel="Cancel"
      >
        <p>
          This removes every report and lab sample with no undo. The registry
          survives, but case history does not.
        </p>
        <button type="button" className="btn btn-danger" onClick={clearAll} style={{ marginBottom: "0.6rem" }}>
          Yes, delete all
        </button>
      </Modal>
    </div>
  );
}
