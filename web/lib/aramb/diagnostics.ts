import 'server-only'

export type ArambFailureReason =
  | 'disabled'
  | 'sdk_error'
  | 'parse_failed'
  | 'empty_bundle'
  | 'timeout'

/** Safe metadata for logs, API diagnostics, and Aramb support tickets — no secrets or case text. */
export type ArambResearchDiagnostic = {
  reason: ArambFailureReason
  latencyMs: number
  conversationId?: string
  replyLength?: number
  parsedSourceCount?: number
  parsedQuestionCount?: number
  errorMessage?: string
  agentIdSuffix?: string
  gatewayHost?: string
  sdkVersion?: string
  timeoutMs?: number
}

const SDK_VERSION = '0.0.12'

export function arambGatewayHost(): string {
  const raw = process.env.ARAMB_BASE_URL?.trim() || 'https://gateway.aramb.dev'
  try {
    return new URL(raw).host
  } catch {
    return 'invalid-base-url'
  }
}

export function arambAgentIdSuffix(): string {
  const id = process.env.ARAMB_AGENT_ID?.trim() || ''
  return id.length >= 8 ? id.slice(-8) : id || 'missing'
}

export function baseArambDiagnostic(
  reason: ArambFailureReason,
  latencyMs: number,
  extra: Partial<ArambResearchDiagnostic> = {},
): ArambResearchDiagnostic {
  return {
    reason,
    latencyMs,
    agentIdSuffix: arambAgentIdSuffix(),
    gatewayHost: arambGatewayHost(),
    sdkVersion: SDK_VERSION,
    ...extra,
  }
}

export function logArambDiagnostic(
  diagnostic: ArambResearchDiagnostic,
  context: { caseKey?: string; stream?: boolean; requestId?: string } = {},
): void {
  console.warn(
    '[aramb-pilot]',
    JSON.stringify({
      event: 'research_outcome',
      ...context,
      ...diagnostic,
    }),
  )
}

export function arambSupportSnapshot(extra: Record<string, string | number | boolean | undefined> = {}) {
  return {
    product: 'Legal Shaman — Third Eye / Penumbra',
    sdk: `@aramb-ai/sdk@${SDK_VERSION}`,
    transport: 'WebSocket session.run() (non-streaming)',
    gatewayHost: arambGatewayHost(),
    agentIdSuffix: arambAgentIdSuffix(),
    nodeRuntime: process.version,
    vercel: process.env.VERCEL === '1',
    serverlessRegion: process.env.VERCEL_REGION || undefined,
    requestTimeoutMs: extra.requestTimeoutMs,
    ...extra,
  }
}
