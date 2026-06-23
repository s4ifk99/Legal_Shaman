import type { SearchResult } from "@/lib/legal-search/types";
import {
  contactPageUrlForResult,
  emailForDisplay,
  formatPhoneForDisplay,
  phoneForDisplay,
  websiteUrlForResult,
} from "@/lib/legal-search/public-search-result";
import { telHref } from "@/lib/search/sra-display";

type TriageResultContactLinksProps = {
  result: SearchResult;
};

/** Contact actions kept outside expand buttons so phone/website links stay clickable. */
export function TriageResultContactLinks({ result }: TriageResultContactLinksProps) {
  const phone = phoneForDisplay(result);
  const email = emailForDisplay(result);
  const website = websiteUrlForResult(result);
  const contactPage = contactPageUrlForResult(result);

  if (!phone && !email && !website && !contactPage) {
    return (
      <p className="pt-3 text-sm text-muted-foreground">
        Contact details not listed — expand the card or check the SRA register for this firm.
      </p>
    );
  }

  return (
    <div className="space-y-1 pt-3 text-sm">
      {phone ? (
        <p>
          <span className="text-muted-foreground">Phone: </span>
          <a href={telHref(phone)} className="font-medium text-primary hover:underline">
            {formatPhoneForDisplay(phone)}
          </a>
        </p>
      ) : null}
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        {website ? (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Website
          </a>
        ) : null}
        {contactPage ? (
          <a
            href={contactPage}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            {website ? "Contact" : contactPage.includes("sra.org.uk") ? "SRA register" : "Contact page"}
          </a>
        ) : null}
      </p>
      {email ? (
        <p>
          <a href={`mailto:${email}`} className="text-primary hover:underline">
            {email}
          </a>
        </p>
      ) : null}
    </div>
  );
}
