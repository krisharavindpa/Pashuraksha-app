import { API_BASE_URL } from "./constants";

/**
 * Shared fetch helper: attaches the auth headers every protected endpoint needs
 * and turns non-2xx responses into a thrown Error carrying the backend's own
 * `detail` message, so every panel can handle failure the same way.
 *
 * `signal` is passed through so callers that fire on every keystroke (the Pashu
 * Aadhaar lookup) can abort a superseded request instead of letting a slow
 * earlier response overwrite a newer one.
 */
export async function apiFetch(path, { method = "GET", authUser, body, signal } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authUser) {
    headers["X-User-ID"] = authUser.id;
    headers["X-User-Role"] = authUser.role;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Some responses legitimately have no body.
  }

  if (!response.ok) {
    const message =
      (data && (data.detail || data.message)) || `Request failed (${response.status})`;
    const error = new Error(
      typeof message === "string" ? message : JSON.stringify(message),
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

/** True when an error is just an aborted in-flight request, not a real failure. */
export function isAbort(error) {
  return error?.name === "AbortError";
}
