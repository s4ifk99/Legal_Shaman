import { NextResponse } from "next/server";
import {
  isValidWaitlistEmail,
  normalizeWaitlistEmail,
} from "@/lib/waitlist/validation";

export async function POST(request: Request) {
  try {
    const { email } = (await request.json()) as { email?: string };

    if (!email?.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (!isValidWaitlistEmail(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const normalized = normalizeWaitlistEmail(email);
    console.log(
      JSON.stringify({
        event: "waitlist_signup",
        email: normalized,
        at: new Date().toISOString(),
      }),
    );

    return NextResponse.json({
      success: true,
      message: "You're on the waitlist. We'll be in touch when we launch.",
    });
  } catch (error) {
    console.error("Waitlist signup failed:", error);
    return NextResponse.json(
      { error: "Failed to join waitlist. Please try again." },
      { status: 500 },
    );
  }
}
