import { NextResponse } from "next/server";
import {
  appendWaitlistEmailToGoogleSheet,
  isValidWaitlistEmail,
} from "@/lib/waitlist/google-sheet";

export async function POST(request: Request) {
  try {
    const { email } = (await request.json()) as { email?: string };

    if (!email?.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (!isValidWaitlistEmail(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const webhookUrl = process.env.WAITLIST_GOOGLE_APPS_SCRIPT_URL?.trim();

    if (webhookUrl) {
      await appendWaitlistEmailToGoogleSheet(email);
    } else if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Waitlist is not configured" },
        { status: 503 },
      );
    } else {
      console.log("=== WAITLIST SIGNUP (no Google Sheet configured) ===");
      console.log(`Email: ${email.trim().toLowerCase()}`);
      console.log("Set WAITLIST_GOOGLE_APPS_SCRIPT_URL in .env.local to save to a sheet.");
      console.log("====================================================");
    }

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
