/** Client-side endpoint selection for Coherence master runs. */
export function coherenceMasterEndpoint(): string {
  const flag = (process.env.NEXT_PUBLIC_COHERENCE_QUERY_GATEWAY || "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes" || flag === "on") {
    return "/api/coherence/query";
  }
  return "/api/coherence/llm/master";
}

export function useCoherenceQueryGatewayClient(): boolean {
  return coherenceMasterEndpoint() === "/api/coherence/query";
}
