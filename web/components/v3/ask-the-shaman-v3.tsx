"use client";

import { SimpleHeader } from "@/components/v3/simple-header";
import { SimpleFooter } from "@/components/v3/simple-footer";
import { ThirdEyeShell } from "@/components/v3/third-eye-shell";

/** V3 Ask the Shaman agent shell (Rothko + document-aware chat). */
export function AskTheShamanV3() {
  return (
    <div className="relative flex min-h-dvh flex-col bg-transparent">
      <SimpleHeader />
      <main className="relative z-10 flex min-h-0 flex-1 flex-col">
        <ThirdEyeShell />
      </main>
      <SimpleFooter />
    </div>
  );
}
