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
 * When on: marketing landing on `/`, V3 agent on `/ask-the-shaman`.
 * When off (production default): V3 agent on `/` — the previous Ask the Shaman homepage.
 * Local: set NEXT_PUBLIC_V3_LANDING=1 in `.env.local`.
 */
export function isV3LandingEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_V3_LANDING?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  return false;
}
