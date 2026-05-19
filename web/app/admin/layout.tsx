import { isAdminDevUnprotected } from "@/lib/admin/auth";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const warn = isAdminDevUnprotected();

  return (
    <>
      {warn ? (
        <div
          role="status"
          style={{
            background: "#fff3cd",
            borderBottom: "1px solid #ffc107",
            color: "#664d03",
            padding: "0.65rem 1rem",
            fontFamily: "system-ui, sans-serif",
            fontSize: "0.9rem",
          }}
        >
          <strong>Admin security warning:</strong> <code>ADMIN_SECRET</code> is not set. In development
          the admin area and admin APIs are reachable without authentication. Set{" "}
          <code>ADMIN_SECRET</code> in <code>.env.local</code> to mirror production behaviour. Never deploy
          production without <code>ADMIN_SECRET</code>.
        </div>
      ) : null}
      {children}
    </>
  );
}
