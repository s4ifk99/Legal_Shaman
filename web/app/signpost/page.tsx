import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { SpiralBackground } from "@/components/spiral-decoration";
import { ArrowLeft, Download, Share2, EyeOff, Users, Sparkles } from "lucide-react";
import { WaitlistForm } from "./waitlist-form";

export const metadata: Metadata = {
  title: "Signpost | Legal Shaman",
  description:
    "Signpost is a feature in development that lets law firms send and receive client referrals directly through Legal Shaman. Join the waitlist.",
};

const steps = [
  {
    icon: Download,
    title: "Add Signpost to your site",
    description:
      "It's very simple — download our Signpost widget and place it on your website in minutes.",
  },
  {
    icon: Share2,
    title: "Redirect clients you can't help",
    description:
      "When a client comes to you with a matter your firm can't take on, point them to Signpost and we'll help them access the law.",
  },
  {
    icon: EyeOff,
    title: "Your competitors stay hidden",
    description:
      "We hide the firms that compete with you in your own practice area, so you never send work straight to a rival.",
  },
  {
    icon: Users,
    title: "Receive referrals back",
    description:
      "In return, you receive referrals from fellow lawyers — everyone helps each other, and everyone helps people access the law.",
  },
];

export default function SignpostPage() {
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
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">
                <Sparkles className="h-3.5 w-3.5" />
                Coming soon
              </span>
              <h1 className="mt-2 font-serif text-3xl font-bold text-foreground md:text-4xl">
                Signpost
              </h1>
            </div>
          </div>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            A feature in development that lets you{" "}
            <strong className="text-foreground">send and receive client referrals directly</strong>{" "}
            through our platform — building one massive, smart, agentic ecosystem that helps everyone
            access the law.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="relative py-12 md:py-16">
        <SpiralBackground className="opacity-30" />
        <div className="relative mx-auto max-w-4xl px-4">
          <h2 className="font-serif text-2xl font-bold text-foreground md:text-3xl">
            How Signpost works
          </h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {steps.map((step) => (
              <div
                key={step.title}
                className="rounded-2xl border-2 border-gold/30 bg-card p-6 shadow-sm"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/15">
                  <step.icon className="h-5 w-5 text-gold" />
                </div>
                <h3 className="mt-4 font-serif text-lg font-bold text-foreground">
                  {step.title}
                </h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{step.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border-2 border-gold/30 bg-muted/30 p-6 md:p-8">
            <p className="leading-relaxed text-muted-foreground">
              The idea is simple: help everyone access the law in one massive, smart, agentic
              ecosystem. You refer the clients you can&apos;t help to lawyers who can, fellow lawyers
              do the same for you, and no one loses work to a direct competitor. Together we make sure
              no one is left without somewhere to turn.
            </p>
          </div>
        </div>
      </section>

      {/* Waitlist */}
      <section className="relative border-t-2 border-gold/30 bg-gradient-to-b from-muted/30 to-background py-12 md:py-16">
        <SpiralBackground className="opacity-30" />
        <div className="relative mx-auto max-w-2xl px-4">
          <div className="mb-8 text-center">
            <h2 className="font-serif text-2xl font-bold text-foreground md:text-3xl">
              Join the waitlist
            </h2>
            <p className="mt-3 text-muted-foreground leading-relaxed">
              Signpost is coming soon. Be among the first firms in the ecosystem — add your details
              and we&apos;ll let you know the moment it&apos;s ready.
            </p>
          </div>
          <WaitlistForm />
        </div>
      </section>

      <Footer />
    </div>
  );
}
