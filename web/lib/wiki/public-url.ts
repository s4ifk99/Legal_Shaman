/** Wiki page id from a markdown relative path (no .md suffix). */
export function wikiPageSlugFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "");
}

/** In-app path for a wiki article (matches sitemap and wiki/[slug] route). */
export function wikiPagePublicPath(slug: string): string {
  return `/ask-the-shaman/wiki/${encodeURIComponent(slug)}`;
}

export function wikiPagePublicUrl(
  slug: string,
  base = "https://legalshaman.com",
): string {
  return `${base.replace(/\/$/, "")}${wikiPagePublicPath(slug)}`;
}

/**
 * Rewrite legacy stored wiki URLs (`/wiki/...` or `legalshaman.com/wiki/...`)
 * to the current Ask the Shaman wiki route.
 */
export function normalizeLegalSourceUrl(url: string | null | undefined): string {
  if (!url?.trim()) return "";
  const trimmed = url.trim();

  const legacyAbsolute = trimmed.match(
    /^https?:\/\/(?:www\.)?legalshaman\.com\/wiki\/(.+)$/i,
  );
  if (legacyAbsolute) {
    return wikiPagePublicPath(decodeURIComponent(legacyAbsolute[1]!));
  }

  const legacyRelative = trimmed.match(/^\/wiki\/(.+)$/i);
  if (legacyRelative) {
    return wikiPagePublicPath(decodeURIComponent(legacyRelative[1]!));
  }

  return trimmed;
}
