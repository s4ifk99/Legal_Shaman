/**
 * V3 simplified Third Eye shell.
 * On by default in local development; opt in/out with NEXT_PUBLIC_V3_SIMPLE_SHELL.
 */
export function isV3SimpleShellEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_V3_SIMPLE_SHELL?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  return process.env.NODE_ENV === "development";
}

/**
 * Legacy flag. Homepage is always the What is / marketing landing;
 * V3 agent is always on `/ask-the-shaman` when simple shell is on.
 * Kept so older call sites compile; prefer routing on those pages directly.
 */
export function isV3LandingEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_V3_LANDING?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  // Default on: What is landing on `/`.
  return true;
}
