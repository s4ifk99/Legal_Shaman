import { NextResponse } from "next/server";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Map known infrastructure failures to user-safe auth API responses. */
export function authInfrastructureError(err: unknown): NextResponse | null {
  const msg = errorMessage(err);
  const lower = msg.toLowerCase();

  if (lower.includes("data transfer quota") || lower.includes("exceeded the data transfer")) {
    return NextResponse.json(
      {
        error:
          "Sign-in is temporarily unavailable — our database has hit its usage limit. Please try again in a few hours or contact support@legalshaman.com.",
      },
      { status: 503 },
    );
  }

  if (lower.includes("user_session_secret is not configured")) {
    return NextResponse.json(
      { error: "Sign-in is not configured on the server. Contact support." },
      { status: 503 },
    );
  }

  if (
    lower.includes("connection") ||
    lower.includes("timeout") ||
    lower.includes("econnrefused") ||
    lower.includes("can't reach database")
  ) {
    return NextResponse.json(
      { error: "Database connection failed. Try again in a moment." },
      { status: 503 },
    );
  }

  return null;
}

export function authUnexpectedError(err: unknown): NextResponse {
  console.error("[auth] unexpected error:", err);
  return NextResponse.json(
    { error: "Something went wrong. Try again." },
    { status: 500 },
  );
}
