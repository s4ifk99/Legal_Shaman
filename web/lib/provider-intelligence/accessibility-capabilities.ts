import type { AccessibilityCapability } from "@/lib/provider-intelligence/capability-taxonomy";

export const ACCESSIBILITY_CAPABILITY_PATTERNS: {
  capability: AccessibilityCapability;
  pattern: RegExp;
}[] = [
  { capability: "accessibility.wheelchair", pattern: /\b(wheelchair|step[- ]free|accessible premises)\b/i },
  { capability: "accessibility.interpreter", pattern: /\b(interpreter|translation|bilingual staff)\b/i },
  {
    capability: "accessibility.remote_consultation",
    pattern: /\b(remote|video call|telephone advice|online consultation|zoom)\b/i,
  },
  { capability: "accessibility.home_visits", pattern: /\b(home visit|visit your home)\b/i },
  {
    capability: "accessibility.accessible_communication",
    pattern: /\b(BSL|british sign language|easy read|large print)\b/i,
  },
];

export function accessibilityCapabilitiesFromQuery(query: string): AccessibilityCapability[] {
  const out: AccessibilityCapability[] = [];
  for (const { capability, pattern } of ACCESSIBILITY_CAPABILITY_PATTERNS) {
    if (pattern.test(query)) out.push(capability);
  }
  if (/\b(disability|wheelchair|accessible)\b/i.test(query)) {
    if (!out.includes("accessibility.wheelchair")) out.push("accessibility.wheelchair");
  }
  return out;
}
