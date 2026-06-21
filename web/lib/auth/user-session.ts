import { cookies } from "next/headers";

const SESSION_SALT = "signpost-user-v1";
export const USER_SESSION_COOKIE = "user_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 90;

export type PublicUser = {
  id: string;
  name: string;
  email: string;
};

function getUserSessionSecret(): string {
  const secret =
    process.env.USER_SESSION_SECRET?.trim() ||
    process.env.SEARCH_EVENT_SALT?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "dev-user-session-secret");
  if (!secret) {
    throw new Error("USER_SESSION_SECRET is not configured.");
  }
  return secret;
}

async function hmacUserId(userId: string): Promise<string> {
  const secret = getUserSessionSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(`${SESSION_SALT}|${userId}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createUserSessionToken(userId: string): Promise<string> {
  const mac = await hmacUserId(userId);
  return `${userId}.${mac}`;
}

export async function verifyUserSessionToken(token: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!userId || !mac || userId.length > 64) return null;
  try {
    const expected = await hmacUserId(userId);
    if (mac !== expected) return null;
    return userId;
  } catch {
    return null;
  }
}

export function userSessionCookieOptions(maxAge = SESSION_MAX_AGE_SEC) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function setUserSessionCookie(userId: string): Promise<void> {
  const token = await createUserSessionToken(userId);
  const jar = await cookies();
  jar.set(USER_SESSION_COOKIE, token, userSessionCookieOptions());
}

export async function clearUserSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(USER_SESSION_COOKIE, "", { ...userSessionCookieOptions(0), maxAge: 0 });
}

export async function getUserIdFromSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(USER_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyUserSessionToken(token);
}
