import signpostingResources from "@/data/signposting-resources.json";
import advocateStub from "@/data/signposting-advocate.json";
import SignpostingView from "./signposting-view";

export const metadata = {
  title: "Signposting Resources | Legal Shaman",
  description:
    "National signposting resources for UK legal help — Citizens Advice, legal aid, housing, employment, family, and more.",
};

export default function SignpostingPage() {
  return (
    <SignpostingView
      sections={signpostingResources.sections}
      advocateResources={advocateStub.resources ?? []}
      variant="page"
    />
  );
}
