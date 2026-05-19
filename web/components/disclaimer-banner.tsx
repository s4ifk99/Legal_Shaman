import { Info } from "lucide-react";

export function DisclaimerBanner({ message }: { message?: string }) {
  return (
    <div
      role="note"
      className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p className="leading-snug">
          {message ??
            "This is not legal advice. Matches are generated from stored profile data — they do not assess your specific case."}
        </p>
      </div>
    </div>
  );
}
