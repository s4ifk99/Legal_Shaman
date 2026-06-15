const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidWaitlistEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function normalizeWaitlistEmail(email: string): string {
  return email.trim().toLowerCase();
}
