"use client";

import type { MatterInspectorView } from "@/lib/matter/inspector";

type Props = {
  inspector: MatterInspectorView | null;
};

export function MatterFrameInspector({ inspector }: Props) {
  if (!inspector) return null;

  return (
    <details className="matter-inspector rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">
        Matter frame · {inspector.resolutionStatus} · confidence{" "}
        {inspector.overallConfidence.toFixed(2)}
      </summary>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
        {inspector.text}
      </pre>
    </details>
  );
}
