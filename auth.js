/* ---------------------------------------------------------
   Yoto Browser OAuth (PKCE) – client-side helper functions
   --------------------------------------------------------- */

const YOTO_CLIENT_ID = "uJ6QBRcivojvQT2B7EpvIyXnrJHU1r0p";

/*  IMPORTANT – Set this to your GitHub Pages URL with trailing slash,
    e.g. https://username.github.io/repo/                         */
const REDIRECT_URI = window.location.origin + window.location.pathname; // works on GH-Pages

const AUTH_BASE = "https://auth.yoto.com";
const TOKEN_ENDPOINT = `${AUTH_BASE}/oauth/token`;
const AUTHORIZE_ENDPOINT = `${AUTH_BASE}/oauth/authorize`;

const LS_KEY = "yoto_oauth";

/* ---------- PKCE helpers ---------- */
function randomString(len = 64) {
  const array = new Uint8Array(len);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => ("0" + b.toString(16)).slice(-2)).join("");
}

async function sha256(base64String) {
  const encoder = new TextEncoder();
  const data = encoder.encode(base64String);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashBase64 = btoa(String.fromCharCode(...hashArray))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return hashBase64;
}

/* ---------- Public functions ---------- */
window.auth = {
  startAuth,
  completeAuth,
  getValidAccessToken,
  clearAuth,
};

/* Begin OAuth flow by redirecting the user */
async function startAuth() {
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256(codeVerifier);

  sessionStorage.setItem("pkce_code_verifier", codeVerifier);

  const params = new URLSearchParams({
    client_id: YOTO_CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: "openid profile offline_access",
  });

  window.location.href = `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

/* Call this on page load – it checks for ?code= and exchanges for tokens */
async function completeAuth() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return false; // nothing to do

  const codeVerifier = sessionStorage.getItem("pkce_code_verifier");
  if (!codeVerifier) {
    console.error("Missing code_verifier in sessionStorage");
    return false;
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: YOTO_CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.error("Token exchange failed", await res.text());
    return false;
  }

  const data = await res.json();
  storeTokens(data);

  // clean up URL
  window.history.replaceState({}, "", REDIRECT_URI);
  return true;
}

/* Returns access_token if still valid, silently refreshes if expired */
async function getValidAccessToken() {
  const record = getStoredTokens();
  if (!record) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (record.expires_at - 60 > nowSec) {
    return record.access_token; // still fresh
  }
  // need refresh
  if (!record.refresh_token) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: record.refresh_token,
    client_id: YOTO_CLIENT_ID,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.warn("Refresh failed", await res.text());
    clearAuth();
    return null;
  }
  const data = await res.json();
  storeTokens(data);
  return data.access_token;
}

/* ---------- Local storage helpers ---------- */
function storeTokens(tok) {
  const record = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + tok.expires_in,
    token_type: tok.token_type,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(record));
}

function getStoredTokens() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearAuth() {
  localStorage.removeItem(LS_KEY);
}
