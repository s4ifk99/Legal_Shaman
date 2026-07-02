"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminUsersPayload } from "@/lib/admin/users";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function UsersAdminClient() {
  const [data, setData] = useState<AdminUsersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const json = (await res.json()) as AdminUsersPayload & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">User signups</h1>
          <p className="text-sm text-muted-foreground">
            Accounts created via search signup and bookmark login. Passwords are stored as hashes only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/ops">Operations</Link>
          </Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted-foreground">Loading users…</p>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Total accounts</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{data.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Last 7 days</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{data.last7Days}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">With password</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{data.withPassword}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">All users</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.users.length === 0 ? (
                <p className="text-sm text-muted-foreground">No signups yet.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 pr-3">Signed up</th>
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Email</th>
                      <th className="py-2 pr-3">Password</th>
                      <th className="py-2 pr-3">Bookmarks</th>
                      <th className="py-2">User ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.id} className="border-b border-border/60">
                        <td className="py-2 pr-3 whitespace-nowrap text-xs">{formatWhen(u.createdAt)}</td>
                        <td className="py-2 pr-3">{u.name}</td>
                        <td className="py-2 pr-3">{u.email}</td>
                        <td className="py-2 pr-3">
                          {u.hasPassword ? (
                            <Badge variant="default">Set</Badge>
                          ) : (
                            <Badge variant="secondary">Missing</Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3">{u.bookmarkCount}</td>
                        <td className="py-2 font-mono text-xs text-muted-foreground">{u.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Last refreshed {formatWhen(data.fetchedAt)}.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </main>
  );
}
