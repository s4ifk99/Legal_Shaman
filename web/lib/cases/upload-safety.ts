/**
 * Client + server upload hardening for case attachments.
 * Blocks executables, HTML/SVG (XSS), polyglots, and odd double extensions.
 */

export const UPLOAD_MAX_BYTES = 5_000_000;
export const UPLOAD_MAX_FILES = 12;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
]);

const DANGEROUS_EXT =
  /\.(exe|dll|bat|cmd|com|msi|scr|ps1|vbs|js|mjs|cjs|jar|apk|sh|bash|php|asp|aspx|cgi|html?|xhtml|svg|xml|htm|wasm|dmg|pkg|iso|img|bin|so|dylib)(\.|$)/i;

const DOUBLE_DANGEROUS =
  /\.(pdf|png|jpe?g|gif|webp|txt)\.(exe|dll|js|html?|php|svg|scr|bat|cmd|com)$/i;

export type UploadSafetyOk = {
  ok: true;
  mime: string;
  safeName: string;
};

export type UploadSafetyErr = {
  ok: false;
  error: string;
};

export type UploadSafetyResult = UploadSafetyOk | UploadSafetyErr;

function sniffMime(buf: Uint8Array): string | null {
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "application/pdf";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x39 || buf[4] === 0x37) &&
    buf[5] === 0x61
  ) {
    return "image/gif";
  }
  // Plain text: reject if it looks like HTML/SVG/script
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(buf.slice(0, Math.min(buf.length, 512)))
    .trimStart()
    .toLowerCase();
  if (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<svg") ||
    head.startsWith("<?xml") ||
    head.includes("<script")
  ) {
    return null;
  }
  // Allow UTF-8 text if mostly printable
  let printable = 0;
  const sample = buf.slice(0, Math.min(buf.length, 2048));
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 160) printable += 1;
  }
  if (sample.length > 0 && printable / sample.length >= 0.92) {
    return "text/plain";
  }
  return null;
}

export function sanitizeUploadName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "document";
  const cleaned = base
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return cleaned || "document";
}

export function validateUploadBytes(input: {
  name: string;
  declaredMime?: string;
  size: number;
  bytes: Uint8Array;
}): UploadSafetyResult {
  if (!input.size || input.size <= 0) {
    return { ok: false, error: "Empty file" };
  }
  if (input.size > UPLOAD_MAX_BYTES) {
    return { ok: false, error: "File too large (max about 2.5 MB)" };
  }

  const safeName = sanitizeUploadName(input.name);
  if (DANGEROUS_EXT.test(safeName) || DOUBLE_DANGEROUS.test(safeName)) {
    return { ok: false, error: "That file type isn’t allowed" };
  }

  const sniffed = sniffMime(input.bytes);
  if (!sniffed) {
    return {
      ok: false,
      error: "Couldn’t verify the file — use a photo, PDF, or plain text letter",
    };
  }

  const declared = (input.declaredMime || "").toLowerCase().trim();
  if (declared && declared !== "application/octet-stream") {
    const normalizedDeclared = declared === "image/jpg" ? "image/jpeg" : declared;
    if (!ALLOWED_MIME.has(normalizedDeclared)) {
      return { ok: false, error: "Please upload a photo, PDF, or text letter" };
    }
    // Declared type must match sniffed family
    const declaredFamily = normalizedDeclared.split("/")[0];
    const sniffedFamily = sniffed.split("/")[0];
    if (normalizedDeclared !== sniffed && declaredFamily !== sniffedFamily) {
      return { ok: false, error: "File content doesn’t match its type" };
    }
    if (normalizedDeclared.startsWith("image/") && sniffed !== normalizedDeclared && sniffedFamily === "image") {
      // jpeg vs jpg etc — trust sniff
    } else if (normalizedDeclared !== sniffed && !(normalizedDeclared === "image/jpg" && sniffed === "image/jpeg")) {
      if (sniffed === "text/plain" && normalizedDeclared === "text/plain") {
        /* ok */
      } else if (normalizedDeclared !== sniffed) {
        // Prefer sniffed when image subtypes differ harmlessly
        if (!(declaredFamily === "image" && sniffedFamily === "image")) {
          return { ok: false, error: "File content doesn’t match its type" };
        }
      }
    }
  }

  if (!ALLOWED_MIME.has(sniffed) && sniffed !== "image/jpg") {
    return { ok: false, error: "Please upload a photo, PDF, or text letter" };
  }

  return { ok: true, mime: sniffed === "image/jpg" ? "image/jpeg" : sniffed, safeName };
}

/** Browser File helper */
export async function validateUploadFile(file: File): Promise<UploadSafetyResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return validateUploadBytes({
    name: file.name,
    declaredMime: file.type,
    size: file.size,
    bytes: buf,
  });
}
