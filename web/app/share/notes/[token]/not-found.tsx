import Link from "next/link";

export default function ShareNotesNotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-center">
      <p className="font-serif text-sm tracking-wide text-gold">Legal Shaman</p>
      <h1 className="mt-3 font-serif text-3xl font-bold">This share link is not available</h1>
      <p className="mt-4 text-muted-foreground">
        The notes may have expired, been revoked, or the address is incomplete. Ask the client to
        create the link again from Notes for your Lawyer.
      </p>
      <p className="mt-6">
        <Link href="/" className="text-primary underline underline-offset-2">
          Back to Legal Shaman
        </Link>
      </p>
    </main>
  );
}
