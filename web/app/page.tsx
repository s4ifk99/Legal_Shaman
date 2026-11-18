import type { Metadata } from "next";
import signpostingResources from "@/data/signposting-resources.json";
import type { CategorySection } from "@/components/category-cards";
import { isV3LandingEnabled, isV3SimpleShellEnabled } from "@/lib/v3/feature";
import { AskTheShamanV3 } from "@/components/v3/ask-the-shaman-v3";
import { LandingShell } from "@/components/v3/landing-shell";

/** Explicit .com canonical so Google does not treat the homepage as a duplicate of .co.uk. */
export const metadata: Metadata = {
  alternates: { canonical: "https://www.legalshaman.com/" },
  openGraph: { url: "https://www.legalshaman.com/" },
};

export default function Home() {
  // Production (no V3_LANDING): Ask the Shaman agent is the homepage — previous live shape.
  if (isV3SimpleShellEnabled() && !isV3LandingEnabled()) {
    return <AskTheShamanV3 />;
  }

  const sections = signpostingResources.sections as CategorySection[];

  // Local landing: Rothko + Ask the Shaman CTA (no header / old search bar).
  if (isV3LandingEnabled()) {
    return <LandingShell sections={sections} />;
  }

  // Classic fallback if V3 is off entirely — keep a simple CTA home without the old search strip.
  return <LandingShell sections={sections} />;
}
