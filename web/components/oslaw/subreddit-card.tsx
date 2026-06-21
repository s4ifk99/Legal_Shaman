import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { OslawSubredditSnapshot } from "@/lib/oslaw/types";

type OslawSubredditCardProps = {
  subreddit: OslawSubredditSnapshot;
};

export function OslawSubredditCard({ subreddit }: OslawSubredditCardProps) {
  const topPost = subreddit.posts[0];

  return (
    <Card className="border-2 border-gold/20 transition-all hover:border-gold/50 hover:shadow-md">
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-semibold text-foreground">{subreddit.displayName}</h2>
            {subreddit.subscribers ? (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {subreddit.subscribers.toLocaleString("en-GB")} members
              </p>
            ) : null}
          </div>
          <span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-medium text-gold">
            {subreddit.posts.length} posts
          </span>
        </div>

        <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground line-clamp-3">
          {subreddit.description}
        </p>

        {topPost ? (
          <p className="mt-3 text-sm text-foreground">
            <span className="font-medium text-muted-foreground">Top post: </span>
            {topPost.title}
          </p>
        ) : null}

        <Link
          href={`/oslaw/${subreddit.name}`}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          Browse discussions
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
