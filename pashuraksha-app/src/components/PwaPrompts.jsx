import React, { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const DISMISS_KEY = "pashu_install_dismissed";

/**
 * Install and update prompts for the installed-app experience.
 *
 * Two separate concerns, deliberately in one file because they share the same
 * bottom-of-screen slot and must never stack on top of each other on a phone:
 *
 *   InstallPrompt — "add this to your home screen"
 *   UpdatePrompt  — "a new version is ready, reload when you're ready"
 *
 * The update prompt wins when both would show: a stale app shell is a
 * correctness problem, an uninstalled app is only a convenience one.
 */
export default function PwaPrompts() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error("Service worker registration failed", error);
    },
  });

  if (needRefresh) {
    return (
      <PromptBar
        statistic="active"
        text="A new version of PashuRaksha is ready."
        actionLabel="Reload"
        onAction={() => updateServiceWorker(true)}
        onDismiss={() => setNeedRefresh(false)}
      />
    );
  }

  return <InstallPrompt />;
}

function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return undefined;

    // Already launched from the home screen — nothing to install.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (standalone) return undefined;

    const onPrompt = (e) => {
      // Chrome/Android: hold the event so the install can be triggered from our
      // own button instead of the browser's mini-infobar.
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS Safari never fires beforeinstallprompt and has no programmatic
    // install, so the only option there is to tell the user where the button
    // is. Detected by feature absence rather than user-agent sniffing.
    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const isSafari = !/crios|fxios|edgios/i.test(window.navigator.userAgent);
    if (isIos && isSafari) {
      const t = setTimeout(() => setShowIosHint(true), 4000);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onPrompt);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDeferred(null);
    setShowIosHint(false);
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    // The event is single-use; a second prompt() on it throws.
    setDeferred(null);
    localStorage.setItem(DISMISS_KEY, "1");
  };

  if (deferred) {
    return (
      <PromptBar
        statistic="resolved"
        text="Install PashuRaksha for offline field use."
        actionLabel="Install"
        onAction={install}
        onDismiss={dismiss}
      />
    );
  }

  if (showIosHint) {
    return (
      <PromptBar
        statistic="resolved"
        text="Add to Home Screen: tap Share, then “Add to Home Screen”."
        onDismiss={dismiss}
      />
    );
  }

  return null;
}

function PromptBar({ statistic, text, actionLabel, onAction, onDismiss }) {
  return (
    <div className={`pwa-prompt is-${statistic}`} role="status">
      <span>{text}</span>
      <div className="pwa-prompt-actions">
        {actionLabel && (
          <button type="button" className="btn" onClick={onAction}>
            {actionLabel}
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
