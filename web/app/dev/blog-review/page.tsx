import Link from "next/link";
import { notFound } from "next/navigation";
import {
  draftMarkdownToHtml,
  latestLocalBatchDate,
  listLocalBatchDates,
  listLocalDrafts,
  readMatchSnapshot,
} from "@/lib/blog-drafts/local-queue";
import { BlogReviewClient } from "./blog-review-client";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ date?: string }>;
};

export default async function DevBlogReviewPage({ searchParams }: PageProps) {
  if (process.env.NODE_ENV === "production") notFound();

  const dates = listLocalBatchDates();
  const requested = (await searchParams).date?.trim();
  const date =
    requested && dates.includes(requested)
      ? requested
      : latestLocalBatchDate() ?? "";

  if (!date) {
    return (
      <div className="min-h-screen bg-background px-4 py-8 md:px-8">
        <div className="mx-auto max-w-3xl space-y-3">
          <h1 className="font-serif text-3xl font-bold">Who-helps draft review</h1>
          <p className="text-sm text-muted-foreground">
            No local batches under <code>data/blog-drafts/</code> yet. The nightly draft
            agent writes one folder per London date.
          </p>
        </div>
      </div>
    );
  }

  const drafts = listLocalDrafts(date).map((draft) => {
    const match = readMatchSnapshot(date, draft.file);
    return {
      file: draft.file,
      title: draft.title,
      demandRef: draft.demandRef,
      matter: draft.matter,
      why: draft.why,
      status: draft.status,
      html: draftMarkdownToHtml(draft.body),
      matchQa: (draft.matchQa || match?.qa || null) as "ok" | "weak" | "empty" | null,
      matchOk: draft.matchOk ?? match?.matchOk ?? null,
      matchDetail: match?.qaDetail ?? null,
      freeHelp: (match?.freeHelp || []).map((h) => ({
        title: h.title,
        type: h.type,
        url: h.url,
        score: h.score,
        blurb: h.blurb,
      })),
    };
  });

  return (
    <div className="min-h-screen bg-background px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Local only · /dev/blog-review
          </p>
          <h1 className="font-serif text-3xl font-bold">Who-helps draft review</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Approve or Kill each draft for the day. Publishing reads{" "}
            <code>decisions.json</code> and runs{" "}
            <code>npm run wiki:promote-local-approved -- --date {date}</code>. No Notion.
          </p>
          <div className="flex flex-wrap gap-2">
            {dates.map((batchDate) => (
              <Link
                key={batchDate}
                href={`/dev/blog-review?date=${batchDate}`}
                className={
                  batchDate === date
                    ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                    : "rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/40"
                }
              >
                {batchDate}
              </Link>
            ))}
          </div>
        </header>
        <BlogReviewClient date={date} initialDrafts={drafts} />
      </div>
    </div>
  );
}
