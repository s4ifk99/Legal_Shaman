import FailedSearchesAdminClient from "./failed-searches-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function FailedSearchesAdminPage() {
  return <FailedSearchesAdminClient />;
}
