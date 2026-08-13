import CrmClient from "./crm-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function CrmAdminPage() {
  return <CrmClient />;
}
