"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/admin/search-quality";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error || `HTTP ${res.status}`);
        return;
      }
      router.replace(next.startsWith("/") ? next : "/admin/search-quality");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="font-serif text-xl font-semibold text-foreground">Admin sign-in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the value of <code className="rounded bg-muted px-1 py-0.5 text-xs">ADMIN_SECRET</code>{" "}
          from the server environment. For scripts and{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">curl</code>, send the same value as
          header <code className="rounded bg-muted px-1 py-0.5 text-xs">x-admin-secret</code> (see{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run admin:api -- --help</code>).
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <label htmlFor="admin-password" className="block text-sm font-medium text-foreground">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm font-medium disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Loading…</p>}>
      <AdminLoginForm />
    </Suspense>
  );
}
