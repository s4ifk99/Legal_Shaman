import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { LegalKnowledgeSearch } from "@/components/legal-search/legal-knowledge-search";

type PageProps = {
  searchParams: Promise<{ q?: string; location?: string }>;
};

export const metadata = {
  title: "Legal Search | Legal Shaman",
  description:
    "Exa-style semantic search over UK legal guidance — see how your query is understood, then get cited sources and directory signposting.",
};

export default async function LegalSearchPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const initialQuery = (sp.q || "").trim();
  const initialLocation = (sp.location || "").trim();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 md:py-12">
        <header className="mb-8 space-y-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-primary md:text-4xl">
            Legal Search
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Describe your problem in plain English. We break it into searchable criteria — legal
            issue, location, urgency, and help route — then retrieve cited UK guidance and
            directory signposting. Not legal advice.
          </p>
        </header>

        <LegalKnowledgeSearch initialQuery={initialQuery} initialLocation={initialLocation} />
      </main>
      <Footer />
    </div>
  );
}
