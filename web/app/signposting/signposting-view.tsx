"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
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

function AccordionSection({ section, defaultOpen = false, index = 0 }: { section: Section; defaultOpen?: boolean; index?: number }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const isEven = index % 2 === 0;

  return (
    <div className="rounded-xl border-2 border-gold/30 bg-card overflow-hidden transition-shadow hover:shadow-lg">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex w-full items-center justify-between p-5 text-left transition-colors ${
          isOpen 
            ? isEven ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            : 'hover:bg-muted/50'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
            isOpen 
              ? 'bg-gold/30 text-current' 
              : isEven ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'
          }`}>
            <span className="font-serif text-lg font-bold">{section.title.charAt(0)}</span>
          </div>
          <h2 className={`text-lg font-bold ${isOpen ? '' : 'text-foreground'}`}>{section.title}</h2>
        </div>
        <div className={`flex items-center gap-2 ${isOpen ? '' : 'text-muted-foreground'}`}>
          <span className="text-sm">{section.resources.length} resources</span>
          <ChevronDown
            className={`h-5 w-5 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {isOpen && (
        <div className="p-5 pt-4 border-t border-gold/20">
          <div className="space-y-4">
            {section.resources.map((resource, idx) => (
              <div key={idx} className="flex gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent-foreground">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <p className="text-foreground">
                    {resource.url ? (
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-primary hover:underline"
                      >
                        {resource.name}
                      </a>
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
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline"
                          >
                            {link.text}
                          </a>
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
      If we are unable to assist you, here is a list of other organisations and resources that we hope you might
      find useful in your search for the right help.
    </p>
  );

  const mainInner = (
    <div className="space-y-4">
      {allSections.map((section, idx) => (
        <AccordionSection key={`${section.title}-${idx}`} section={section} defaultOpen={idx === 0} index={idx} />
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
            <span className="text-primary">Signposting</span>{" "}
            <span className="text-gold">Resources</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Helpful organisations, guides, and support services
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8">{intro}</div>

      <main className="mx-auto max-w-4xl px-4 pb-12">{mainInner}</main>

      <Footer />
    </div>
  );
}
