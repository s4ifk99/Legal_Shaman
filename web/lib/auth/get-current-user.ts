import { prisma } from "@/lib/db/prisma";
import { getUserIdFromSessionCookie, type PublicUser } from "@/lib/auth/user-session";

export async function getCurrentUser(): Promise<PublicUser | null> {
  const userId = await getUserIdFromSessionCookie();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  return user;
}

export async function requireCurrentUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Response(JSON.stringify({ error: "Sign in required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return user;
}
