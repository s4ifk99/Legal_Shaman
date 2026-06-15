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
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: "1.25rem" }}>Admin sign-in</h1>
      <p style={{ color: "#444", fontSize: "0.95rem" }}>
        Enter the value of <code>ADMIN_SECRET</code> from the server environment. For scripts and{" "}
        <code>curl</code>, send the same value as header <code>x-admin-secret</code> (see{" "}
        <code>npm run admin:api -- --help</code>).
      </p>
      <form onSubmit={onSubmit} style={{ marginTop: "1.5rem" }}>
        <label style={{ display: "block", marginBottom: "0.35rem", fontWeight: 600 }}>Password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: "0.5rem 0.65rem", fontSize: "1rem", boxSizing: "border-box" }}
        />
        {error ? (
          <p style={{ color: "#b00020", marginTop: "0.75rem", fontSize: "0.9rem" }} role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            fontSize: "1rem",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<p style={{ padding: "2rem", fontFamily: "system-ui" }}>Loading…</p>}>
      <AdminLoginForm />
    </Suspense>
  );
}
