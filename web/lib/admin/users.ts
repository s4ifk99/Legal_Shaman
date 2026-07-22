import { accountsPrisma } from "@/lib/db/accounts";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  hasPassword: boolean;
  bookmarkCount: number;
};

export type AdminUsersPayload = {
  total: number;
  withPassword: number;
  last7Days: number;
  users: AdminUserRow[];
  fetchedAt: string;
};

export async function getAdminUsers(): Promise<AdminUsersPayload> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [users, total, withPassword, last7Days] = await Promise.all([
    accountsPrisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        updatedAt: true,
        passwordHash: true,
        _count: { select: { bookmarks: true } },
      },
    }),
    accountsPrisma.user.count(),
    accountsPrisma.user.count({ where: { passwordHash: { not: null } } }),
    accountsPrisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
  ]);

  return {
    total,
    withPassword,
    last7Days,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      hasPassword: u.passwordHash != null,
      bookmarkCount: u._count.bookmarks,
    })),
    fetchedAt: new Date().toISOString(),
  };
}
