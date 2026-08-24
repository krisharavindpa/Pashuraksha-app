import React, { useEffect, useRef } from "react";

/**
 * Small dialog used for feature notices and confirmations.
 *
 * Closes on Escape and on backdrop click, and moves focus to the dismiss button
 * on open so keyboard users are not left behind the backdrop.
 */
export default function Modal({ open, title, icon, children, onClose, closeLabel = "Got it" }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {icon && <div className="modal-icon">{icon}</div>}
        <h3>{title}</h3>
        <div>{children}</div>
        <button ref={closeRef} type="button" className="btn btn-primary" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
