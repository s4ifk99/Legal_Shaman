import { REDDIT_USER_AGENT } from "./public-fetch";
import type { RedditTokenResponse } from "./types";

export class RedditSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedditSearchError";
  }
}

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cachedToken: CachedToken | null = null;

export function hasRedditAppCredentials(): boolean {
  return Boolean(
    process.env.REDDIT_CLIENT_ID?.trim() && process.env.REDDIT_CLIENT_SECRET?.trim(),
  );
}

/** True when OAuth can be used (app credentials, with or without user/password). */
export function hasRedditOAuthCredentials(): boolean {
  return hasRedditAppCredentials();
}

function requireClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new RedditSearchError(
      "Missing REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET (create a script app at reddit.com/prefs/apps)",
    );
  }
  return { clientId, clientSecret };
}

async function requestToken(body: URLSearchParams): Promise<string> {
  const { clientId, clientSecret } = requireClientCredentials();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": REDDIT_USER_AGENT,
      },
      body,
    });
  } catch (err) {
    throw new RedditSearchError(
      `Reddit OAuth request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const data = (await response.json()) as RedditTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new RedditSearchError(data.error ?? `Reddit OAuth failed with HTTP ${response.status}`);
  }

  const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 3600;
  cachedToken = {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };
  return data.access_token;
}

async function getAppOnlyAccessToken(): Promise<string> {
  return requestToken(new URLSearchParams({ grant_type: "client_credentials" }));
}

async function getPasswordAccessToken(): Promise<string> {
  const username = process.env.REDDIT_USERNAME?.trim();
  const password = process.env.REDDIT_PASSWORD?.trim();
  if (!username || !password) {
    throw new RedditSearchError("Missing REDDIT_USERNAME / REDDIT_PASSWORD for password grant");
  }
  return requestToken(
    new URLSearchParams({
      grant_type: "password",
      username,
      password,
    }),
  );
}

/** Reddit OAuth token (app-only first, then password grant). Cached in memory. */
export async function getRedditAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) {
    return cachedToken.accessToken;
  }

  cachedToken = null;

  if (!hasRedditAppCredentials()) {
    throw new RedditSearchError("Reddit API credentials are not configured");
  }

  try {
    return await getAppOnlyAccessToken();
  } catch (appErr) {
    if (process.env.REDDIT_USERNAME?.trim() && process.env.REDDIT_PASSWORD?.trim()) {
      try {
        return await getPasswordAccessToken();
      } catch {
        throw appErr;
      }
    }
    throw appErr;
  }
}

export function clearRedditTokenCache(): void {
  cachedToken = null;
}
