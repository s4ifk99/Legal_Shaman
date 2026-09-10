import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ShareNotesView } from "@/components/coherence/ShareNotesView";
import { getShareByToken } from "@/lib/coherence/share/service";

export const metadata: Metadata = {
  title: "Notes for your Lawyer",
  description:
    "Legal Shaman client chronology for instruction. Not a court chronology or legal advice.",
  robots: { index: false, follow: false, nocache: true },
};

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function ShareNotesPage({ params }: PageProps) {
  const { token } = await params;
  const share = await getShareByToken(decodeURIComponent(token));
  if (!share) notFound();

  return (
    <ShareNotesView
      brief={share.brief}
      publishedAt={share.publishedAt}
      expiresAt={share.expiresAt}
    />
  );
}
