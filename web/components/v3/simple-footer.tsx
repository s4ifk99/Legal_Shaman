import Link from "next/link";

export function SimpleFooter() {
  return (
    <footer className="relative z-20 border-t border-white/20 bg-transparent py-6 backdrop-blur-[1px]">
      <div className="mx-auto max-w-3xl px-4 text-center text-sm text-foreground/80">
        <p className="font-serif text-base text-foreground">Legal Shaman</p>
        <p className="mt-2 text-foreground/75">
          UK legal directory — information, financing routes, matched providers, reviews and costs.
        </p>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link href="/search" className="underline decoration-gold/50 underline-offset-2 hover:text-foreground">
            Directory search
          </Link>
          <Link href="/signposting" className="underline decoration-gold/50 underline-offset-2 hover:text-foreground">
            Free help index
          </Link>
          <Link href="/privacy" className="underline decoration-gold/50 underline-offset-2 hover:text-foreground">
            Privacy
          </Link>
        </p>
        <p className="mt-4 text-xs text-foreground/65">
          We signpost and help map claims, financing, and solicitor costs for all kinds of matters. Not a solicitor. Not legal advice.
        </p>
      </div>
    </footer>
  );
}
