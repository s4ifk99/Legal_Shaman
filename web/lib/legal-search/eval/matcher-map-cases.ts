import type { AnyMatch, LawyerMatch, OrgMatch } from "@/lib/agent/types";
import type { MapMarker } from "@/lib/search/map-results";

export const LONDON_COORDS = { lat: 51.5074, lng: -0.1278 };

export function mockLawyerMatchWithCoords(over?: Partial<LawyerMatch>): LawyerMatch {
  const mapMarker: MapMarker = {
    id: "m:lawyer-1",
    entityId: "lawyer-1",
    entityType: "lawyer",
    title: "Employment Law Co",
    practiceAreas: ["Employment"],
    city: "London",
    postcode: "EC1A 1BB",
    lat: LONDON_COORDS.lat,
    lng: LONDON_COORDS.lng,
    source: "lawyer",
    verified: true,
  };
  return {
    kind: "lawyer",
    id: "lawyer-1",
    name: "Employment Law Co",
    firm: null,
    practiceAreas: [{ slug: "employment", name: "Employment" }],
    city: "London",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 10,
    rating: 4.5,
    reviewCount: 12,
    consultationOptions: ["phone"],
    verifiedCredentials: true,
    profileUrl: null,
    explanation: "Matches your search criteria.",
    scoreBreakdown: {
      total: 0.8,
      practiceAreaMatch: 1,
      locationProximity: 0.9,
      jurisdictionMatch: 0.5,
      languageMatch: 0.5,
      verifiedCredentials: 1,
      availability: 0.5,
      rating: 0.8,
      semantic: 0.5,
    },
    location: {
      latitude: LONDON_COORDS.lat,
      longitude: LONDON_COORDS.lng,
      city: "London",
      postcode: "EC1A 1BB",
      locationLabel: "London, EC1A 1BB",
    },
    mapMarker,
    ...over,
  };
}

export function mockLawyerMatchNoCoords(): LawyerMatch {
  return {
    kind: "lawyer",
    id: "lawyer-2",
    name: "No Geo LLP",
    firm: null,
    practiceAreas: [{ slug: "employment", name: "Employment" }],
    city: "London",
    jurisdiction: "England & Wales",
    languages: ["English"],
    yearsExperience: 5,
    rating: 4,
    reviewCount: 3,
    consultationOptions: [],
    verifiedCredentials: false,
    profileUrl: null,
    explanation: "Listed in our directory.",
    scoreBreakdown: {
      total: 0.5,
      practiceAreaMatch: 0.5,
      locationProximity: 0.5,
      jurisdictionMatch: 0.5,
      languageMatch: 0.5,
      verifiedCredentials: 0,
      availability: 0.4,
      rating: 0.6,
      semantic: 0.3,
    },
  };
}

export function mockOrgMatchInvalidCoords(): OrgMatch {
  return {
    kind: "org",
    id: "org-bad",
    sraId: "BAD001",
    businessName: "Invalid Coords Ltd",
    city: "London",
    postcode: "",
    country: "United Kingdom",
    jurisdiction: "England & Wales",
    sraProfileUrl: "https://example.com",
    explanation: "SRA-verified UK firm.",
    scoreBreakdown: {
      total: 0.4,
      practiceAreaMatch: 0.4,
      locationProximity: 0.4,
      jurisdictionMatch: 0.5,
      languageMatch: 0.5,
      verifiedCredentials: 1,
      availability: 0.6,
      rating: 0,
      semantic: 0.3,
    },
    mapMarker: {
      id: "m:org-bad",
      entityId: "org-bad",
      entityType: "sra_organisation",
      title: "Invalid Coords Ltd",
      practiceAreas: [],
      lat: 0,
      lng: 0,
      source: "sra",
    },
  };
}

export const EMPLOYMENT_LONDON_MATCHES: AnyMatch[] = [mockLawyerMatchWithCoords()];
