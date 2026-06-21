import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Legal Shaman Signpost Embed",
  robots: { index: true, follow: true },
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
