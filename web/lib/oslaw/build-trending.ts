import { LEGAL_ISSUE_TAXONOMY } from "@/lib/legal/legal-issue-taxonomy-data";
import { inferPracticeAreaSlugFromText } from "@/lib/legal/taxonomy";
import type { OslawPost, OslawTrendingTopic } from "@/lib/oslaw/types";
import { engagementScore } from "@/lib/reddit-search/listing";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function labelForArea(slug: string | null): string {
  if (!slug) return "General legal discussion";
  const entry = LEGAL_ISSUE_TAXONOMY.find((e) => e.slug === slug || e.matcherSlug === slug);
  return entry?.canonicalName ?? slug.replace(/_/g, " ");
}

/** Cluster scraped posts into trending legal topics by practice area. */
export function buildTrendingTopics(posts: OslawPost[], maxTopics = 12): OslawTrendingTopic[] {
  const groups = new Map<string, OslawPost[]>();

  for (const post of posts) {
    const areaSlug = inferPracticeAreaSlugFromText(post.title) ?? "general";
    const bucket = groups.get(areaSlug) ?? [];
    bucket.push(post);
    groups.set(areaSlug, bucket);
  }

  const topics: OslawTrendingTopic[] = [];

  for (const [areaSlug, groupPosts] of groups) {
    const sorted = [...groupPosts].sort((a, b) => engagementScore(b) - engagementScore(a));
    const label = labelForArea(areaSlug === "general" ? null : areaSlug);
    const slug = slugify(label);
    const engagement = sorted.reduce((sum, p) => sum + engagementScore(p), 0);
    const subreddits = [...new Set(sorted.map((p) => p.subreddit))];

    topics.push({
      slug,
      label,
      legalAreaSlug: areaSlug === "general" ? null : areaSlug,
      postCount: sorted.length,
      engagementScore: engagement,
      subreddits,
      posts: sorted.slice(0, 8),
    });
  }

  return topics
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, maxTopics);
}
