import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { RegisterSchema } from "@/lib/bookmarks/schemas";
import { setUserSessionCookie } from "@/lib/auth/user-session";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists. Sign in instead." },
      { status: 409 },
    );
  }

  const user = await prisma.user.create({
    data: { name: parsed.data.name, email },
    select: { id: true, name: true, email: true },
  });

  await setUserSessionCookie(user.id);
  return NextResponse.json({ user });
}
