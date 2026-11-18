import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { FinancingToolClient } from "@/components/v3/financing-tool-client";

export const metadata: Metadata = {
  title: "Financing access to justice",
  description:
    "Map free advice, legal aid, insurance, no win no fee, and specialist litigation funding for UK disputes. Signposting only — not legal advice.",
  alternates: { canonical: "/financing" },
};

type PageProps = {
  searchParams: Promise<{ kind?: string; story?: string; preference?: string }>;
};

export default async function FinancingPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:py-12">
        <header className="mb-8 space-y-2">
          <h1 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
            Financing access to justice
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            A separate map of how people pay for help — free advice first, then legal aid,
            insurance, no win no fee, and specialist funding for complex disputes. We do not sell
            funding and this is not legal advice.
          </p>
        </header>
        <FinancingToolClient
          initialKind={sp.kind || "general"}
          initialStory={sp.story || ""}
          initialPreference={sp.preference || ""}
        />
      </main>
      <Footer />
    </div>
  );
}
