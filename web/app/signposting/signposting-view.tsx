"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ResourceAnchor } from "@/components/signpost/resource-link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { SpiralDecoration } from "@/components/spiral-decoration";

export type ResourceLink = { text: string; url: string };

export type Resource = {
  name: string;
  phone?: string;
  description: string;
  url?: string;
  links?: ResourceLink[];
};

export type Section = {
  title: string;
  resources: Resource[];
};

type Props = {
  sections: Section[];
  /** When empty, no Advocate block is shown. */
  advocateResources?: Resource[];
  /** Full page with header/footer vs inline on home */
  variant?: "page" | "embedded";
};

function AccordionSection({ section, defaultOpen = false }: { section: Section; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-teal/40">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between py-5 text-left transition-colors"
      >
        <h2 className="font-serif text-xl font-semibold text-foreground md:text-2xl">{section.title}</h2>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-foreground/70 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div className="pb-5">
          <div className="space-y-4">
            {section.resources.map((resource, idx) => (
              <div key={idx} className="flex gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent-foreground">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <p className="text-foreground">
                    {resource.url ? (
                      <ResourceAnchor
                        href={resource.url}
                        className="font-semibold text-primary hover:underline"
                      >
                        {resource.name}
                      </ResourceAnchor>
                    ) : (
                      <span className="font-semibold">{resource.name}</span>
                    )}
                    {resource.phone && (
                      <span className="text-foreground">
                        {" "}&ndash;{" "}
                        <a href={`tel:${resource.phone.replace(/\s/g, "")}`} className="text-secondary hover:underline font-medium">
                          {resource.phone}
                        </a>
                      </span>
                    )}
                  </p>
                  {resource.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{resource.description}</p>
                  )}
                  {resource.links && resource.links.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {resource.links.map((link, linkIdx) => (
                        <li key={linkIdx} className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                          <ResourceAnchor
                            href={link.url}
                            className="text-sm text-primary hover:underline"
                          >
                            {link.text}
                          </ResourceAnchor>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SignpostingView({
  sections,
  advocateResources = [],
  variant = "page",
}: Props) {
  const allSections: Section[] =
    advocateResources.length > 0
      ? [...sections, { title: "Advocate directory", resources: advocateResources }]
      : sections;

  const intro = (
    <p className="text-lg text-muted-foreground">
      Browse by the kind of problem you have — for families, households, and people running a small business.
      Each area links to our wiki and trusted national organisations.
    </p>
  );

  const mainInner = (
    <div className="border-t border-teal/40">
      {allSections.map((section, idx) => (
        <AccordionSection key={`${section.title}-${idx}`} section={section} />
      ))}
    </div>
  );

  if (variant === "embedded") {
    return (
      <section id="signposting" className="relative overflow-hidden border-t-2 border-gold/30 bg-gradient-to-b from-background to-muted/20 py-12">
        <div className="absolute -left-24 top-20 opacity-10">
          <SpiralDecoration size={200} color="var(--teal)" />
        </div>
        <div className="absolute -right-20 bottom-10 opacity-10">
          <SpiralDecoration size={180} color="var(--coral)" />
        </div>
        
        <div className="relative mx-auto max-w-4xl px-4">
          <h2 className="font-serif text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Signposting <span className="text-gold">Resources</span>
          </h2>
          <div className="mt-4">{intro}</div>
          <div className="mt-8">{mainInner}</div>
        </div>
      </section>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-secondary/10 py-12">
        <div className="absolute -right-20 -top-20 opacity-15">
          <SpiralDecoration size={250} color="var(--teal)" />
        </div>
        <div className="absolute -left-16 bottom-0 opacity-15">
          <SpiralDecoration size={200} color="var(--coral)" />
        </div>
        
        <div className="relative mx-auto max-w-4xl px-4">
          <h1 className="font-serif text-4xl font-bold text-foreground md:text-5xl">
            <span className="text-primary">Signpost</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Wiki guides and national organisations — organised by area of law
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8">{intro}</div>

      <main className="mx-auto max-w-4xl px-4 pb-12">{mainInner}</main>

      <Footer />
    </div>
  );
}
