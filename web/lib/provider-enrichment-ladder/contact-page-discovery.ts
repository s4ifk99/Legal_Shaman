const CONTACT_PATH_HINTS = [
  "/contact",
  "/contact-us",
  "/get-in-touch",
  "/enquiries",
  "/find-us",
  "/locations",
  "/offices",
];

const CONTACT_LINK_RE =
  /<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?(contact|get in touch|find us|enquiries)/gi;

export function discoverContactPageUrls(baseUrl: string, html: string): string[] {
  const out: string[] = [];
  let base: URL;
  try {
    base = new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`);
  } catch {
    return out;
  }

  for (const path of CONTACT_PATH_HINTS) {
    try {
      out.push(new URL(path, base.origin).href);
    } catch {
      /* skip */
    }
  }

  let m: RegExpExecArray | null;
  while ((m = CONTACT_LINK_RE.exec(html))) {
    try {
      const href = m[1].replace(/&amp;/g, "&");
      const abs = new URL(href, base.origin).href;
      if (abs.startsWith(base.origin)) out.push(abs);
    } catch {
      /* skip */
    }
  }

  return [...new Set(out)].slice(0, 8);
}

export function pickBestContactPage(urls: string[]): string | null {
  if (!urls.length) return null;
  const scored = urls.map((u) => {
    const lower = u.toLowerCase();
    let score = 0;
    if (lower.includes("contact")) score += 3;
    if (lower.includes("enquir")) score += 2;
    if (lower.includes("location") || lower.includes("office")) score += 1;
    return { u, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.u ?? null;
}
