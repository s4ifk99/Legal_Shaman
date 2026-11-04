"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildProviderEnquiryEmail } from "@/lib/provider-enquiry/email-template";

type Enquiry = {
  id: string;
  firmName: string;
  firmEmail: string | null;
  areaOfLaw: string;
  status: string;
  costSummary: string | null;
  capacitySummary: string | null;
  eligibilityNote: string | null;
  notes: string | null;
  respondedAt: string | null;
  createdAt: string;
};

function adminHeaders(): HeadersInit {
  const secret =
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("adminSecret") ||
        window.localStorage.getItem("adminSecret") ||
        ""
      : "";
  return secret ? { "x-admin-secret": secret, "content-type": "application/json" } : { "content-type": "application/json" };
}

export default function ProviderEnquiriesClient() {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [error, setError] = useState("");
  const [firmName, setFirmName] = useState("");
  const [firmEmail, setFirmEmail] = useState("");
  const [areaOfLaw, setAreaOfLaw] = useState("housing");
  const [preview, setPreview] = useState(buildProviderEnquiryEmail({ firmName: "Example Firm", areaOfLaw: "housing" }));

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/admin/provider-enquiries", { headers: adminHeaders() });
    if (!res.ok) {
      setError(`Load failed (${res.status}). Ensure admin secret is set.`);
      return;
    }
    const data = (await res.json()) as { enquiries: Enquiry[] };
    setEnquiries(data.enquiries);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPreview(
      buildProviderEnquiryEmail({
        firmName: firmName || "Example Firm",
        areaOfLaw: areaOfLaw || "general",
      }),
    );
  }, [firmName, areaOfLaw]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Provider fee &amp; capacity enquiries</h1>
          <p className="text-sm text-muted-foreground">
            Exp 7 discovery — LegalShaman identity only; no user PII. Log outbound enquiries and attributable replies.
          </p>
        </div>
        <Link href="/admin/ops" className="text-sm text-primary hover:underline">
          Operations
        </Link>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="font-medium">Log a sent enquiry</h2>
        <div className="grid gap-2 md:grid-cols-3">
          <input
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Firm name"
            value={firmName}
            onChange={(e) => setFirmName(e.target.value)}
          />
          <input
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Firm email (optional)"
            value={firmEmail}
            onChange={(e) => setFirmEmail(e.target.value)}
          />
          <input
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Area of law"
            value={areaOfLaw}
            onChange={(e) => setAreaOfLaw(e.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void fetch("/api/admin/provider-enquiries", {
              method: "POST",
              headers: adminHeaders(),
              body: JSON.stringify({
                firmName,
                firmEmail: firmEmail || null,
                areaOfLaw,
              }),
            }).then((res) => {
              if (!res.ok) setError("Create failed");
              else {
                setFirmName("");
                setFirmEmail("");
                void load();
              }
            });
          }}
        >
          Save enquiry log
        </Button>
        <div className="rounded-md bg-muted/40 p-3 text-xs whitespace-pre-wrap">
          <p className="font-medium">Email template preview</p>
          <p className="mt-1 font-medium">{preview.subject}</p>
          <p className="mt-2">{preview.body}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Recent enquiries ({enquiries.length})</h2>
        {enquiries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No enquiries logged yet. Target sample ~10–20 firms.</p>
        ) : (
          <ul className="space-y-3">
            {enquiries.map((e) => (
              <li key={e.id} className="rounded-xl border border-border p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-semibold">{e.firmName}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.areaOfLaw} · {e.status} · {new Date(e.createdAt).toLocaleDateString("en-GB")}
                      {e.firmEmail ? ` · ${e.firmEmail}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["responded", "no_reply", "declined"] as const).map((status) => (
                      <Button
                        key={status}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void fetch("/api/admin/provider-enquiries", {
                            method: "PATCH",
                            headers: adminHeaders(),
                            body: JSON.stringify({ id: e.id, status }),
                          }).then(() => void load());
                        }}
                      >
                        Mark {status.replace(/_/g, " ")}
                      </Button>
                    ))}
                  </div>
                </div>
                {e.status === "responded" || e.costSummary || e.capacitySummary ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <input
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      defaultValue={e.costSummary || ""}
                      placeholder="Cost summary (Unknown if blank)"
                      onBlur={(ev) => {
                        void fetch("/api/admin/provider-enquiries", {
                          method: "PATCH",
                          headers: adminHeaders(),
                          body: JSON.stringify({
                            id: e.id,
                            costSummary: ev.target.value || null,
                            status: "responded",
                          }),
                        }).then(() => void load());
                      }}
                    />
                    <input
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      defaultValue={e.capacitySummary || ""}
                      placeholder="Capacity summary"
                      onBlur={(ev) => {
                        void fetch("/api/admin/provider-enquiries", {
                          method: "PATCH",
                          headers: adminHeaders(),
                          body: JSON.stringify({
                            id: e.id,
                            capacitySummary: ev.target.value || null,
                            status: "responded",
                          }),
                        }).then(() => void load());
                      }}
                    />
                    <input
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                      defaultValue={e.eligibilityNote || ""}
                      placeholder="Eligibility note"
                      onBlur={(ev) => {
                        void fetch("/api/admin/provider-enquiries", {
                          method: "PATCH",
                          headers: adminHeaders(),
                          body: JSON.stringify({
                            id: e.id,
                            eligibilityNote: ev.target.value || null,
                            status: "responded",
                          }),
                        }).then(() => void load());
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
