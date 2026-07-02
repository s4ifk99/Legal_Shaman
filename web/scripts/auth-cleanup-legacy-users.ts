import "./load-dotenv";

import { prisma } from "@/lib/db/prisma";

type LegacyUserRow = {
  id: string;
  email: string;
  name: string;
  _count: { bookmarks: number };
};

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run") || !apply;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

  const users = await prisma.user.findMany({
    where: { passwordHash: null },
    select: {
      id: true,
      email: true,
      name: true,
      _count: { select: { bookmarks: true } },
    },
    take: Number.isFinite(limit) && limit && limit > 0 ? limit : undefined,
    orderBy: { createdAt: "asc" },
  });

  const summary = {
    mode: dryRun ? "dry-run" : "apply",
    usersMatched: users.length,
    bookmarksImpacted: users.reduce((acc, u) => acc + u._count.bookmarks, 0),
    sample: users.slice(0, 10).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      bookmarks: u._count.bookmarks,
    })),
  };

  if (dryRun) {
    console.info(JSON.stringify(summary, null, 2));
    console.info(
      'No changes made. Re-run with "--apply" to permanently delete these legacy users.',
    );
    return;
  }

  const legacyIds = users.map((u) => u.id);
  if (legacyIds.length === 0) {
    console.info(JSON.stringify(summary, null, 2));
    return;
  }

  const deleted = await prisma.user.deleteMany({
    where: { id: { in: legacyIds }, passwordHash: null },
  });

  console.info(
    JSON.stringify(
      {
        ...summary,
        deletedUsers: deleted.count,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
