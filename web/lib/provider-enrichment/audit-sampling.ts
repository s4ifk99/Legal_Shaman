/**
 * Deterministic audit sampling for medium-confidence auto-approval band.
 * In test mode (AUTO_APPROVAL_DETERMINISTIC=1), sampling is stable per entity+field+value.
 */

const DEFAULT_SAMPLE_RATE = 0.15;
const DEFAULT_AUTO_RATE = 0.85;

export function auditSampleRates(): { autoRate: number; auditRate: number } {
  const autoRate = Number(process.env.AUTO_APPROVAL_AUTO_RATE ?? String(DEFAULT_AUTO_RATE));
  const auditRate = Number(process.env.AUTO_APPROVAL_AUDIT_SAMPLE_RATE ?? String(DEFAULT_SAMPLE_RATE));
  return {
    autoRate: Math.min(0.95, Math.max(0.5, autoRate)),
    auditRate: Math.min(0.5, Math.max(0.05, auditRate)),
  };
}

function stableHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Returns true if this medium-confidence item should go to audit sample instead of auto-approve. */
export function shouldAuditSample(args: {
  entityId: string;
  fieldName: string;
  extractedValue: string;
  confidence: number;
}): boolean {
  if (process.env.AUTO_APPROVAL_DETERMINISTIC === "1") {
    const key = `${args.entityId}|${args.fieldName}|${args.extractedValue}|${args.confidence.toFixed(3)}`;
    const bucket = stableHash(key) % 100;
    const { autoRate } = auditSampleRates();
    return bucket >= Math.floor(autoRate * 100);
  }

  if (process.env.NODE_ENV === "test") {
    const key = `${args.entityId}|${args.fieldName}`;
    return stableHash(key) % 10 === 0;
  }

  return Math.random() >= auditSampleRates().autoRate;
}
