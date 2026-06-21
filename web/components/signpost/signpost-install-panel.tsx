"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

const IFRAME_SNIPPET =
  '<iframe src="https://www.legalshaman.com/embed/signpost" width="100%" height="640" style="border:0;border-radius:12px"></iframe>';

const HTML_SNIPPET = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Legal Shaman Signpost</title>
  </head>
  <body style="margin:0;padding:16px;font-family:system-ui,sans-serif;background:#faf9f7;">
    ${IFRAME_SNIPPET}
  </body>
</html>
`;

export function SignpostInstallPanel() {
  const [copied, setCopied] = useState(false);

  async function copySnippet() {
    await navigator.clipboard.writeText(IFRAME_SNIPPET);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function downloadHtml() {
    const blob = new Blob([HTML_SNIPPET], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "legal-shaman-signpost-embed.html";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <pre className="overflow-x-auto rounded-xl border border-gold/30 bg-muted/40 p-4 text-sm text-foreground">
        <code>{IFRAME_SNIPPET}</code>
      </pre>

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={() => void copySnippet()} className="gap-2">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy iframe code"}
        </Button>
        <Button type="button" variant="outline" onClick={downloadHtml} className="gap-2">
          <Download className="h-4 w-4" />
          Download HTML snippet
        </Button>
      </div>
    </div>
  );
}
