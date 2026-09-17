export const SHARE_NOTES_PREFIX = "/share/notes/";

export function shareNotesPath(token: string): string {
  return `${SHARE_NOTES_PREFIX}${token}`;
}

export function shareNotesUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}${shareNotesPath(token)}`;
}

export function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const proto =
    req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "http";
  const hostname = host.split(":")[0];
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (env && !local) return env;
  return `${proto}://${host}`.replace(/\/$/, "");
}

export function tokenFromShareUrl(url: string): string {
  try {
    const path = new URL(url, "http://localhost").pathname.replace(/\/+$/, "");
    const notes = path.match(/\/share\/notes\/([^/]+)$/);
    if (notes?.[1] && notes[1] !== "notes") return decodeURIComponent(notes[1]);
    const api = path.match(/\/api\/coherence\/share\/([^/]+)$/);
    if (api?.[1]) return decodeURIComponent(api[1]);
    return "";
  } catch {
    return "";
  }
}
