import Link from "next/link";
import Image from "next/image";
import { Star, Youtube } from "lucide-react";
import { trustpilotUrl, youtubeUrl } from "@/lib/site/social-links";
import { SpiralDecoration } from "./spiral-decoration";

const socialLinkClass =
  "inline-flex items-center gap-2 text-sm text-primary-foreground/70 transition-colors hover:text-gold";

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t-2 border-gold/30 bg-primary py-12 text-primary-foreground">
      {/* Decorative spirals */}
      <div className="absolute -left-24 -top-24 opacity-10">
        <SpiralDecoration size={300} color="var(--gold)" />
      </div>
      <div className="absolute -bottom-20 -right-20 opacity-10">
        <SpiralDecoration size={250} color="var(--gold)" />
      </div>
      
      <div className="relative mx-auto max-w-6xl px-4">
        <div className="flex flex-col items-center gap-8 md:flex-row md:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="absolute -inset-2 rounded-full bg-gold/20 blur-md" />
              <Image
                src="/logo.jpg"
                alt="Legal Shaman Logo"
                width={56}
                height={56}
                className="relative h-14 w-14 rounded-full border-2 border-gold/50"
              />
            </div>
            <div>
              <span className="font-serif text-2xl font-bold">Legal Shaman</span>
              <p className="text-sm text-primary-foreground/70">Fixing Search for Legal Disputes</p>
            </div>
          </div>
          
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm">
            <Link href="/ask-the-shaman" className="text-primary-foreground/70 transition-colors hover:text-gold">
              Ask the Shaman
            </Link>
            <Link href="/signposting" className="text-primary-foreground/70 transition-colors hover:text-gold">
              Signpost
            </Link>
            <Link href="/bookmarks" className="text-primary-foreground/70 transition-colors hover:text-gold">
              Bookmarks
            </Link>
            <Link href="/terms" className="text-primary-foreground/70 transition-colors hover:text-gold">
              Terms
            </Link>
            <Link href="/privacy" className="text-primary-foreground/70 transition-colors hover:text-gold">
              Privacy
            </Link>
            <Link href="/signpost" className="text-primary-foreground/70 transition-colors hover:text-gold">
              For Firms
            </Link>
            <Link href="https://www.linkedin.com/in/aleemthedreamm/" className="text-primary-foreground/70 transition-colors hover:text-gold">
              Contact
            </Link>
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Legal Shaman on YouTube (opens in new tab)"
              className={socialLinkClass}
            >
              <Youtube className="h-4 w-4 shrink-0" aria-hidden />
              YouTube
            </a>
            <a
              href={trustpilotUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Legal Shaman reviews on Trustpilot (opens in new tab)"
              className={socialLinkClass}
            >
              <Star className="h-4 w-4 shrink-0" aria-hidden />
              Trustpilot
            </a>
          </nav>
        </div>
        
        <div className="mt-10 border-t border-primary-foreground/20 pt-8 space-y-4">
          <p className="text-center font-serif text-lg font-medium text-gold">
            Fixing Search for Legal Disputes
          </p>
          <p className="text-center text-sm text-primary-foreground/70 max-w-2xl mx-auto">
            Legal Shaman is the UK&apos;s agentic legal signposting platform — search solicitors, legal aid, and free advice; get guided lawyer matches; and explore wiki resources across the UK.
          </p>
          <p className="text-center text-xs text-primary-foreground/60 max-w-2xl mx-auto">
            We&apos;re building the future of legal assistance by combining intelligent AI agents with comprehensive legal resources — 
            helping you find solicitors, <strong className="text-gold">free</strong> services,{" "}
            <strong className="text-gold">legal aid</strong>, pro bono help, and charitable organisations across the UK.
          </p>
          <p className="text-center text-xs text-primary-foreground/60">
            This site does not provide legal advice. Always consult with a qualified solicitor for legal matters. 
            For urgent legal issues, contact Citizens Advice on 0800 144 8848.
          </p>
          <p className="text-center text-sm font-medium text-gold pt-2">Follow us</p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Legal Shaman on YouTube (opens in new tab)"
              className={socialLinkClass}
            >
              <Youtube className="h-4 w-4 shrink-0" aria-hidden />
              YouTube
            </a>
            <span className="hidden text-primary-foreground/30 sm:inline" aria-hidden>
              ·
            </span>
            <a
              href={trustpilotUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Legal Shaman reviews on Trustpilot (opens in new tab)"
              className={socialLinkClass}
            >
              <Star className="h-4 w-4 shrink-0" aria-hidden />
              Trustpilot
            </a>
          </div>
          <p className="mt-4 text-center text-xs text-primary-foreground/40">
            &copy; 2026 Legal Shaman. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
