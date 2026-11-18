import type { Metadata } from "next";
import { MyCaseClient } from "@/components/v3/my-case-client";
import { isV3SimpleShellEnabled } from "@/lib/v3/feature";
import { SimpleHeader } from "@/components/v3/simple-header";
import { SimpleFooter } from "@/components/v3/simple-footer";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Your results",
  description: "Your plan of action, financing path, and free services that may apply.",
  robots: { index: false, follow: false },
};

export default function MyCasePage() {
  const simple = isV3SimpleShellEnabled();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {simple ? <SimpleHeader /> : <Header />}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:max-w-4xl md:py-12">
        <MyCaseClient />
      </main>
      {simple ? <SimpleFooter /> : <Footer />}
    </div>
  );
}
