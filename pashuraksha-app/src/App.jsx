import React, { useState, useEffect, useCallback, useMemo } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";

const AVAILABLE_SYMPTOMS = [
  { id: "high_fever", label: "High Fever" },
  { id: "skin_nodules", label: "Skin Nodules" },
  { id: "enlarged_lymph_nodes", label: "Swollen Lymph Nodes" },
  { id: "mouth_vesicles", label: "Mouth Blisters/Sores" },
  { id: "excessive_salivation", label: "Excessive Salivation/Drooling" },
  { id: "foot_lesions", label: "Foot Lesions" },
  { id: "lameness", label: "Lameness / Limping" },
  { id: "sudden_death", label: "Sudden Death" },
  { id: "bloody_discharge", label: "Bloody Discharge" },
  { id: "nasal_discharge", label: "Nasal Discharge" },
  { id: "diarrhea", label: "Severe Diarrhea" },
];

const ROLE_LABELS = {
  FARMER: "Farmer",
  VET: "Vet",
  ADMIN: "Administrator",
};

const SEVERITY_STYLES = {
  LOW: "bg-gray-100 text-gray-700",
  MODERATE: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-orange-100 text-orange-800",
  CRITICAL: "bg-red-100 text-red-800",
  RESOLVED: "bg-green-100 text-green-800",
};

const TABS_BY_ROLE = {
  FARMER: ["Submit Report", "My Reports"],
  VET: ["Submit Report", "All Reports", "Outbreak Clusters", "Lab Samples"],
  ADMIN: ["Submit Report", "All Reports", "Outbreak Clusters", "Lab Samples", "Admin Tools"],
};

// Shared fetch helper: attaches the auth headers every protected endpoint
// needs and turns non-2xx responses into a thrown Error with the backend's
// own detail message, so every panel can handle errors the same way.
async function apiFetch(path, { method = "GET", authUser, body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": authUser.id,
      "X-User-Role": authUser.role,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch (e) {
    // Some responses may have no body - that's fine.
  }

  if (!response.ok) {
    const message = (data && (data.detail || data.message)) || `Request failed (${response.status})`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data;
}

// --- 1. LOGIN COMPONENT ---
function LoginForm({ setAuthUser }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = (e) => {
    e.preventDefault();
    // Hardcoded hackathon credentials
    if (password === "farmer123") {
      setAuthUser({ id: username || "farmer_01", role: "FARMER" });
    } else if (password === "vet123") {
      setAuthUser({ id: username || "vet_01", role: "VET" });
    } else if (password === "admin123") {
      setAuthUser({ id: username || "admin_01", role: "ADMIN" });
    } else {
      setError("Invalid password. Use farmer123, vet123, or admin123");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 font-sans text-gray-800">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-center text-green-700 mb-2">PashuRaksha</h1>
        <p className="text-center text-gray-500 mb-6">Login to Access the Portal</p>

        {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username (Any)</label>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)} required
              className="w-full border-gray-300 rounded-md p-2 border focus:ring-green-500 focus:border-green-500"
              placeholder="e.g. ravi_kumar"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full border-gray-300 rounded-md p-2 border focus:ring-green-500 focus:border-green-500"
              placeholder="Enter role password"
            />
          </div>
          <button type="submit" className="w-full bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transition-colors">
            Login
          </button>
        </form>
        <p className="text-center text-xs text-gray-400 mt-4">
          Demo passwords: farmer123 · vet123 · admin123
        </p>
      </div>
    </div>
  );
}

// --- 2. SHARED UI PIECES ---
function TopBar({ authUser, setAuthUser, isOnline }) {
  return (
    <div className="flex justify-between items-center mb-6 border-b pb-4">
      <div>
        <h1 className="text-2xl font-bold text-green-700">PashuRaksha</h1>
        <span className="inline-block mt-1 bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded font-mono">
          {ROLE_LABELS[authUser.role] || authUser.role} · {authUser.id}
        </span>
      </div>
      <div className="flex flex-col items-end space-y-2">
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-500">{isOnline ? 'Online' : 'Offline'}</span>
          <div className={`h-3 w-3 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></div>
        </div>
        <button onClick={() => setAuthUser(null)} className="text-xs text-red-500 hover:underline">
          Logout
        </button>
      </div>
    </div>
  );
}

function FeedbackBanner({ feedbackMsg }) {
  if (!feedbackMsg) return null;
  const styles = {
    success: "bg-green-100 text-green-800",
    error: "bg-red-100 text-red-800",
    warning: "bg-yellow-100 text-yellow-800",
    info: "bg-blue-100 text-blue-800",
  };
  return (
    <div className={`p-3 rounded-md mb-4 text-sm font-medium ${styles[feedbackMsg.type] || styles.info}`}>
      {feedbackMsg.text}
    </div>
  );
}

function TabBar({ tabs, activeTab, setActiveTab }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4 border-b pb-3">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
            activeTab === tab
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

// --- 3. SUBMIT REPORT (Farmer / Vet / Admin) ---
function SubmitReportPanel({ authUser, isOnline, offlineQueue, setOfflineQueue, setFeedbackMsg }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    tag_id: "",
    species: "Cattle",
    symptoms: [],
    mortality_count: 0,
    latitude: null,
    longitude: null,
    village: "",
    district: "",
  });

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        setFormData(prev => ({
          ...prev,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        }));
      });
    }
  }, []);

  const handleInputChange = (e) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === "number" ? (value === "" ? "" : Number(value)) : value,
    }));
  };

  const handleSymptomToggle = (symptomId) => {
    setFormData(prev => {
      const isSelected = prev.symptoms.includes(symptomId);
      let newSymptoms = isSelected
        ? prev.symptoms.filter(id => id !== symptomId)
        : [...prev.symptoms, symptomId];

      if (newSymptoms.length > 5) {
        alert("Maximum 5 symptoms allowed for accurate triage.");
        return prev;
      }
      return { ...prev, symptoms: newSymptoms };
    });
  };

  const handleVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input not supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.start();
    setFeedbackMsg({ type: "info", text: "Listening... Try saying 'High fever and skin nodules'." });

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      setFeedbackMsg({ type: "info", text: `Heard: "${transcript}"` });

      setFormData(prev => {
        let updatedSymptoms = [...prev.symptoms];
        AVAILABLE_SYMPTOMS.forEach(sym => {
          if (transcript.includes(sym.label.toLowerCase().split('/')[0])) {
            if (!updatedSymptoms.includes(sym.id) && updatedSymptoms.length < 5) {
              updatedSymptoms.push(sym.id);
            }
          }
        });
        return { ...prev, symptoms: updatedSymptoms };
      });
    };

    recognition.onerror = () => {
      setFeedbackMsg({ type: "error", text: "Couldn't hear that clearly. Please try again." });
    };
  };

  const resetForm = () => {
    setFormData(prev => ({ ...prev, tag_id: "", symptoms: [], mortality_count: 0 }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!/^\d{12}$/.test(formData.tag_id)) {
      alert("Tag ID must be exactly 12 numeric digits.");
      return;
    }

    if (formData.latitude == null || formData.longitude == null) {
      alert("Location is required. Please enable GPS.");
      return;
    }

    setIsSubmitting(true);
    const payload = { ...formData, offline_created_at: new Date().toISOString() };

    if (!isOnline) {
      const newQueue = [...offlineQueue, payload];
      setOfflineQueue(newQueue);
      localStorage.setItem('pashu_offline_reports', JSON.stringify(newQueue));
      setFeedbackMsg({ type: "warning", text: "Saved offline. Will sync when internet is restored." });
      resetForm();
    } else {
      try {
        const data = await apiFetch("/reports", { method: "POST", authUser, body: payload });
        setFeedbackMsg({
          type: "success",
          text: `Report Submitted. Triage: ${data.triage.suspected_disease} (${data.triage.severity_level})`
        });
        resetForm();
      } catch (error) {
        setFeedbackMsg({ type: "error", text: error.message || "Submission failed." });
      }
    }
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Tag ID (12 Digits)</label>
        <input
          type="text" name="tag_id" value={formData.tag_id} onChange={handleInputChange} required
          placeholder="e.g. 900123456789"
          className="w-full border-gray-300 rounded-md shadow-sm p-2 border focus:ring-green-500 focus:border-green-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Species</label>
          <select name="species" value={formData.species} onChange={handleInputChange} className="w-full border-gray-300 rounded-md shadow-sm p-2 border">
            {['Cattle', 'Buffalo', 'Goat', 'Sheep', 'Pig'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Mortality Count</label>
          <input
            type="number" name="mortality_count" value={formData.mortality_count} min="0" onChange={handleInputChange}
            className="w-full border-gray-300 rounded-md shadow-sm p-2 border"
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="block text-sm font-medium text-gray-700">Symptoms (Max 5)</label>
          <button type="button" onClick={handleVoiceInput} className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-1 rounded flex items-center">
            🎙️ Voice Input
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_SYMPTOMS.map((sym) => (
            <button
              type="button" key={sym.id}
              onClick={() => handleSymptomToggle(sym.id)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                formData.symptoms.includes(sym.id)
                  ? 'bg-red-100 border-red-500 text-red-700'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {sym.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Village</label>
          <input type="text" name="village" value={formData.village} onChange={handleInputChange} required className="w-full border-gray-300 rounded-md shadow-sm p-2 border"/>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">District</label>
          <input type="text" name="district" value={formData.district} onChange={handleInputChange} required className="w-full border-gray-300 rounded-md shadow-sm p-2 border"/>
        </div>
      </div>

      <div className="text-xs text-gray-500 mb-4 flex items-center">
        📍 GPS: {formData.latitude != null && formData.longitude != null ? `${formData.latitude.toFixed(4)}, ${formData.longitude.toFixed(4)}` : "Fetching location..."}
      </div>

      <button
        type="submit" disabled={isSubmitting}
        className={`w-full text-white font-bold py-3 rounded-lg shadow-lg transition-all ${
          isSubmitting ? 'bg-gray-400' : isOnline ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'
        }`}
      >
        {isSubmitting ? 'Processing...' : isOnline ? 'Submit Alert' : 'Save Offline'}
      </button>
    </form>
  );
}

// --- 4. FARMER: MY REPORTS ---
function MyReportsPanel({ authUser, setFeedbackMsg }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/reports/mine", { authUser });
      setReports(data);
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message || "Could not load your reports." });
    }
    setLoading(false);
  }, [authUser, setFeedbackMsg]);

  useEffect(() => { loadReports(); }, [loadReports]);

  return (
    <div className="space-y-3">
      <button type="button" onClick={loadReports} className="text-xs text-green-700 hover:underline">🔄 Refresh</button>
      {loading && <p className="text-sm text-gray-500">Loading your reports...</p>}
      {!loading && reports.length === 0 && (
        <p className="text-sm text-gray-500">You haven't submitted any reports yet.</p>
      )}
      {reports.map((r) => (
        <div key={r.id} className="border rounded-lg p-3">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-sm">Tag: {r.tag_id} · {r.species}</p>
              <p className="text-xs text-gray-500">{r.village}, {r.district}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${SEVERITY_STYLES[r.severity_level] || SEVERITY_STYLES.LOW}`}>
              {r.severity_level}
            </span>
          </div>
          <p className="text-sm mt-2"><strong>Suspected:</strong> {r.suspected_disease}</p>
          <p className="text-xs text-gray-400 mt-1">
            {r.server_received_at ? new Date(r.server_received_at).toLocaleString() : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

// --- 5. VET/ADMIN: ALL REPORTS ---
function AllReportsPanel({ authUser, setFeedbackMsg }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sampleFormFor, setSampleFormFor] = useState(null);
  const [sampleType, setSampleType] = useState("Blood");
  const [labName, setLabName] = useState("");

  // Search / sort controls. Filtering and sorting run client-side over the
  // already-loaded list, so results are instant and no backend contract
  // changes are needed.
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState("desc"); // "desc" = newest first (default)

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/reports", { authUser });
      setReports(data);
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message || "Could not load reports." });
    }
    setLoading(false);
  }, [authUser, setFeedbackMsg]);

  useEffect(() => { loadReports(); }, [loadReports]);

  const handleResolve = async (reportId) => {
    try {
      await apiFetch(`/reports/${reportId}/resolve`, { method: "PATCH", authUser });
      setFeedbackMsg({ type: "success", text: "Report marked as resolved." });
      loadReports();
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message || "Could not resolve report." });
    }
  };

  const handleCreateSample = async (reportId) => {
    try {
      const data = await apiFetch("/lab/samples", {
        method: "POST",
        authUser,
        body: { report_id: reportId, sample_type: sampleType, lab_name: labName || null },
      });
      setFeedbackMsg({ type: "success", text: `Sample ${data.sample_id} registered for lab referral.` });
      setSampleFormFor(null);
      setLabName("");
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message || "Could not register sample." });
    }
  };

  const hasActiveFilters = Boolean(searchQuery || dateFrom || dateTo);

  const visibleReports = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : null;
    // Make "To" inclusive of the whole selected day.
    const toTime = dateTo ? new Date(dateTo).getTime() + (24 * 60 * 60 * 1000 - 1) : null;

    const filtered = reports.filter((r) => {
      if (query) {
        const haystack = [
          r.id, r.tag_id, r.village, r.district, r.suspected_disease,
          r.reported_by, r.severity_level, r.species, r.cluster_id,
          r.server_received_at ? new Date(r.server_received_at).toLocaleString() : "",
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (fromTime !== null || toTime !== null) {
        const t = r.server_received_at ? new Date(r.server_received_at).getTime() : null;
        if (t === null) return false;
        if (fromTime !== null && t < fromTime) return false;
        if (toTime !== null && t > toTime) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const ta = a.server_received_at ? new Date(a.server_received_at).getTime() : 0;
      const tb = b.server_received_at ? new Date(b.server_received_at).getTime() : 0;
      return sortOrder === "desc" ? tb - ta : ta - tb;
    });

    return filtered;
  }, [reports, searchQuery, dateFrom, dateTo, sortOrder]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <button type="button" onClick={loadReports} className="text-xs text-green-700 hover:underline">🔄 Refresh</button>
        {reports.length > 0 && (
          <span className="text-xs text-gray-400">Showing {visibleReports.length} of {reports.length}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-gray-50 border rounded-lg p-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Report ID, Tag ID, Village, District, Disease..."
            className="w-full border-gray-300 rounded-md p-1.5 border text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input
            type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="border-gray-300 rounded-md p-1.5 border text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input
            type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="border-gray-300 rounded-md p-1.5 border text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
          className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded whitespace-nowrap"
        >
          {sortOrder === "desc" ? "Newest First ↓" : "Oldest First ↑"}
        </button>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => { setSearchQuery(""); setDateFrom(""); setDateTo(""); }}
            className="text-xs text-red-500 hover:underline whitespace-nowrap"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-gray-500">Loading reports...</p>}
      {!loading && reports.length === 0 && <p className="text-sm text-gray-500">No reports submitted yet.</p>}
      {!loading && reports.length > 0 && visibleReports.length === 0 && (
        <p className="text-sm text-gray-500">No reports match your search/filters.</p>
      )}
      {visibleReports.map((r) => (
        <div key={r.id} className="border rounded-lg p-3">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-sm">Tag: {r.tag_id} · {r.species}</p>
              <p className="text-xs text-gray-500">{r.village}, {r.district} · reported by {r.reported_by}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {r.server_received_at ? new Date(r.server_received_at).toLocaleString() : ""}
              </p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${SEVERITY_STYLES[r.severity_level] || SEVERITY_STYLES.LOW}`}>
              {r.severity_level}
            </span>
          </div>
          <p className="text-sm mt-2"><strong>Suspected:</strong> {r.suspected_disease}</p>
          {r.cluster_id && <p className="text-xs text-purple-600 mt-1">Cluster: {r.cluster_id}</p>}

          {r.severity_level !== "RESOLVED" && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" onClick={() => handleResolve(r.id)} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200">
                ✅ Mark Resolved
              </button>
              <button type="button" onClick={() => setSampleFormFor(sampleFormFor === r.id ? null : r.id)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200">
                🧪 Refer Lab Sample
              </button>
            </div>
          )}

          {sampleFormFor === r.id && (
            <div className="mt-3 border-t pt-3 flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Sample Type</label>
                <select value={sampleType} onChange={e => setSampleType(e.target.value)} className="border-gray-300 rounded-md p-1.5 border text-sm">
                  {['Blood', 'Nasal Swab', 'Scab Tissue'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Lab Name (optional)</label>
                <input type="text" value={labName} onChange={e => setLabName(e.target.value)} className="border-gray-300 rounded-md p-1.5 border text-sm" />
              </div>
              <button type="button" onClick={() => handleCreateSample(r.id)} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">
                Submit Referral
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- 6. VET/ADMIN: OUTBREAK CLUSTERS ---
function ClustersPanel({ authUser, setFeedbackMsg }) {
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [radiusKm, setRadiusKm] = useState(5);
  const [minCases, setMinCases] = useState(3);

  const loadClusters = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/analytics/clusters?radius_km=${radiusKm}&min_cases=${minCases}`, { authUser });
      setClusters(data.clusters || []);
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message || "Could not load clusters." });
    }
    setLoading(false);
  }, [authUser, radiusKm, minCases, setFeedbackMsg]);

  useEffect(() => { loadClusters(); }, [loadClusters]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end bg-gray-50 border rounded-lg p-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Radius (km)</label>
          <input type="number" min="1" value={radiusKm} onChange={e => setRadiusKm(Number(e.target.value))} className="w-20 border-gray-300 rounded-md p-1.5 border text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Min Cases</label>
          <input type="number" min="1" value={minCases} onChange={e => setMinCases(Number(e.target.value))} className="w-20 border-gray-300 rounded-md p-1.5 border text-sm" />
        </div>
        <button type="button" onClick={loadClusters} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700">
          Run Detection
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500">Scanning for outbreak clusters...</p>}
      {!loading && clusters.length === 0 && <p className="text-sm text-gray-500">No active clusters detected.</p>}

      {clusters.map((c) => (
        <div key={c.cluster_id} className="border rounded-lg p-3 border-red-200 bg-red-50">
          <div className="flex justify-between items-start">
            <p className="font-semibold text-sm text-red-800">{c.cluster_id} · {c.primary_disease}</p>
            <span className="text-xs bg-red-600 text-white px-2 py-1 rounded-full">{c.case_count} cases</span>
          </div>
          <p className="text-xs text-gray-600 mt-1">Villages: {c.affected_villages.join(", ")}</p>
          <ul className="text-xs text-gray-700 list-disc list-inside mt-2 space-y-0.5">
            {c.recommended_protocols.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

// --- 7. VET/ADMIN: LAB SAMPLES ---
function LabSamplesPanel({ authUser, setFeedbackMsg }) {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadSamples = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/lab/samples", { authUser });
      setSamples(data);
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message || "Could not load lab samples." });
    }
    setLoading(false);
  }, [authUser, setFeedbackMsg]);

  useEffect(() => { loadSamples(); }, [loadSamples]);

  const updateStatus = async (sampleId, statusValue, resultValue) => {
    try {
      await apiFetch(`/lab/samples/${sampleId}`, { method: "PATCH", authUser, body: { status: statusValue, result: resultValue } });
      setFeedbackMsg({ type: "success", text: `Sample ${sampleId} updated.` });
      loadSamples();
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message || "Could not update sample." });
    }
  };

  return (
    <div className="space-y-3">
      <button type="button" onClick={loadSamples} className="text-xs text-green-700 hover:underline">🔄 Refresh</button>
      {loading && <p className="text-sm text-gray-500">Loading lab samples...</p>}
      {!loading && samples.length === 0 && <p className="text-sm text-gray-500">No lab samples registered yet.</p>}
      {samples.map((s) => (
        <div key={s.sample_id} className="border rounded-lg p-3">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-sm">{s.sample_id} · {s.sample_type}</p>
              <p className="text-xs text-gray-500">Report: {s.report_id} · Lab: {s.lab_name || "Unassigned"}</p>
            </div>
            <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full">{s.status}</span>
          </div>
          {s.result && <p className="text-sm mt-2"><strong>Result:</strong> {s.result}</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            {['IN_TRANSIT', 'TESTING', 'CONFIRMED'].map(st => (
              <button type="button" key={st} onClick={() => updateStatus(s.sample_id, st, s.result)} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200">
                {st.replace('_', ' ')}
              </button>
            ))}
            {['POSITIVE', 'NEGATIVE', 'INCONCLUSIVE'].map(res => (
              <button type="button" key={res} onClick={() => updateStatus(s.sample_id, 'CONFIRMED', res)} className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded hover:bg-purple-200">
                Result: {res}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- 8. ADMIN: DANGER ZONE ---
function AdminToolsPanel({ authUser, setFeedbackMsg }) {
  const [confirmText, setConfirmText] = useState("");

  const handleClearAll = async () => {
    if (confirmText !== "DELETE ALL") return;
    try {
      await apiFetch("/reports", { method: "DELETE", authUser });
      setFeedbackMsg({ type: "success", text: "All reports and samples cleared." });
      setConfirmText("");
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message || "Could not clear reports." });
    }
  };

  return (
    <div className="border border-red-300 bg-red-50 rounded-lg p-4 space-y-3">
      <h3 className="font-bold text-red-700">⚠️ Danger Zone</h3>
      <p className="text-sm text-red-600">
        This permanently deletes every report and lab sample in the system. Only use this to reset demo data.
      </p>
      <input
        type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
        placeholder='Type "DELETE ALL" to confirm'
        className="w-full border-red-300 rounded-md p-2 border text-sm"
      />
      <button
        type="button"
        onClick={handleClearAll}
        disabled={confirmText !== "DELETE ALL"}
        className={`w-full font-bold py-2 rounded-lg text-white ${confirmText === "DELETE ALL" ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-300 cursor-not-allowed'}`}
      >
        Clear All Reports & Samples
      </button>
    </div>
  );
}

// --- 9. ROLE-AWARE DASHBOARD ---
function Dashboard({ authUser, setAuthUser }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState(null);

  const tabs = TABS_BY_ROLE[authUser.role] || TABS_BY_ROLE.FARMER;
  const [activeTab, setActiveTab] = useState(tabs[0]);

  useEffect(() => {
    const savedQueue = JSON.parse(localStorage.getItem('pashu_offline_reports') || "[]");
    setOfflineQueue(savedQueue);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleBatchSync = async () => {
    if (offlineQueue.length === 0) return;
    setIsSyncing(true);
    try {
      const data = await apiFetch("/reports/batch-sync", { method: "POST", authUser, body: { reports: offlineQueue } });
      setOfflineQueue([]);
      localStorage.removeItem('pashu_offline_reports');
      setFeedbackMsg({
        type: "success",
        text: `Synced ${data.synced_count} report(s).${data.skipped_duplicate_tags.length ? ` Skipped duplicates: ${data.skipped_duplicate_tags.join(', ')}` : ''}`
      });
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message || "Network error during sync." });
    }
    setIsSyncing(false);
  };

  const renderTab = () => {
    switch (activeTab) {
      case "Submit Report":
        return <SubmitReportPanel authUser={authUser} isOnline={isOnline} offlineQueue={offlineQueue} setOfflineQueue={setOfflineQueue} setFeedbackMsg={setFeedbackMsg} />;
      case "My Reports":
        return <MyReportsPanel authUser={authUser} setFeedbackMsg={setFeedbackMsg} />;
      case "All Reports":
        return <AllReportsPanel authUser={authUser} setFeedbackMsg={setFeedbackMsg} />;
      case "Outbreak Clusters":
        return <ClustersPanel authUser={authUser} setFeedbackMsg={setFeedbackMsg} />;
      case "Lab Samples":
        return <LabSamplesPanel authUser={authUser} setFeedbackMsg={setFeedbackMsg} />;
      case "Admin Tools":
        return <AdminToolsPanel authUser={authUser} setFeedbackMsg={setFeedbackMsg} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 font-sans text-gray-800">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-md overflow-hidden p-6 relative">
        <TopBar authUser={authUser} setAuthUser={setAuthUser} isOnline={isOnline} />

        {!isOnline && (
          <div className="bg-yellow-100 text-yellow-800 p-3 rounded-md mb-4 text-sm font-medium">
            No internet connection. New reports will be saved locally.
          </div>
        )}
        {isOnline && offlineQueue.length > 0 && (
          <div className="bg-blue-100 text-blue-800 p-3 rounded-md mb-4 flex justify-between items-center">
            <span className="text-sm">{offlineQueue.length} unsynced report(s).</span>
            <button type="button" onClick={handleBatchSync} disabled={isSyncing} className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        )}

        <FeedbackBanner feedbackMsg={feedbackMsg} />

        <TabBar tabs={tabs} activeTab={activeTab} setActiveTab={setActiveTab} />

        {renderTab()}
      </div>
    </div>
  );
}

// --- 10. ROOT APP (ROUTER LOGIC) ---
export default function App() {
  const [authUser, setAuthUser] = useState(null);

  // If no user is logged in, show the Login screen
  if (!authUser) {
    return <LoginForm setAuthUser={setAuthUser} />;
  }

  // If logged in, route to the role-aware dashboard
  return <Dashboard authUser={authUser} setAuthUser={setAuthUser} />;
}