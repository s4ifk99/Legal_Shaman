import { NextResponse } from "next/server";

import { getLawyerById } from "@/lib/lawyers/db";
import { DISCLAIMER } from "@/lib/agent/types";

export const runtime = "nodejs";

/**
 * GET /api/lawyers/:id
 * Returns one lawyer with relations, or 404.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const lawyer = await getLawyerById(id);
  if (!lawyer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    lawyer: {
      id: lawyer.id,
      name: lawyer.name,
      firm: lawyer.firm ? { id: lawyer.firm.id, name: lawyer.firm.name, website: lawyer.firm.website } : null,
      bio: lawyer.bio,
      yearsExperience: lawyer.yearsExperience,
      rating: lawyer.rating,
      reviewCount: lawyer.reviewCount,
      consultationOptions: lawyer.consultationOptions,
      verifiedCredentials: lawyer.verifiedCredentials,
      profileUrl: lawyer.profileUrl,
      practiceAreas: lawyer.practiceAreas.map((p) => ({
        slug: p.practiceArea.slug,
        name: p.practiceArea.name,
      })),
      locations: lawyer.locations.map((l) => ({
        city: l.city,
        postcode: l.postcode,
        country: l.country,
        jurisdiction: l.jurisdiction,
      })),
      languages: lawyer.languages.map((l) => ({ code: l.language.code, name: l.language.name })),
      credentials: lawyer.credentials.map((c) => ({
        authority: c.authority,
        registrationNumber: c.registrationNumber,
        verifiedAt: c.verifiedAt,
      })),
      availability: lawyer.availability
        ? {
            acceptingClients: lawyer.availability.acceptingClients,
            responseHours: lawyer.availability.responseHours,
            freeConsultation: lawyer.availability.freeConsultation,
            fixedFeeConsultation: lawyer.availability.fixedFeeConsultation,
          }
        : null,
      reviews: lawyer.reviews.map((r) => ({
        rating: r.rating,
        body: r.body,
        verified: r.verified,
        createdAt: r.createdAt,
      })),
    },
    disclaimer: DISCLAIMER,
  });
}
