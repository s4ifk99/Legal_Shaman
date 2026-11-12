import ProviderEnquiriesClient from "./provider-enquiries-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ProviderEnquiriesAdminPage() {
  return <ProviderEnquiriesClient />;
}
