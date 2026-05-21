import ProviderEnrichmentAdminClient from "./provider-enrichment-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ProviderEnrichmentAdminPage() {
  return <ProviderEnrichmentAdminClient />;
}
