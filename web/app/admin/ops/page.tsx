import OpsClient from "./ops-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function OpsAdminPage() {
  return <OpsClient />;
}
