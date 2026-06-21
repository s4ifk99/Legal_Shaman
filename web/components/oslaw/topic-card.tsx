import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { OslawTrendingTopic } from "@/lib/oslaw/types";

type OslawTopicCardProps = {
  topic: OslawTrendingTopic;
};

export function OslawTopicCard({ topic }: OslawTopicCardProps) {
  const preview = topic.posts[0];

  return (
    <Card className="border border-border/70 transition-all hover:border-primary/40">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-serif text-lg font-semibold text-foreground">{topic.label}</h3>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {topic.postCount} posts
          </span>
        </div>

        {preview ? (
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{preview.title}</p>
        ) : null}

        <p className="mt-2 text-xs text-muted-foreground">
          {topic.subreddits.map((s) => `r/${s}`).join(" · ")}
        </p>

        <Link
          href={`/oslaw/topic/${topic.slug}`}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          View topic
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
