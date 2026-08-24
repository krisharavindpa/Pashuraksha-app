// Shared vocabulary for the dashboard: the statistics the map/table/cards can
// display, and the symptom list the report form offers.

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";

export const AVAILABLE_SYMPTOMS = [
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

export const ROLE_LABELS = {
  FARMER: "Farmer",
  VET: "Veterinarian",
  ADMIN: "Administrator",
};

// The six statistics the Level cards expose. `key` matches the metric names the
// backend's /analytics/summary returns, so a card, a map choropleth and a table
// column can all be driven from the same selection with no translation layer.
export const STATISTICS = [
  { key: "reported", label: "Reported", color: "#ff073a" },
  { key: "active", label: "Active", color: "#007bff" },
  { key: "critical", label: "Critical", color: "#fd7e14" },
  { key: "resolved", label: "Resolved", color: "#28a745" },
  { key: "mortality", label: "Mortality", color: "#6c757d" },
];

export const STATISTIC_BY_KEY = Object.fromEntries(
  STATISTICS.map((s) => [s.key, s]),
);

// Severity is a per-report property, not a dashboard statistic, so it keeps its
// own scale. Mapped onto the same palette for visual consistency.
export const SEVERITY_STATISTIC = {
  LOW: "mortality",
  MODERATE: "critical",
  HIGH: "critical",
  CRITICAL: "reported",
  RESOLVED: "resolved",
};

export const SPECIES = ["Cattle", "Buffalo", "Goat", "Sheep", "Pig"];

export const SAMPLE_TYPES = ["Blood", "Nasal Swab", "Scab Tissue"];

export function formatNumber(value) {
  if (value == null) return "–";
  return value.toLocaleString("en-IN");
}

export function formatDelta(value) {
  if (!value) return "";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-IN")}`;
}
