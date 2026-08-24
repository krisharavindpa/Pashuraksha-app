import React from "react";
import { ROLE_LABELS } from "../constants";

/**
 * Top bar: identity, tab navigation, connectivity, theme toggle.
 *
 * The reference dashboard uses a fixed left rail; that costs horizontal space
 * the map badly needs on a laptop, and this app has role-dependent tabs that
 * read better as a horizontal row, so the same elements are laid out along the
 * top instead.
 */
export default function Navbar({
  authUser,
  tabs,
  activeTab,
  setActiveTab,
  isOnline,
  theme,
  onToggleTheme,
  onLogout,
}) {
  return (
    <nav className="Navbar">
      <div className="brand">
        <h1>PashuRaksha</h1>
        <span>Livestock surveillance</span>
      </div>

      <div className="nav-links">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab}
            className={`nav-link ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
          >
            {tab}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span
          title={isOnline ? "Online" : "Offline — reports will be queued locally"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            fontSize: "0.68rem",
            fontWeight: 700,
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isOnline ? "var(--resolved)" : "var(--reported)",
            }}
          />
          {isOnline ? "Online" : "Offline"}
        </span>

        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle colour theme"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>

        <button
          type="button"
          className="nav-link"
          onClick={onLogout}
          title={`${ROLE_LABELS[authUser.role] || authUser.role} · ${authUser.id}`}
        >
          {authUser.id} ↩
        </button>
      </div>
    </nav>
  );
}
