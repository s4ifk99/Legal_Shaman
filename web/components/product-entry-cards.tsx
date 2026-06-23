import Link from "next/link";
import { BookOpen, Scale, Search, Sparkles } from "lucide-react";
import { EmergencyCallbackCard } from "@/components/emergency-callback-card";
import { cn } from "@/lib/utils";

const entries = [
  {
    href: "/find-a-lawyer",
    title: "Find a Lawyer",
    description: "Guided search over solicitors, legal aid, and free help — matched to your issue and location.",
    icon: Scale,
    accent: "border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10",
    iconClass: "text-primary",
  },
  {
    href: "/search",
    title: "Search Directory",
    description: "Browse curated listings, legal aid providers, and SRA-registered firms across the UK.",
    icon: Search,
    accent: "border-gold/40 bg-gold/5 hover:border-gold/70 hover:bg-gold/10",
    iconClass: "text-gold",
  },
  {
    href: "/ask-the-shaman",
    title: "Ask the Shaman",
    description: "Search thousands of wiki pages on housing, employment, family, debt, and more.",
    icon: BookOpen,
    accent: "border-secondary/40 bg-secondary/5 hover:border-secondary/70 hover:bg-secondary/10",
    iconClass: "text-secondary",
  },
  {
    href: "/oslaw",
    title: "OSLAW",
    description: "See what the internet is saying — trending UK legal discussions from Reddit.",
    icon: Sparkles,
    accent: "border-accent/40 bg-accent/5 hover:border-accent/70 hover:bg-accent/10",
    iconClass: "text-accent-foreground",
  },
] as const;

const cardShell =
  "group flex h-full min-h-[10.5rem] gap-4 rounded-2xl border-2 p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99]";

export function ProductEntryCards() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {entries.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className={cn(cardShell, entry.accent)}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card/80">
              <entry.icon className={cn("h-5 w-5", entry.iconClass)} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 className="font-serif text-lg font-semibold text-foreground group-hover:text-primary">
                {entry.title}
              </h3>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground line-clamp-3">
                {entry.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
      <EmergencyCallbackCard />
    </div>
  );
}
