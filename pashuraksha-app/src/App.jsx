import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { ROLE_LABELS, formatNumber } from "./constants";
import Navbar from "./components/Navbar";
import PwaPrompts from "./components/PwaPrompts";
import Level from "./components/Level";
import MapExplorer from "./components/MapExplorer";
import StateTable from "./components/StateTable";
import Timeseries from "./components/Timeseries";
import SubmitReportPanel from "./components/SubmitReportPanel";
import {
  AdminToolsPanel,
  AllReportsPanel,
  ClustersPanel,
  LabSamplesPanel,
  MyReportsPanel,
} from "./components/Panels";

const TABS_BY_ROLE = {
  FARMER: ["Outbreak Map", "Submit Report", "My Reports"],
  VET: ["Outbreak Map", "Submit Report", "All Reports", "Outbreak Clusters", "Lab Samples"],
  ADMIN: [
    "Outbreak Map",
    "Submit Report",
    "All Reports",
    "Outbreak Clusters",
    "Lab Samples",
    "Admin Tools",
  ],
};

const FEEDBACK_STATISTIC = {
  success: "resolved",
  error: "reported",
  warning: "critical",
  info: "active",
};

// --- THEME ------------------------------------------------------------------
function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("pashu_theme");
    if (saved) return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pashu_theme", theme);
  }, [theme]);

  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

// --- LOGIN ------------------------------------------------------------------
function LoginForm({ setAuthUser }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [hints, setHints] = useState(null);

  // Public endpoint — the demo has no real auth, and the login screen needs to
  // show which owner ids actually have animals in the seeded registry.
  useEffect(() => {
    apiFetch("/meta/demo-owners?limit=6").then(setHints).catch(() => setHints(null));
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (password === "farmer123") setAuthUser({ id: username || "farmer_01", role: "FARMER" });
    else if (password === "vet123") setAuthUser({ id: username || "vet_01", role: "VET" });
    else if (password === "admin123") setAuthUser({ id: username || "admin_01", role: "ADMIN" });
    else setError("Invalid password. Use farmer123, vet123 or admin123.");
  };

  return (
    <div className="Login">
      <div className="login-card">
        <h1 style={{ fontSize: "1.6rem", fontWeight: 900, textAlign: "center" }}>
          PashuRaksha
        </h1>
        <p className="map-footnote" style={{ textAlign: "center", marginTop: "0.25rem" }}>
          Livestock early-warning &amp; syndromic surveillance
        </p>

        {error && (
          <div className="banner is-reported" style={{ margin: "1rem 0" }}>{error}</div>
        )}

        <form onSubmit={submit} style={{ display: "grid", gap: "0.85rem", marginTop: "1.25rem" }}>
          <div className="field">
            <label htmlFor="user">Farmer / user id</label>
            <input
              id="user" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. ravi_kumar" autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input
              id="pw" type="password" value={password} required
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Role password" autoComplete="current-password"
            />
          </div>
          <button type="submit" className="btn btn-primary">Sign in</button>
        </form>

        <p className="map-footnote" style={{ textAlign: "center", marginTop: "1rem" }}>
          Demo passwords: <code>farmer123</code> · <code>vet123</code> · <code>admin123</code>
        </p>

        {hints?.pinned?.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <div className="section-title">Owner ids with animals</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
              {hints.pinned.slice(0, 6).map((o) => (
                <button
                  type="button" key={o.owner_id} className="chip"
                  onClick={() => setUsername(o.owner_id)}
                  title={`${o.name} · ${o.district}, ${o.state} · ${o.animal_count} animals`}
                >
                  {o.owner_id}
                </button>
              ))}
            </div>
            <p className="map-footnote" style={{ marginTop: "0.4rem" }}>
              {formatNumber(hints.total_owners)} owners in the registry.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- DASHBOARD --------------------------------------------------------------
function Dashboard({ authUser, setAuthUser, theme, toggleTheme }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState(null);

  const [summary, setSummary] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const tabs = TABS_BY_ROLE[authUser.role] || TABS_BY_ROLE.FARMER;
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [statistic, setStatistic] = useState("reported");

  const canSeeClusters = authUser.role === "VET" || authUser.role === "ADMIN";

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await apiFetch("/analytics/summary?days=30", { authUser }));
      setLoadError(null);
    } catch (error) {
      setLoadError(error.message);
    }
  }, [authUser]);

  const loadClusters = useCallback(
    async ({ radiusKm = 5, minCases = 3 } = {}) => {
      // Clusters carry owner names and coordinates, so the endpoint is vet/admin
      // only. Farmers get the choropleth without the rings rather than an error.
      if (!canSeeClusters) return;
      const data = await apiFetch(
        `/analytics/clusters?radius_km=${radiusKm}&min_cases=${minCases}`,
        { authUser },
      );
      setClusters(data.clusters || []);
    },
    [authUser, canSeeClusters],
  );

  useEffect(() => {
    loadSummary();
    loadClusters().catch(() => setClusters([]));
  }, [loadSummary, loadClusters]);

  useEffect(() => {
    setOfflineQueue(JSON.parse(localStorage.getItem("pashu_offline_reports") || "[]"));
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Feedback banners are transient; leaving one pinned makes a later screen look
  // like it just failed.
  useEffect(() => {
    if (!feedbackMsg) return undefined;
    const t = setTimeout(() => setFeedbackMsg(null), 9000);
    return () => clearTimeout(t);
  }, [feedbackMsg]);

  const refreshAll = useCallback(() => {
    loadSummary();
    loadClusters().catch(() => {});
  }, [loadSummary, loadClusters]);

  const syncQueue = async () => {
    if (!offlineQueue.length) return;
    setIsSyncing(true);
    try {
      const data = await apiFetch("/reports/batch-sync", {
        method: "POST", authUser, body: { reports: offlineQueue },
      });
      setOfflineQueue([]);
      localStorage.removeItem("pashu_offline_reports");
      const rejected = data.rejected?.length
        ? ` ${data.rejected.length} rejected (not your animals).`
        : "";
      setFeedbackMsg({
        type: rejected ? "warning" : "success",
        text: `Synced ${data.synced_count} report(s).${rejected}`,
      });
      refreshAll();
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message });
    }
    setIsSyncing(false);
  };

  const content = useMemo(() => {
    switch (activeTab) {
      case "Outbreak Map":
        return (
          <>
            <Level
              totals={summary?.totals}
              deltas={summary?.deltas}
              samples={summary?.samples}
              statistic={statistic}
              onSelect={setStatistic}
            />
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <MapExplorer
                summary={summary}
                clusters={clusters}
                statistic={statistic}
              />
              <Timeseries timeseries={summary?.timeseries || []} />
              <StateTable summary={summary} statistic={statistic} />
            </div>
          </>
        );
      case "Submit Report":
        return (
          <SubmitReportPanel
            authUser={authUser}
            isOnline={isOnline}
            offlineQueue={offlineQueue}
            setOfflineQueue={setOfflineQueue}
            setFeedbackMsg={(m) => { setFeedbackMsg(m); if (m?.type === "success") refreshAll(); }}
          />
        );
      case "My Reports":
        return <MyReportsPanel authUser={authUser} setFeedbackMsg={setFeedbackMsg} />;
      case "All Reports":
        return <AllReportsPanel authUser={authUser} setFeedbackMsg={setFeedbackMsg} />;
      case "Outbreak Clusters":
        return (
          <ClustersPanel
            clusters={clusters}
            reloadClusters={loadClusters}
            setFeedbackMsg={setFeedbackMsg}
          />
        );
      case "Lab Samples":
        return <LabSamplesPanel authUser={authUser} setFeedbackMsg={setFeedbackMsg} />;
      case "Admin Tools":
        return (
          <AdminToolsPanel
            authUser={authUser}
            setFeedbackMsg={setFeedbackMsg}
            onDataChanged={refreshAll}
          />
        );
      default:
        return null;
    }
  }, [
    activeTab, summary, clusters, statistic, authUser, isOnline,
    offlineQueue, loadClusters, refreshAll,
  ]);

  return (
    <div className="App">
      <Navbar
        authUser={authUser}
        tabs={tabs}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOnline={isOnline}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={() => setAuthUser(null)}
      />

      <main className="Home fade-in-up">
        <div style={{ display: "grid", gap: "0.6rem", marginBottom: "0.5rem" }}>
          {loadError && (
            <div className="banner is-reported">
              Could not reach the surveillance API: {loadError}
            </div>
          )}
          {!isOnline && (
            <div className="banner is-critical">
              No connection. New reports are queued locally and sync on reconnect.
            </div>
          )}
          {isOnline && offlineQueue.length > 0 && (
            <div
              className="banner is-active"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}
            >
              <span>{offlineQueue.length} unsynced report(s).</span>
              <button type="button" className="btn" onClick={syncQueue} disabled={isSyncing}>
                {isSyncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          )}
          {feedbackMsg && (
            <div className={`banner is-${FEEDBACK_STATISTIC[feedbackMsg.type] || "active"}`}>
              {feedbackMsg.text}
            </div>
          )}
        </div>

        {summary && activeTab === "Outbreak Map" && (
          <p className="map-footnote" style={{ marginTop: 0 }}>
            Signed in as {ROLE_LABELS[authUser.role]} · {authUser.id} ·{" "}
            {formatNumber(summary.registry_size)} animals in the Pashu Aadhaar registry ·
            updated {new Date(summary.updated_at).toLocaleString()}
          </p>
        )}

        {content}
      </main>
    </div>
  );
}

// --- ROOT -------------------------------------------------------------------
export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [theme, toggleTheme] = useTheme();

  return (
    <>
      {!authUser ? (
        <LoginForm setAuthUser={setAuthUser} />
      ) : (
        <Dashboard
          authUser={authUser}
          setAuthUser={setAuthUser}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      )}
      <PwaPrompts />
    </>
  );
}
