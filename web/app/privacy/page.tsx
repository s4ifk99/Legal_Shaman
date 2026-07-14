import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { SpiralBackground } from "@/components/spiral-decoration";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy | Legal Shaman",
  description:
    "How Legal Shaman collects, uses, and protects your personal information, including our commitment never to share your details without your consent.",
};

const lastUpdated = "9 July 2026";

export default function PrivacyPage() {
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
                Privacy Policy
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
              At Legal Shaman, your privacy matters to us. This Privacy Policy
              explains what information we collect when you use the Legal Shaman
              website and services (the &quot;Service&quot;), how we use it, and
              the choices you have. By using the Service, you agree to the
              practices described below.
            </p>

            <div className="mt-10 space-y-10">
              <PrivacySection number="1" title="Information We Collect">
                <p>
                  We aim to collect as little personal information as possible.
                  Depending on how you use the Service, this may include:
                </p>
                <ul className="mt-4 space-y-3">
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    <span>
                      Details you choose to provide, such as your name, email
                      address, and a description of the legal help you are
                      looking for.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    <span>
                      Usage information, such as the pages and resources you
                      view, so we can understand your journey through the
                      Service.
                    </span>
                  </li>
                </ul>
              </PrivacySection>

              <PrivacySection number="2" title="How We Use Your Information">
                <p>
                  We only use your information to operate and improve the
                  Service. In particular:
                </p>
                <ul className="mt-4 space-y-3">
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    <span>
                      We use your details to monitor your customer journey and
                      to check whether you were able to find the information you
                      needed quickly and easily.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    <span>
                      We use what we learn to improve our signposting,
                      recommendations, and overall user experience.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    <span>
                      If you opt in on guided search, we email you a summary of your results.
                      With your separate consent, we may share your email with Trustpilot so they
                      can invite you to leave a review about Legal Shaman.
                    </span>
                  </li>
                </ul>
              </PrivacySection>

              <PrivacySection number="3" title="We Do Not Share Your Details Without Consent">
                <p>
                  <strong className="text-foreground">
                    We do not sell or rent your contact information.
                  </strong>{" "}
                  Your email address is not passed to third parties for their own marketing
                  purposes.
                </p>
                <p className="mt-4">
                  <strong className="text-foreground">
                    We only share your details when you have agreed.
                  </strong>{" "}
                  For example, if you ask us to connect you with a specific solicitor or service,
                  we will only pass on your details once you have agreed. If you opt in to receive a
                  search summary and a Trustpilot review invitation, we share your email with
                  Trustpilot solely so they can send that invitation on our behalf.
                </p>
                <p className="mt-4">
                  Trustpilot processes review invitations under their own privacy policy. You can
                  withdraw consent for future review invitations by contacting us using the details
                  below.
                </p>
              </PrivacySection>

              <PrivacySection number="4" title="Affiliate Revenue and Referral Fees">
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
                  arrangements, and our affiliate relationships never affect the
                  privacy commitments set out in this policy.
                </p>
              </PrivacySection>

              <PrivacySection number="5" title="Cookies and Analytics">
                <p>
                  We may use cookies and similar technologies to keep the Service
                  working properly and to understand how it is used in aggregate.
                  These help us measure whether people are finding information
                  quickly and easily. You can control cookies through your
                  browser settings.
                </p>
              </PrivacySection>

              <PrivacySection number="6" title="How We Protect Your Information">
                <p>
                  We take reasonable technical and organisational measures to
                  keep your information secure and to prevent unauthorised
                  access, loss, or misuse. We retain your information only for as
                  long as necessary to provide and improve the Service.
                </p>
              </PrivacySection>

              <PrivacySection number="7" title="Your Rights">
                <p>
                  You have the right to access the personal information we hold
                  about you, to ask us to correct or delete it, and to withdraw
                  any consent you have given. To exercise these rights, please
                  contact us using the details below.
                </p>
              </PrivacySection>

              <PrivacySection number="8" title="Changes to This Policy">
                <p>
                  We may update this Privacy Policy from time to time. Any
                  changes will be posted on this page with an updated revision
                  date. Please check back periodically to stay informed about how
                  we protect your information.
                </p>
              </PrivacySection>

              <PrivacySection number="9" title="Contact Us">
                <p>
                  If you have any questions about this Privacy Policy or how we
                  handle your information, please get in touch via our{" "}
                  <Link
                    href="https://www.linkedin.com/in/aleemthedreamm/"
                    className="font-medium text-gold underline-offset-4 hover:underline"
                  >
                    contact channel
                  </Link>
                  .
                </p>
              </PrivacySection>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function PrivacySection({
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
