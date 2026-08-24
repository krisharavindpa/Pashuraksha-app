import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, isAbort } from "../api";
import { AVAILABLE_SYMPTOMS, SPECIES } from "../constants";
import Modal from "./Modal";

const BLANK = {
  tag_id: "",
  species: "Cattle",
  symptoms: [],
  mortality_count: 0,
  latitude: null,
  longitude: null,
  village: "",
  district: "",
  state: "",
};

/**
 * Field report form, driven by the Pashu Aadhaar registry.
 *
 * The whole location block is derived, not typed: once the 12th digit lands the
 * form looks the tag up and fills village / district / state / GPS from the
 * registry. The lookup is also the ownership gate — the backend returns 403 for
 * an animal registered to someone else, and the form surfaces that as a refusal
 * rather than silently falling back to manual entry, because "this animal isn't
 * yours" is the answer the farmer needs to see.
 */
export default function SubmitReportPanel({
  authUser,
  isOnline,
  offlineQueue,
  setOfflineQueue,
  setFeedbackMsg,
}) {
  const [formData, setFormData] = useState(BLANK);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lookup, setLookup] = useState({ status: "idle" });
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [gps, setGps] = useState(null);
  const abortRef = useRef(null);

  // Device GPS is only a fallback for animals not in the registry; a registered
  // animal always uses its registered location, which is authoritative.
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => setGps(null),
      { timeout: 8000 },
    );
  }, []);

  const tag = formData.tag_id;
  const isComplete = /^\d{12}$/.test(tag);

  // --- Pashu Aadhaar lookup -------------------------------------------------
  useEffect(() => {
    abortRef.current?.abort();

    if (!isComplete) {
      setLookup({ status: tag.length ? "partial" : "idle" });
      setFormData((prev) => ({
        ...prev,
        village: "",
        district: "",
        state: "",
        latitude: null,
        longitude: null,
      }));
      return undefined;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLookup({ status: "checking" });

    // Small debounce: the effect fires on the keystroke that completes the 12th
    // digit, and a paste-then-correct sequence would otherwise fire twice.
    const timer = setTimeout(() => {
      apiFetch(`/livestock/${tag}`, { authUser, signal: controller.signal })
        .then((animal) => {
          setLookup({ status: "found", animal });
          setFormData((prev) => ({
            ...prev,
            species: animal.species || prev.species,
            village: animal.village || "",
            district: animal.district || "",
            state: animal.state || "",
            latitude: animal.latitude,
            longitude: animal.longitude,
          }));
        })
        .catch((error) => {
          if (isAbort(error)) return;
          setLookup({
            status: error.status === 403 ? "forbidden" : "missing",
            message: error.message,
          });
        });
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tag, isComplete, authUser]);

  const autoFilled = lookup.status === "found";
  const blocked = lookup.status === "forbidden";

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "number" ? (value === "" ? 0 : Number(value)) : value,
    }));
  };

  const handleTagChange = (e) => {
    // Digits only, hard-capped at 12 — a 13th keystroke should do nothing
    // rather than briefly invalidate an already-valid lookup.
    const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
    setFormData((prev) => ({ ...prev, tag_id: digits }));
  };

  const toggleSymptom = (id) => {
    setFormData((prev) => {
      const has = prev.symptoms.includes(id);
      if (!has && prev.symptoms.length >= 5) {
        setFeedbackMsg({
          type: "warning",
          text: "Maximum 5 symptoms — triage accuracy drops past that.",
        });
        return prev;
      }
      return {
        ...prev,
        symptoms: has
          ? prev.symptoms.filter((s) => s !== id)
          : [...prev.symptoms, id],
      };
    });
  };

  const resetForm = useCallback(() => {
    setFormData({ ...BLANK });
    setLookup({ status: "idle" });
  }, []);

  const canSubmit = useMemo(() => {
    if (!isComplete || blocked || isSubmitting) return false;
    if (!formData.symptoms.length) return false;
    // Unregistered tags need a location from somewhere, or the backend rejects.
    if (!autoFilled && formData.latitude == null && !gps) return false;
    return true;
  }, [isComplete, blocked, isSubmitting, formData, autoFilled, gps]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    const payload = {
      // Sent under the registry's own name; the backend accepts either.
      pashu_aadhaar: formData.tag_id,
      species: formData.species,
      symptoms: formData.symptoms,
      mortality_count: formData.mortality_count,
      latitude: autoFilled ? formData.latitude : (formData.latitude ?? gps?.latitude),
      longitude: autoFilled ? formData.longitude : (formData.longitude ?? gps?.longitude),
      village: formData.village || undefined,
      district: formData.district || undefined,
      state: formData.state || undefined,
      offline_created_at: new Date().toISOString(),
    };

    if (!isOnline) {
      const queue = [...offlineQueue, payload];
      setOfflineQueue(queue);
      localStorage.setItem("pashu_offline_reports", JSON.stringify(queue));
      setFeedbackMsg({
        type: "warning",
        text: "Saved offline. It will sync when the connection is back.",
      });
      resetForm();
      setIsSubmitting(false);
      return;
    }

    try {
      const data = await apiFetch("/reports", { method: "POST", authUser, body: payload });
      setFeedbackMsg({
        type: data.triage.immediate_action_required ? "error" : "success",
        text: `Report filed — ${data.triage.suspected_disease} (${data.triage.severity_level}). ${data.triage.advisory || ""}`,
      });
      resetForm();
    } catch (error) {
      setFeedbackMsg({ type: "error", text: error.message || "Submission failed." });
    }
    setIsSubmitting(false);
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="card" style={{ display: "grid", gap: "1rem" }}>
        <div className="field">
          <label htmlFor="tag_id">Pashu Aadhaar (12 digits)</label>
          <input
            id="tag_id"
            name="tag_id"
            className="input mono"
            inputMode="numeric"
            autoComplete="off"
            value={formData.tag_id}
            onChange={handleTagChange}
            placeholder="900412780031"
            required
          />
          <LookupStatus lookup={lookup} tagLength={tag.length} />
        </div>

        <LocationBlock
          formData={formData}
          autoFilled={autoFilled}
          blocked={blocked}
          gps={gps}
          onChange={handleChange}
        />

        <div className="form-row-2">
          <div className="field">
            <label htmlFor="species">Species</label>
            <select
              id="species"
              name="species"
              value={formData.species}
              onChange={handleChange}
              disabled={autoFilled}
              title={autoFilled ? "Taken from the registry record" : undefined}
            >
              {SPECIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="mortality_count">Mortality count</label>
            <input
              id="mortality_count"
              type="number"
              name="mortality_count"
              min="0"
              value={formData.mortality_count}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="field">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <label style={{ marginBottom: 0 }}>
              Symptoms ({formData.symptoms.length}/5)
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => setVoiceOpen(true)}
              style={{ padding: "0.35rem 0.6rem", fontSize: "0.72rem" }}
            >
              🎙 Voice input
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {AVAILABLE_SYMPTOMS.map((sym) => (
              <button
                type="button"
                key={sym.id}
                className={`chip ${formData.symptoms.includes(sym.id) ? "selected" : ""}`}
                onClick={() => toggleSymptom(sym.id)}
                aria-pressed={formData.symptoms.includes(sym.id)}
              >
                {sym.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className={`btn ${isOnline ? "btn-primary" : ""}`}
          disabled={!canSubmit}
          style={
            !isOnline && canSubmit
              ? { background: "var(--critical)", color: "#fff" }
              : undefined
          }
        >
          {isSubmitting
            ? "Submitting…"
            : blocked
              ? "Animal not registered to you"
              : isOnline
                ? "Submit alert"
                : "Save offline"}
        </button>
      </form>

      <Modal
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        title="Will be implemented"
        icon="🎙"
      >
        <p>
          Voice-driven symptom capture is on the roadmap. It will let a farmer
          describe symptoms out loud in their own language instead of tapping
          through the list.
        </p>
      </Modal>
    </>
  );
}

/** Inline result of the registry lookup, in the four states it can be in. */
function LookupStatus({ lookup, tagLength }) {
  if (lookup.status === "idle") {
    return (
      <span className="map-footnote" style={{ marginTop: "0.35rem" }}>
        Location fills in automatically from the registry.
      </span>
    );
  }

  if (lookup.status === "partial") {
    return (
      <span className="map-footnote" style={{ marginTop: "0.35rem" }}>
        {12 - tagLength} more digit{12 - tagLength === 1 ? "" : "s"}…
      </span>
    );
  }

  if (lookup.status === "checking") {
    return (
      <span className="map-footnote" style={{ marginTop: "0.35rem" }}>
        Checking the registry…
      </span>
    );
  }

  if (lookup.status === "found") {
    const a = lookup.animal;
    return (
      <div className="banner is-resolved" style={{ marginTop: "0.4rem" }}>
        ✓ {a.owner_name} · {a.species}
        {a.breed ? ` (${a.breed})` : ""}
        {a.owned_by_requester ? "" : " · viewing as vet/admin"}
      </div>
    );
  }

  if (lookup.status === "forbidden") {
    return (
      <div className="banner is-reported" style={{ marginTop: "0.4rem" }}>
        ✕ {lookup.message}
      </div>
    );
  }

  return (
    <div className="banner is-critical" style={{ marginTop: "0.4rem" }}>
      ⚠ {lookup.message} Enter the location manually below.
    </div>
  );
}

/**
 * Location fields. Read-only once auto-filled — the registry is authoritative
 * for a registered animal and the backend overwrites whatever a client sends,
 * so an editable field here would be a lie about what gets stored.
 */
function LocationBlock({ formData, autoFilled, blocked, gps, onChange }) {
  if (blocked) return null;

  const coords =
    formData.latitude != null
      ? `${formData.latitude.toFixed(4)}, ${formData.longitude.toFixed(4)}`
      : gps
        ? `${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)} (device)`
        : "Waiting for GPS…";

  return (
    <div
      style={{
        display: "grid",
        gap: "0.75rem",
        padding: "0.85rem",
        borderRadius: "var(--radius)",
        background: autoFilled ? "rgba(40,167,69,0.06)" : "rgba(108,117,125,0.06)",
      }}
    >
      <div
        className="section-title"
        style={{ marginBottom: 0, color: autoFilled ? "var(--resolved)" : undefined }}
      >
        {autoFilled ? "Location — from registry" : "Location — manual"}
      </div>

      <div className="form-row-3">
        {["village", "district", "state"].map((key) => (
          <div className="field" key={key}>
            <label htmlFor={key} style={{ textTransform: "capitalize" }}>{key}</label>
            <input
              id={key}
              name={key}
              value={formData[key]}
              onChange={onChange}
              readOnly={autoFilled}
              required={!autoFilled && key !== "state"}
              placeholder={autoFilled ? "" : "—"}
              style={autoFilled ? { opacity: 0.85, cursor: "default" } : undefined}
            />
          </div>
        ))}
      </div>

      <span className="map-footnote" style={{ marginTop: 0 }}>📍 {coords}</span>
    </div>
  );
}
