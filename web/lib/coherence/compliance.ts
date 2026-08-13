/**
 * Phase 0 — frozen compliance copy (immigration trial scope).
 * Information + signpost only; not a solicitor; when to seek urgent help.
 */

export const SYSTEM_DISCLAIMER =
  'Information and signposting only. Not a solicitor. Not legal advice. Generated for triage / handoff.'

export const FOOTER_DISCLAIMER =
  'Information and signposting only. Not a solicitor. Not legal advice.'

/** Shown when safety / urgent immigration flags fire. */
export const URGENT_HELP_COPY =
  'If you are in immediate danger, call 999. If you are detained, facing imminent removal, or need urgent protection advice, contact a regulated immigration adviser or solicitor as soon as you can — this tool cannot represent you or stop a removal.'

export const IMMIGRATION_URGENT_TRIGGERS =
  /detained|detention|removal direction|imminent removal|deport.*tomorrow|scared for my (life|safety)|traffick|modern slavery|urgent help/i

export type RiskRouting = 'standard' | 'urgent_human' | 'emergency_services_info'

export function resolveRiskRouting(opts: {
  safetyRisk: boolean
  mode: string
  textBlob: string
}): { immediate_danger: boolean; routing: RiskRouting; urgentHelpCopy?: string } {
  const urgentText = IMMIGRATION_URGENT_TRIGGERS.test(opts.textBlob)
  const immediate =
    opts.safetyRisk || opts.mode === 'urgent' || /immediate danger|not safe|999/i.test(opts.textBlob)

  if (immediate && /999|immediate danger|not safe/i.test(opts.textBlob)) {
    return {
      immediate_danger: true,
      routing: 'emergency_services_info',
      urgentHelpCopy: URGENT_HELP_COPY,
    }
  }
  if (immediate || urgentText) {
    return {
      immediate_danger: immediate,
      routing: 'urgent_human',
      urgentHelpCopy: URGENT_HELP_COPY,
    }
  }
  return { immediate_danger: false, routing: 'standard' }
}
