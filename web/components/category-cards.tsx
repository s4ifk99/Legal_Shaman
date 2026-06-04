"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { SpiralDecoration } from "./spiral-decoration";

export type ResourceLink = { text: string; url: string };

export type Resource = {
  name: string;
  phone?: string;
  description: string;
  url?: string;
  links?: ResourceLink[];
};

export type CategorySection = {
  title: string;
  resources: Resource[];
};

const cardColors = [
  { bg: "bg-teal", border: "border-teal", text: "text-primary-foreground" },
  { bg: "bg-coral", border: "border-coral", text: "text-secondary-foreground" },
  { bg: "bg-teal", border: "border-teal", text: "text-primary-foreground" },
  { bg: "bg-coral", border: "border-coral", text: "text-secondary-foreground" },
  { bg: "bg-teal", border: "border-teal", text: "text-primary-foreground" },
  { bg: "bg-coral", border: "border-coral", text: "text-secondary-foreground" },
  { bg: "bg-teal", border: "border-teal", text: "text-primary-foreground" },
  { bg: "bg-coral", border: "border-coral", text: "text-secondary-foreground" },
  { bg: "bg-teal", border: "border-teal", text: "text-primary-foreground" },
  { bg: "bg-coral", border: "border-coral", text: "text-secondary-foreground" },
];

function PokerCard({
  section,
  index,
  onFlip,
}: {
  section: CategorySection;
  index: number;
  onFlip: (section: CategorySection) => void;
}) {
  const colorScheme = cardColors[index % cardColors.length];
  const resourceCount = section.resources.length;
  const rotation = (index % 5 - 2) * 3; // Slight rotation for poker table feel
  
  return (
    <button
      onClick={() => onFlip(section)}
      className={`group relative h-56 w-40 cursor-pointer transition-all duration-300 hover:scale-105 hover:z-10 md:h-64 md:w-48`}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      {/* Card container */}
      <div className={`relative h-full w-full rounded-xl border-4 ${colorScheme.border} bg-card shadow-xl transition-shadow group-hover:shadow-2xl overflow-hidden`}>
        {/* Card back pattern with spirals */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -left-8 -top-8 opacity-15">
            <SpiralDecoration size={120} color="var(--gold)" />
          </div>
          <div className="absolute -bottom-8 -right-8 opacity-15">
            <SpiralDecoration size={120} color="var(--gold)" />
          </div>
        </div>
        
        {/* Top left corner - resource count */}
        <div className="absolute left-2 top-2 text-center">
          <div className={`font-serif text-xl font-bold ${index % 2 === 0 ? 'text-primary' : 'text-secondary'}`}>
            {resourceCount}
          </div>
          <div className={`text-[10px] font-medium ${index % 2 === 0 ? 'text-primary/70' : 'text-secondary/70'}`}>
            links
          </div>
        </div>
        
        {/* Center content - title only */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-3 py-8">
          <h3 className="text-center font-serif text-base font-bold leading-snug text-foreground md:text-lg">
            {section.title}
          </h3>
        </div>
        
        {/* Bottom right corner (upside down) - resource count */}
        <div className="absolute bottom-2 right-2 rotate-180 text-center">
          <div className={`font-serif text-xl font-bold ${index % 2 === 0 ? 'text-primary' : 'text-secondary'}`}>
            {resourceCount}
          </div>
          <div className={`text-[10px] font-medium ${index % 2 === 0 ? 'text-primary/70' : 'text-secondary/70'}`}>
            links
          </div>
        </div>
      </div>
    </button>
  );
}

function ResourceModal({
  section,
  onClose,
}: {
  section: CategorySection;
  onClose: () => void;
}) {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="relative max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border-4 border-gold bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with spiral decoration */}
        <div className="relative overflow-hidden bg-primary p-6 text-primary-foreground">
          <div className="absolute -right-12 -top-12 opacity-20">
            <SpiralDecoration size={150} color="var(--gold)" />
          </div>
          <div className="absolute -bottom-8 -left-8 opacity-20">
            <SpiralDecoration size={100} color="var(--gold)" />
          </div>
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-2 transition-colors hover:bg-primary-foreground/20"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 className="relative font-serif text-2xl font-bold md:text-3xl">{section.title}</h2>
          <p className="relative mt-1 text-primary-foreground/80">{section.resources.length} resources available</p>
        </div>
        
        {/* Resources list */}
        <div className="max-h-[60vh] overflow-y-auto p-6">
          <div className="space-y-6">
            {section.resources.map((resource, idx) => (
              <div key={idx} className="border-b border-border pb-4 last:border-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground font-serif font-bold">
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
                          <a href={`tel:${resource.phone.replace(/\s/g, "")}`} className="text-secondary hover:underline">
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
                            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
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
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CategoryCards({ sections }: { sections: CategorySection[] }) {
  const [selectedSection, setSelectedSection] = useState<CategorySection | null>(null);

  return (
    <>
      {/* Poker table surface */}
      <div className="relative rounded-3xl bg-gradient-to-br from-primary/10 via-secondary/5 to-accent/10 p-8 md:p-12">
        {/* Decorative border to simulate table edge */}
        <div className="absolute inset-2 rounded-2xl border-2 border-gold/20" />
        
        {/* Cards grid with poker scatter effect */}
        <div className="relative flex flex-wrap items-center justify-center gap-4 md:gap-6">
          {sections.map((section, index) => (
            <PokerCard
              key={section.title}
              section={section}
              index={index}
              onFlip={setSelectedSection}
            />
          ))}
        </div>
      </div>

      {/* Modal for showing resources */}
      {selectedSection && (
        <ResourceModal
          section={selectedSection}
          onClose={() => setSelectedSection(null)}
        />
      )}
    </>
  );
}
