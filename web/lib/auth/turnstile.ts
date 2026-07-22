import "server-only";

type TurnstileVerifyResponse = {
  success: boolean;
  "error-codes"?: string[];
};

function turnstileConfigured(): boolean {
  return Boolean(
    process.env.TURNSTILE_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim(),
  );
}

async function callTurnstileSiteverify(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<TurnstileVerifyResponse> {
  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return (await res.json()) as TurnstileVerifyResponse;
}

function turnstileUserError(codes: string[] | undefined): string {
  if (codes?.includes("timeout-or-duplicate")) {
    return "CAPTCHA expired or already used. Complete it again and sign in promptly.";
  }
  if (codes?.includes("hostname-mismatch")) {
    return "CAPTCHA domain mismatch. Try again on www.legalshaman.com.";
  }
  return "CAPTCHA verification failed. Try again.";
}

/** Verify Cloudflare Turnstile token server-side. */
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string,
): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "CAPTCHA is not configured" };
    }
    console.warn("[turnstile] TURNSTILE_SECRET_KEY unset — skipping verification in development");
    return { ok: true };
  }

  if (!token?.trim()) {
    return { ok: false, error: "Complete the CAPTCHA verification" };
  }

  const trimmed = token.trim();

  try {
    // Prefer verification without remoteip — Vercel/proxy IPs often mismatch Turnstile's
    // client IP and cause false failures even when the widget shows Success.
    let data = await callTurnstileSiteverify(secret, trimmed);
    if (!data.success && remoteIp) {
      data = await callTurnstileSiteverify(secret, trimmed, remoteIp);
    }
    if (!data.success) {
      console.warn("[turnstile] siteverify rejected:", data["error-codes"] ?? []);
      return { ok: false, error: turnstileUserError(data["error-codes"]) };
    }
    return { ok: true };
  } catch (err) {
    console.error("[turnstile] verify failed:", err);
    return { ok: false, error: "CAPTCHA verification unavailable" };
  }
}

export function isTurnstileConfigured(): boolean {
  return turnstileConfigured();
}

export function clientIpFromRequest(req: Request): string | undefined {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return req.headers.get("x-real-ip") ?? undefined;
}
