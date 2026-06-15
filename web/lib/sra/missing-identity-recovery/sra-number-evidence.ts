/** Extract SRA organisation numbers from evidence text or page snippets. */
export function extractSraNumbersFromText(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bSRA\s*(?:No\.?|Number|ID|ref)\s*:?\s*(\d{3,8})\b/gi,
    /\bRegulator\s+ID\s*:?\s*(\d{3,8})\b/gi,
    /\bSRA\s*:\s*(\d{3,8})\b/gi,
    /\bSRA\s+(?:number|no\.?)\s+(\d{3,8})\b/gi,
    /\bSRA\s+(\d{3,8})\b/gi,
    /\b(?:authorised|regulated)\b[^.]{0,140}\b(?:under\s+)?SRA\s+(?:number|no\.?)\s+(\d{3,8})\b/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const id = match[1]?.trim();
      if (id) found.add(id);
    }
  }

  return [...found];
}

export function evidenceBlob(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function evidenceHasExactSraNumber(
  targetSraId: string,
  ...texts: (string | undefined)[]
): boolean {
  const target = targetSraId.trim();
  if (!target) return false;
  return extractSraNumbersFromText(evidenceBlob(...texts)).includes(target);
}

export function evidenceHasConflictingSraNumber(
  targetSraId: string,
  ...texts: (string | undefined)[]
): boolean {
  const target = targetSraId.trim();
  if (!target) return false;
  const extracted = extractSraNumbersFromText(evidenceBlob(...texts));
  if (extracted.length === 0) return false;
  return extracted.some((id) => id !== target);
}
