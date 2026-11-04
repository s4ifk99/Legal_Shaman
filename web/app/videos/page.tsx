import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { youtubeUrl } from "@/lib/site/social-links";

export const metadata: Metadata = {
  title: "Videos | Legal Shaman",
  description: "Old Bailey stories and Who helps guides — tagged routes into Legal Shaman.",
};

/** Tagged CTA landings for Exp 3 video formats. */
export default function VideosCtaPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <h1 className="font-serif text-3xl font-bold text-foreground">Videos</h1>
        <p className="mt-3 text-muted-foreground">
          Two formats in November: historic Old Bailey retellings, and “Who helps” explainers from
          our guides. Use the tagged links below in video descriptions.
        </p>
        <ul className="mt-8 space-y-4">
          <li className="rounded-xl border border-border p-4">
            <h2 className="font-semibold">Old Bailey story</h2>
            <p className="mt-1 text-sm text-muted-foreground">Interest / storytelling entry.</p>
            <Link
              className="mt-2 inline-block text-primary underline"
              href="/?utm_source=youtube&utm_medium=video&utm_content=oldbailey&utm_campaign=nov2026"
            >
              Open Legal Shaman (oldbailey tag)
            </Link>
          </li>
          <li className="rounded-xl border border-border p-4">
            <h2 className="font-semibold">Who helps</h2>
            <p className="mt-1 text-sm text-muted-foreground">Immediate need → problem landing.</p>
            <Link
              className="mt-2 inline-block text-primary underline"
              href="/problems/housing?utm_source=youtube&utm_medium=video&utm_content=whohelps&utm_campaign=nov2026"
            >
              Housing help (whohelps tag)
            </Link>
          </li>
        </ul>
        <p className="mt-8 text-sm">
          Channel:{" "}
          <a href={youtubeUrl} className="text-primary underline" rel="noreferrer">
            YouTube
          </a>
        </p>
      </main>
      <Footer />
    </div>
  );
}
