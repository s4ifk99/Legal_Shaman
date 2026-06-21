import { ExternalLink, MessageCircle, TrendingUp } from "lucide-react";
import { formatRelativeTime } from "@/lib/oslaw/data";
import type { OslawPost } from "@/lib/oslaw/types";

type OslawPostListProps = {
  posts: OslawPost[];
  emptyMessage?: string;
};

export function OslawPostList({ posts, emptyMessage = "No posts available." }: OslawPostListProps) {
  if (!posts.length) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-3">
      {posts.map((post) => (
        <li
          key={post.id}
          className="rounded-xl border border-border/70 bg-card p-4 transition-colors hover:border-gold/40"
        >
          <a
            href={post.permalink || post.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-start gap-1.5 font-medium text-foreground hover:text-primary"
          >
            <span>{post.title}</span>
            <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </a>
          {post.snippet ? (
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{post.snippet}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" />
              {post.score} upvotes
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" />
              {post.numComments} comments
            </span>
            <span>r/{post.subreddit}</span>
            <span>{formatRelativeTime(post.createdUtc)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
