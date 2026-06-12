import type { RecoveryContext } from "@/lib/sra/missing-identity-recovery/types";
import { buildSerperQueries, recoverFromSerper } from "@/lib/sra/missing-identity-recovery/serper-recovery";

/** Postcode/address targeted web search (Serper-backed). */
export async function recoverFromPostcodeSearch(
  ctx: RecoveryContext,
  addressLine?: string,
) {
  const queries = buildSerperQueries(ctx, addressLine).filter((q) =>
    /postcode|solicitor|law firm/i.test(q),
  );
  return recoverFromSerper(ctx, addressLine);
}
