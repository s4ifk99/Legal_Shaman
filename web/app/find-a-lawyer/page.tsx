import type { Metadata } from "next";

import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { enableMapSearch, enableSearchDebug } from "@/lib/legal-search/config";
import { LawyerSearchClient } from "./lawyer-search-client";

export const metadata: Metadata = {
  title: "Find a Lawyer | Legal Shaman",
  description:
    "Describe your legal issue and get a shortlist of UK lawyers from our directory. Not legal advice.",
};

export default function FindALawyerPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <header className="mb-6 space-y-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-primary md:text-4xl">
            Find a Lawyer
          </h1>
          <p className="text-muted-foreground">
            Answer a few short questions about your issue, funding, and location.
            We&apos;ll signpost you to legal aid, free help, and private providers
            from our directory — not legal advice.
          </p>
        </header>
        <LawyerSearchClient
          mapEnabled={enableMapSearch()}
          debugEnabled={enableSearchDebug()}
        />
      </main>
      <Footer />
    </div>
  );
}
