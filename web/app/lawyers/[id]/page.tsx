import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Briefcase, CheckCircle2, Languages, MapPin, Star } from "lucide-react";

import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DisclaimerBanner } from "@/components/disclaimer-banner";
import { getLawyerById } from "@/lib/lawyers/db";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const lawyer = await getLawyerById(id);
  if (!lawyer) return { title: "Lawyer not found | Legal Shaman" };
  return {
    title: `${lawyer.name} | Legal Shaman`,
    description: lawyer.bio.slice(0, 160),
  };
}

export default async function LawyerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const lawyer = await getLawyerById(id);
  if (!lawyer) notFound();

  const loc = lawyer.locations[0];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8">
        <DisclaimerBanner />

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="font-serif text-3xl font-semibold text-primary">
                {lawyer.name}
              </h1>
              {lawyer.firm ? (
                <p className="flex items-center gap-1 text-muted-foreground">
                  <Briefcase className="h-4 w-4" />
                  {lawyer.firm.name}
                </p>
              ) : null}
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1 text-sm">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                <span className="font-medium">{lawyer.rating.toFixed(1)}</span>
                <span className="text-muted-foreground">({lawyer.reviewCount})</span>
              </div>
              {lawyer.verifiedCredentials ? (
                <Badge variant="secondary" className="mt-2 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Verified
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {loc ? (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 flex-shrink-0" />
                <span>
                  {loc.city}
                  {loc.postcode ? ` ${loc.postcode}` : ""} · {loc.jurisdiction}
                </span>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Languages className="h-4 w-4 flex-shrink-0" />
              <span>
                {lawyer.languages.map((l) => l.language.name).join(", ") || "English"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {lawyer.practiceAreas.map((p) => (
              <Badge key={p.practiceArea.slug} variant="outline">
                {p.practiceArea.name}
              </Badge>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {lawyer.bio}
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Credentials</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {lawyer.credentials.length === 0 ? (
                <p className="text-muted-foreground">No credentials listed.</p>
              ) : (
                lawyer.credentials.map((c) => (
                  <div key={c.authority + c.registrationNumber}>
                    <span className="font-medium">{c.authority}</span>
                    <span className="text-muted-foreground"> · {c.registrationNumber}</span>
                  </div>
                ))
              )}
              <p className="pt-2 text-xs text-muted-foreground">
                {lawyer.yearsExperience > 0
                  ? `${lawyer.yearsExperience}+ years experience`
                  : "Experience not stated"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Availability</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {lawyer.availability?.acceptingClients
                  ? "Currently accepting new clients"
                  : "Not currently accepting new clients"}
              </p>
              {lawyer.availability?.responseHours != null ? (
                <p className="text-muted-foreground">
                  Typical response: within {lawyer.availability.responseHours} hours
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1.5 pt-2">
                {lawyer.consultationOptions.map((opt) => (
                  <Badge key={opt} variant="outline" className="text-xs">
                    {opt.replace(/_/g, " ")}
                  </Badge>
                ))}
                {lawyer.availability?.freeConsultation ? (
                  <Badge className="text-xs">Free consultation</Badge>
                ) : null}
                {lawyer.availability?.fixedFeeConsultation ? (
                  <Badge className="text-xs">Fixed-fee consultation</Badge>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-3">
          {lawyer.profileUrl ? (
            <Button asChild>
              <a href={lawyer.profileUrl} target="_blank" rel="noreferrer">
                Contact lawyer
              </a>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href="/ask-the-shaman">Back to Ask the Shaman</Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
