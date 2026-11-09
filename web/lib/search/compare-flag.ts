/** Guided comparison workspace (Exp 4). Default on for results; `compare=0` disables. */
export function compareParamEnabled(raw: string | null | undefined): boolean {
  if (raw == null || raw === "") return true;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}
