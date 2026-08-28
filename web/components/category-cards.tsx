"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

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

function AccordionRow({ section }: { section: CategorySection }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-teal/40">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between py-5 text-left"
      >
        <h3 className="font-serif text-xl font-semibold text-foreground md:text-2xl">
          {section.title}
        </h3>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-foreground/70 transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="pb-6">
          <div className="space-y-5">
            {section.resources.map((resource, idx) => (
              <div key={idx} className="flex items-start gap-3">
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
                        <a
                          href={`tel:${resource.phone.replace(/\s/g, "")}`}
                          className="text-secondary hover:underline"
                        >
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CategoryCards({ sections }: { sections: CategorySection[] }) {
  return (
    <div className="border-t border-teal/40">
      {sections.map((section) => (
        <AccordionRow key={section.title} section={section} />
      ))}
    </div>
  );
}
