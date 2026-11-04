/**
 * Outbound template for Exp 7 discovery — LegalShaman identity only.
 * Do not include user identity or identifying case details.
 */
export function buildProviderEnquiryEmail(input: {
  firmName: string;
  areaOfLaw: string;
}): { subject: string; body: string } {
  const subject = `LegalShaman directory enquiry — ${input.areaOfLaw}`;
  const body = `Dear ${input.firmName},

LegalShaman (legalshaman.com) is a UK signposting service. We help people find free, funded, and private legal support. We are writing from our server on behalf of LegalShaman — not on behalf of a named client.

For the practice area "${input.areaOfLaw}", could you tell us:

1. Whether you currently take on new matters in this area
2. Typical fee ranges (fixed fee or hourly) if published
3. Any eligibility requirements for free or legal-aid work you offer
4. Whether you can assist remotely or only in certain locations

Please reply to this email. We will show your answers as "provider-stated" with a date on LegalShaman, or leave fields as Unknown until we hear from you.

Users remain anonymous to your firm until they choose to contact you directly.

Thank you,
LegalShaman
https://www.legalshaman.com
`;
  return { subject, body };
}
