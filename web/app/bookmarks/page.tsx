import { redirect } from "next/navigation";

export const metadata = {
  title: "Your case | Legal Shaman",
  description: "Your plan of action and saved providers.",
  robots: { index: false, follow: false },
};

/** Bookmarks are now part of Your case (consumer Case CRM). */
export default function BookmarksPage() {
  redirect("/my-case");
}
