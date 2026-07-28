import { redirect } from "next/navigation";

export default function FindALawyerPage() {
  redirect("/ask-the-shaman?guided=1");
}
