/**
 * Public-site maintenance gate.
 *
 * Production stays closed until MAINTENANCE_MODE is explicitly set to
 * 0 / false / off, then the app is redeployed.
 * Local and Vercel preview stay open unless MAINTENANCE_MODE=1.
 */
export function isMaintenanceMode(): boolean {
  const raw = process.env.MAINTENANCE_MODE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return process.env.VERCEL_ENV === "production";
}

export const MAINTENANCE_MESSAGE =
  "The Shaman is undergoing maintenance... Will be back soon";
