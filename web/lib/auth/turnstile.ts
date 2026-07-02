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

  const body = new URLSearchParams({
    secret,
    response: token.trim(),
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as TurnstileVerifyResponse;
    if (!data.success) {
      return { ok: false, error: "CAPTCHA verification failed. Try again." };
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
