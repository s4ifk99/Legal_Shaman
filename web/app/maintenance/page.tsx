import type { Metadata } from "next";
import Image from "next/image";
import { SpiralBackground } from "@/components/spiral-decoration";
import { MAINTENANCE_MESSAGE } from "@/lib/maintenance";

export const metadata: Metadata = {
  title: "Maintenance | Legal Shaman",
  description: MAINTENANCE_MESSAGE,
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4">
      <SpiralBackground className="opacity-60" />
      <div className="relative mx-auto max-w-xl text-center">
        <div className="mb-8 flex justify-center">
          <div className="relative">
            <div className="absolute -inset-2 rounded-full bg-gold/20 blur-md" />
            <Image
              src="/logo.jpg"
              alt="Legal Shaman"
              width={80}
              height={80}
              className="relative h-20 w-20 rounded-full border-2 border-gold/50"
              priority
            />
          </div>
        </div>
        <p className="font-serif text-sm font-medium tracking-wide text-primary uppercase">
          Legal Shaman
        </p>
        <h1 className="mt-4 font-serif text-3xl font-bold text-foreground md:text-4xl">
          The Shaman is undergoing maintenance...
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">Will be back soon</p>
      </div>
    </div>
  );
}
