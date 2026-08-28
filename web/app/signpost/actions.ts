"use server";

import { prisma } from "@/lib/db/prisma";

export type WaitlistState = {
  status: "idle" | "success" | "error";
  message: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function joinSignpostWaitlist(
  _prevState: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const firmName = String(formData.get("firmName") ?? "").trim();
  const practiceArea = String(formData.get("practiceArea") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!name) {
    return { status: "error", message: "Please enter your name." };
  }
  if (!EMAIL_RE.test(email)) {
    return { status: "error", message: "Please enter a valid email address." };
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO signpost_waitlist (name, email, firm_name, practice_area, website, message)
      VALUES (
        ${name},
        ${email},
        ${firmName || null},
        ${practiceArea || null},
        ${website || null},
        ${message || null}
      )
      ON CONFLICT (lower(email)) DO UPDATE SET
        name = EXCLUDED.name,
        firm_name = EXCLUDED.firm_name,
        practice_area = EXCLUDED.practice_area,
        website = EXCLUDED.website,
        message = EXCLUDED.message
    `;

    return {
      status: "success",
      message:
        "You're on the list! We'll be in touch as soon as Signpost is ready.",
    };
  } catch (error) {
    console.log("[v0] signpost waitlist error:", error instanceof Error ? error.message : error);
    return {
      status: "error",
      message: "Something went wrong. Please try again in a moment.",
    };
  }
}
