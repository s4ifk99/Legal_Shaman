import UsersAdminClient from "./users-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function UsersAdminPage() {
  return <UsersAdminClient />;
}
