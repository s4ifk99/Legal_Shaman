import type { UrgentSignposting } from "@/lib/legal-search/triage/types";

type TriageUrgentBannerProps = {
  signposting: UrgentSignposting;
};

export function TriageUrgentBanner({ signposting }: TriageUrgentBannerProps) {
  return (
    <div
      className="rounded-lg border border-amber-300/80 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40"
      role="status"
    >
      <p className="font-semibold text-amber-950 dark:text-amber-100">{signposting.headline}</p>
      <p className="mt-2 leading-relaxed text-amber-900/90 dark:text-amber-100/90">
        {signposting.body}
      </p>
      {signposting.emergencyContacts?.length ? (
        <ul className="mt-3 space-y-1 text-amber-900 dark:text-amber-100">
          {signposting.emergencyContacts.map((c) => (
            <li key={c.label}>
              <span className="font-medium">{c.label}:</span> {c.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
