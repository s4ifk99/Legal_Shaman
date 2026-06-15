import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { SpiralBackground } from "@/components/spiral-decoration";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms and Conditions | Legal Shaman",
  description:
    "The terms and conditions governing your use of Legal Shaman, including how we handle your data, consent, and affiliate relationships.",
};

const lastUpdated = "15 June 2026";

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <section className="relative overflow-hidden border-b-2 border-gold/30 bg-gradient-to-b from-background to-muted/30 py-12 md:py-16">
        <SpiralBackground />
        <div className="relative mx-auto max-w-4xl px-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-gold"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
          <div className="mt-6 flex items-center gap-4">
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
              <h1 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
                Terms and Conditions
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Last updated: {lastUpdated}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="relative py-12 md:py-16">
        <SpiralBackground className="opacity-30" />
        <div className="relative mx-auto max-w-4xl px-4">
          <div className="rounded-2xl border-2 border-gold/30 bg-card p-6 shadow-sm md:p-10">
            <p className="text-muted-foreground leading-relaxed">
              Welcome to Legal Shaman. These Terms and Conditions
              (&quot;Terms&quot;) govern your access to and use of the Legal
              Shaman website and services (the &quot;Service&quot;). By using the
              Service, you agree to be bound by these Terms. Please read them
              carefully.
            </p>

            <div className="mt-10 space-y-10">
              <TermsSection number="1" title="About Legal Shaman">
                <p>
                  Legal Shaman is an AI-powered agentic search engine that helps
                  you find solicitors, legal aid providers, free advice
                  services, pro bono help, and charitable organisations across
                  the UK. We point you in the right direction — we do{" "}
                  <strong className="text-foreground">not</strong> provide legal
                  advice. Always consult a qualified solicitor for legal matters.
                  For urgent legal issues, contact Citizens Advice on 0800 144
                  8848.
                </p>
              </TermsSection>

              <TermsSection number="2" title="Your Privacy and Personal Details">
                <p>
                  We take the privacy of your personal information seriously. In
                  particular:
                </p>
                <ul className="mt-4 space-y-3">
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    <span>
                      <strong className="text-foreground">
                        We do not share your client details or email address.
                      </strong>{" "}
                      Your contact information is never sold, rented, or passed
                      on to third parties for marketing purposes.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    <span>
                      We only use your details to monitor your customer journey
                      and to check whether you were able to find the information
                      you needed quickly and easily, so that we can improve the
                      Service.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    <span>
                      <strong className="text-foreground">
                        We would only ever share your details with your explicit
                        consent.
                      </strong>{" "}
                      Without your consent, your details stay with us.
                    </span>
                  </li>
                </ul>
              </TermsSection>

              <TermsSection number="3" title="Affiliate Revenue and Referral Fees">
                <p>
                  Legal Shaman may receive affiliate revenue and a referral fee
                  if we successfully match you with a lawyer or legal service
                  provider. We believe in being completely transparent about
                  this.
                </p>
                <p className="mt-4">
                  <strong className="text-foreground">
                    Receiving a referral fee does not mean we rank some
                    solicitors higher than others.
                  </strong>{" "}
                  Our recommendations are not influenced by commercial
                  arrangements. We always encourage you to speak to as many
                  lawyers and advisers as possible — especially free services —
                  and to get a second, third, or tenth opinion before making a
                  decision.
                </p>
              </TermsSection>

              <TermsSection number="4" title="No Legal Advice">
                <p>
                  The Service is provided for informational and signposting
                  purposes only and does not constitute legal advice. No
                  solicitor-client relationship is created by your use of the
                  Service. You should always seek advice from a qualified,
                  regulated professional before acting on any information found
                  through Legal Shaman.
                </p>
              </TermsSection>

              <TermsSection number="5" title="Acceptable Use">
                <p>
                  You agree to use the Service lawfully and not to misuse it,
                  including by attempting to interfere with its proper working,
                  scraping data without permission, or using it for any unlawful
                  or fraudulent purpose.
                </p>
              </TermsSection>

              <TermsSection number="6" title="Limitation of Liability">
                <p>
                  While we work hard to keep the information on Legal Shaman
                  accurate and up to date, we make no warranties as to its
                  completeness or accuracy. To the fullest extent permitted by
                  law, Legal Shaman is not liable for any loss or damage arising
                  from your reliance on the Service or any third-party provider
                  we signpost you to.
                </p>
              </TermsSection>

              <TermsSection number="7" title="Changes to These Terms">
                <p>
                  We may update these Terms from time to time. Any changes will
                  be posted on this page with an updated revision date.
                  Continued use of the Service after changes are posted
                  constitutes your acceptance of the revised Terms.
                </p>
              </TermsSection>

              <TermsSection number="8" title="Contact Us">
                <p>
                  If you have any questions about these Terms or how we handle
                  your information, please get in touch via our{" "}
                  <Link
                    href="https://www.linkedin.com/in/aleemthedreamm/"
                    className="font-medium text-gold underline-offset-4 hover:underline"
                  >
                    contact channel
                  </Link>
                  .
                </p>
              </TermsSection>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function TermsSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="font-serif text-xl font-bold text-foreground md:text-2xl">
        <span className="text-gold">{number}.</span> {title}
      </h2>
      <div className="mt-3 space-y-2 leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
