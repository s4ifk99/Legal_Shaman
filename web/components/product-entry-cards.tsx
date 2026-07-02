import { BookOpen, Compass } from "lucide-react";
import Link from "next/link";
import { EmergencyCallbackCard } from "@/components/emergency-callback-card";
import { cn } from "@/lib/utils";

const entries = [
  {
    href: "/ask-the-shaman",
    title: "Ask the Shaman",
    description:
      "Wiki guidance, guided lawyer matching, and OSLAW — everything you need to understand your issue and find help.",
    icon: BookOpen,
    accent: "border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10",
    iconClass: "text-primary",
  },
  {
    href: "/signposting",
    title: "Signpost",
    description:
      "National signposting by area of law — Citizens Advice, Shelter, legal aid, courts, and trusted resources.",
    icon: Compass,
    accent: "border-gold/40 bg-gold/5 hover:border-gold/70 hover:bg-gold/10",
    iconClass: "text-gold",
  },
] as const;

const cardShell =
  "group flex h-full min-h-[11rem] gap-4 rounded-2xl border-2 p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99]";

export function ProductEntryCards() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {entries.map((entry) => (
          <Link key={entry.href} href={entry.href} className={cn(cardShell, entry.accent)}>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card/80">
              <entry.icon className={cn("h-6 w-6", entry.iconClass)} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 className="font-serif text-xl font-semibold text-foreground group-hover:text-primary">
                {entry.title}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
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
