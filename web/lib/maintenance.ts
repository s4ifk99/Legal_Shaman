/**
 * Public-site maintenance gate.
 *
 * Off by default. Set MAINTENANCE_MODE=1 and redeploy to close the public site.
 */
export function isMaintenanceMode(): boolean {
  const raw = process.env.MAINTENANCE_MODE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return false;
}

export const MAINTENANCE_MESSAGE =
  "The Shaman is undergoing maintenance... Will be back soon";
