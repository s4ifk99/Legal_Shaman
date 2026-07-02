import signpostingResources from "@/data/signposting-resources.json";
import advocateStub from "@/data/signposting-advocate.json";
import SignpostingView from "./signposting-view";

export const metadata = {
  title: "Signpost | Legal Shaman",
  description:
    "National signposting by area of law — housing, family, work, debt, immigration, and courts. Wiki guides plus Citizens Advice, Shelter, legal aid, and more.",
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
