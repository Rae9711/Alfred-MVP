/**
 * Google OAuth token management with automatic refresh.
 *
 * Reads GOOGLE_ACCESS_TOKEN from env on startup.
 * When the token expires, uses GOOGLE_REFRESH_TOKEN + client credentials to get a new one.
 */

let currentToken = (process.env.GOOGLE_ACCESS_TOKEN ?? "").trim();
let tokenExpiresAt = 0; // force refresh on first use

const REFRESH_TOKEN = (process.env.GOOGLE_REFRESH_TOKEN ?? "").trim();
const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();

const canRefresh = !!(REFRESH_TOKEN && CLIENT_ID && CLIENT_SECRET);

/**
 * Returns a valid Google access token.
 * Automatically refreshes if expired and refresh credentials are available.
 */
export async function getGoogleToken(): Promise<string | null> {
  if (!currentToken) return null;

  // If token still valid (with 60s buffer), return it
  if (Date.now() < tokenExpiresAt - 60_000) {
    return currentToken;
  }

  // Try to refresh
  if (!canRefresh) {
    console.warn("[google] token may be expired and no refresh credentials configured");
    return currentToken; // return anyway, let the API call fail with 401
  }

  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    const data = (await resp.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (data.access_token) {
      currentToken = data.access_token;
      tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
      // Update env so tools pick it up
      process.env.GOOGLE_ACCESS_TOKEN = currentToken;
      console.log("[google] token refreshed, expires in", data.expires_in, "s");
      return currentToken;
    }

    console.error("[google] refresh failed:", data.error);
    return currentToken;
  } catch (e: any) {
    console.error("[google] refresh error:", e?.message);
    return currentToken;
  }
}
