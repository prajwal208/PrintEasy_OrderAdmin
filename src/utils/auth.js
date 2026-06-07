const FIREBASE_API_KEY =
  import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyC-mvRzLqUwy4vddFlEXFvLEdiR1QvFFMk';

const TOKEN_REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;

export const AUTH_STORAGE = {
  authToken: 'authToken',
  refreshToken: 'refreshToken',
  tokenExpiresAt: 'tokenExpiresAt',
  userEmail: 'userEmail',
};

/** Save tokens after login or refresh (Firebase idToken / refreshToken / expiresIn). */
export function persistAuthSession({ idToken, refreshToken, expiresIn, email }) {
  if (idToken) localStorage.setItem(AUTH_STORAGE.authToken, idToken);
  if (refreshToken) localStorage.setItem(AUTH_STORAGE.refreshToken, refreshToken);
  if (email) localStorage.setItem(AUTH_STORAGE.userEmail, email);
  const ttlSec = Number(expiresIn || 3600);
  localStorage.setItem(AUTH_STORAGE.tokenExpiresAt, String(Date.now() + ttlSec * 1000));
}

export function clearAuthSession() {
  Object.values(AUTH_STORAGE).forEach((key) => localStorage.removeItem(key));
}

export function hasStoredSession() {
  return !!(
    localStorage.getItem(AUTH_STORAGE.authToken) ||
    localStorage.getItem(AUTH_STORAGE.refreshToken)
  );
}

let refreshInFlight = null;

/** Exchange refresh token for a new Firebase id token. */
export async function refreshIdToken() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const refreshToken = localStorage.getItem(AUTH_STORAGE.refreshToken);
      if (!refreshToken) return null;

      const res = await fetch(TOKEN_REFRESH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      });

      const data = await res.json();
      if (!res.ok || !data.id_token) {
        console.error('Token refresh failed:', data.error?.message || data);
        clearAuthSession();
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
        return null;
      }

      persistAuthSession({
        idToken: data.id_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      });
      return data.id_token;
    } catch (err) {
      console.error('Error refreshing token:', err);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/** Return a valid access token, refreshing proactively before expiry. */
export async function getValidAuthToken() {
  const token = localStorage.getItem(AUTH_STORAGE.authToken);
  const expiresAt = Number(localStorage.getItem(AUTH_STORAGE.tokenExpiresAt) || 0);
  const refreshToken = localStorage.getItem(AUTH_STORAGE.refreshToken);

  const expiringSoon = expiresAt > 0 && Date.now() >= expiresAt - 60_000;
  const needsRefresh = !token || expiringSoon;

  if (needsRefresh && refreshToken) {
    return refreshIdToken();
  }
  return token;
}

/** fetch wrapper: attaches Bearer token and retries once after refresh on 401. */
export async function authFetch(input, init = {}) {
  const token = await getValidAuthToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res = await fetch(input, { ...init, headers });

  if (res.status === 401 && localStorage.getItem(AUTH_STORAGE.refreshToken)) {
    const newToken = await refreshIdToken();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      res = await fetch(input, { ...init, headers });
    }
  }

  return res;
}
