/* ---------------------------------------------------------
   Yoto Browser OAuth (Authorization Code) – no PKCE, no secret
   --------------------------------------------------------- */

/*
  This implementation follows the documentation snippet provided by Yoto:
    1. Redirect the user to https://login.yotoplay.com/authorize
    2. On return, exchange ?code=… for access/refresh tokens
    3. Refresh tokens when the access token is expired
*/

const YOTO_CLIENT_ID = "uJ6QBRcivojvQT2B7EpvIyXnrJHU1r0p";
const AUDIENCE = "https://api.yotoplay.com";
const SCOPE = "offline_access";

/*  IMPORTANT – Set this to your GitHub Pages URL (or current page) */
const REDIRECT_URI = window.location.origin + window.location.pathname;

const AUTH_BASE = "https://login.yotoplay.com";
const AUTHORIZE_ENDPOINT = `${AUTH_BASE}/authorize`;
const TOKEN_ENDPOINT = `${AUTH_BASE}/oauth/token`;

const LS_KEY = "yoto_oauth";

/* ---------- Debug helper ---------- */
const DEBUG_AUTH = true;
function dbg(...args) {
  if (DEBUG_AUTH) console.log(...args);
}

/* ---------- Public API exported on window ---------- */
window.auth = {
  startAuth,
  completeAuth,
  getValidAccessToken,
  clearAuth,
};

/* -------------------------------------------------- */
/* 1. Redirect the user to Yoto login                 */
/* -------------------------------------------------- */
function startAuth() {
  const params = new URLSearchParams({
    audience: AUDIENCE,
    scope: SCOPE,
    response_type: "code",
    client_id: YOTO_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
  });

  const fullUrl = `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
  dbg("Redirecting to", fullUrl);
  window.location.href = fullUrl;
}

/* -------------------------------------------------- */
/* 2. Exchange returned code for tokens               */
/* -------------------------------------------------- */
async function completeAuth() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return false; // nothing to do

  dbg("Received code:", code);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: YOTO_CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
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
  dbg("Token JSON", data);
  storeTokens(data);

  // Clean up the URL (remove ?code= param)
  window.history.replaceState({}, "", REDIRECT_URI);
  return true;
}

/* -------------------------------------------------- */
/* 3. Silent access token retrieval / refresh         */
/* -------------------------------------------------- */
async function getValidAccessToken() {
  const record = getStoredTokens();
  if (!record) return null;

  if (!isTokenExpired(record.access_token)) {
    return record.access_token;
  }

  if (!record.refresh_token) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: YOTO_CLIENT_ID,
    refresh_token: record.refresh_token,
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
  dbg("Refreshed tokens", data);
  storeTokens(data);
  return data.access_token;
}

/* ---------- JWT expiry helpers ---------- */
function isTokenExpired(accessToken) {
  try {
    const payload = decodeJwt(accessToken);
    return Date.now() >= payload.exp * 1000;
  } catch (e) {
    console.warn("Unable to decode JWT, assuming expired:", e);
    return true;
  }
}

function decodeJwt(token) {
  const [, payloadBase64] = token.split(".");
  const json = atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(new Uint8Array([...json].map(c => c.charCodeAt(0)))));
}

/* ---------- Local storage helpers ---------- */
function storeTokens(tok) {
  const record = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
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
