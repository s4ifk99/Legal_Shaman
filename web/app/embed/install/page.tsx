import Link from "next/link";
import type { Metadata } from "next";
import { SignpostInstallPanel } from "@/components/signpost/signpost-install-panel";

export const metadata: Metadata = {
  title: "Install Signpost Widget | Legal Shaman",
  description: "Copy-paste embed code for the Legal Shaman Signpost widget.",
};

export default function EmbedInstallPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/signpost" className="text-sm text-primary hover:underline">
        ← Back to Signpost
      </Link>

      <h1 className="mt-4 font-serif text-3xl font-bold text-foreground">Install Signpost widget</h1>
      <p className="mt-2 text-muted-foreground">
        Paste this iframe on your website to show Legal Shaman Signpost categories.
      </p>

      <div className="mt-8 rounded-2xl border border-gold/30 bg-card p-6">
        <SignpostInstallPanel />
      </div>
    </main>
  );
}
