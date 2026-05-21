import ProviderCrawlerAdminClient from "./provider-crawler-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ProviderCrawlerAdminPage() {
  return <ProviderCrawlerAdminClient />;
}
