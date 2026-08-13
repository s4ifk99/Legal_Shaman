import { accountsPrisma } from "@/lib/db/accounts";
import { skipEmailVerificationInDev } from "@/lib/auth/coherence-auth-config";
import { getUserIdFromSessionCookie, type PublicUser } from "@/lib/auth/user-session";

export type { PublicUser, AuthenticatedUser } from "@/lib/auth/user-session";

export async function getCurrentUser(): Promise<PublicUser | null> {
  const userId = await getUserIdFromSessionCookie();
  if (!userId) return null;

  try {
    const user = await accountsPrisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, emailVerifiedAt: true },
    });
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: skipEmailVerificationInDev() || Boolean(user.emailVerifiedAt),
    };
  } catch (err) {
    console.error("[auth] getCurrentUser failed:", err);
    return null;
  }
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
