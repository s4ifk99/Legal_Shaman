import type { Metadata } from "next";
import signpostingResources from "@/data/signposting-resources.json";
import type { CategorySection } from "@/components/category-cards";
import { LandingShell } from "@/components/v3/landing-shell";
import { LatestGuides } from "@/components/wiki/latest-guides";

/** Explicit .com canonical so Google does not treat the homepage as a duplicate of .co.uk. */
export const metadata: Metadata = {
  alternates: {
    canonical: "https://www.legalshaman.com/",
    types: {
      "application/atom+xml": [{ url: "/feed.xml", title: "Legal Shaman: latest who helps guides" }],
    },
  },
  openGraph: { url: "https://www.legalshaman.com/" },
};

export default function Home() {
  // Marketing / What is landing on `/`. Ask the Shaman agent lives on /ask-the-shaman.
  const sections = signpostingResources.sections as CategorySection[];
  return <LandingShell sections={sections} latest={<LatestGuides variant="landing" />} />;
}
