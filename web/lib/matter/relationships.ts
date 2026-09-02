/**
 * Event-scoped relationship / capacity extraction.
 * Employment backdrop must not contaminate a private sale or consumer event.
 */
import { enrichEvent } from "./retrieval-plan";
import type {
  MatterAmbiguity,
  MatterEvent,
  MatterParty,
  MatterRelationship,
  MatterResolveInput,
  PartyCapacity,
  PartyCapacityKind,
} from "./types";

export type RelationshipModel = {
  parties: MatterParty[];
  capacities: PartyCapacity[];
  relationships: MatterRelationship[];
  events: MatterEvent[];
  disputeEventIds: string[];
  disputeIssueHints: { slug: string; confidence: number; reason: string }[];
  ambiguities: MatterAmbiguity[];
};

function party(id: string, role: string, label: string): MatterParty {
  return { id, role, label };
}

function capacity(
  partyId: string,
  kind: PartyCapacityKind,
  conf: number,
  appliesToEvents?: string[],
): PartyCapacity {
  return { partyId, capacity: kind, confidence: conf, appliesToEvents };
}

function rel(
  partyA: string,
  partyB: string,
  type: string,
  eventIds: string[],
  conf: number,
): MatterRelationship {
  return { partyA, partyB, type, appliesToEvents: eventIds, confidence: conf };
}

function eventId(prefix: string, n: number): string {
  return `${prefix}_${n}`;
}

function withBlocking(a: MatterAmbiguity): MatterAmbiguity {
  return {
    ...a,
    blocking:
      a.blocking ??
      (a.materiality === "high" && Boolean(a.affectsIssues?.length || a.affectsRetrieval)),
  };
}

function briefEvents(input: MatterResolveInput): MatterEvent[] {
  return (input.brief?.events || [])
    .filter((e) => e.label || e.rawSpan)
    .map((e, i) => {
      const desc = (e.rawSpan || e.label || "").trim().slice(0, 240);
      return enrichEvent({
        id: eventId("brief", i + 1),
        type: "brief_event",
        description: desc,
        fact: desc,
        dateApprox: e.dateApprox?.trim(),
        participants: [],
        relationships: [],
        disputed: false,
        confidence: 0.6,
      });
    })
    .slice(0, 8);
}

function briefParties(input: MatterResolveInput): MatterParty[] {
  return (input.brief?.parties || [])
    .filter((p) => p.label)
    .map((p, i) => party(`brief_${i + 1}`, p.role || "party", p.label!.trim()))
    .slice(0, 8);
}

export function extractRelationshipModel(input: MatterResolveInput): RelationshipModel {
  const blob = [
    input.submission,
    input.clientQuestion,
    input.understanding,
    input.brief?.whatHappened,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const parties: MatterParty[] = [...briefParties(input)];
  const capacities: PartyCapacity[] = [];
  const relationships: MatterRelationship[] = [];
  const events: MatterEvent[] = [...briefEvents(input)];
  const disputeEventIds: string[] = [];
  const disputeIssueHints: RelationshipModel["disputeIssueHints"] = [];
  const ambiguities: MatterAmbiguity[] = [];

  const ensureParty = (id: string, role: string, label: string) => {
    if (!parties.some((p) => p.id === id)) parties.push(party(id, role, label));
  };

  const addDisputeEvent = (ev: MatterEvent) => {
    events.push(ev);
    disputeEventIds.push(ev.id);
  };

  const speakerAsEmployee = /\b(i (?:was |have been )?(?:dismissed|fired|sacked|made redundant)|my employer|at my work|my (?:job|boss|manager|workplace))\b/.test(
    blob,
  );
  const speakerOwnsOrganisation =
    /\b(my|our) (limited )?company\b/.test(blob) ||
    /\bthrough my (limited )?company\b/.test(blob) ||
    /\b(i am|i'm) (the )?(director|employer|owner)\b/.test(blob);
  const payrollOrStaff =
    /\b(paye|payroll|on the (?:company )?books|ending (?:her|his|their) employment|company vehicle|company car)\b/.test(
      blob,
    ) || /\b(employee|staff member) (?:who|on|is|has)\b/.test(blob);
  const speakerAsEmployer = speakerOwnsOrganisation && (payrollOrStaff || /\bemployment\b/.test(blob));
  const hasEmploymentBackdrop =
    speakerAsEmployer ||
    speakerAsEmployee ||
    /\b(employer|manager|boss|employee|at work|my work|workplace|colleague|shift)\b/.test(blob);

  let employmentEventId: string | null = null;
  if (hasEmploymentBackdrop) {
    employmentEventId = eventId("employment", 1);
    ensureParty("user", speakerAsEmployer ? "employer" : "claimant", "user");
    if (speakerAsEmployer) {
      ensureParty("counterparty_worker", "employee", "worker/PAYE staff");
      capacities.push(
        capacity("user", "employer", 0.86, [employmentEventId]),
        capacity("user", "company", 0.8, [employmentEventId]),
        capacity("counterparty_worker", "employee", 0.82, [employmentEventId]),
      );
      relationships.push(
        rel("user", "counterparty_worker", "employment", [employmentEventId], 0.86),
      );
    } else {
      ensureParty("counterparty_employer", "employer", "employer/manager");
      capacities.push(
        capacity("user", "employee", 0.7, [employmentEventId]),
        capacity("counterparty_employer", "employer", 0.7, [employmentEventId]),
      );
      relationships.push(
        rel("user", "counterparty_employer", "employment", [employmentEventId], 0.72),
      );
    }

    const employmentDispute = speakerAsEmployer
      ? payrollOrStaff || /\b(dismiss|ending .{0,20}employment|no duties|not carrying out any work)\b/.test(blob)
      : /\b(dismiss|sacked|fired|redundan|tribunal|grievance|unpaid wages|constructive)\b/.test(blob);

    addDisputeEvent(
      enrichEvent({
        id: employmentEventId,
        type: "employment",
        description: speakerAsEmployer
          ? "Employer / company employment relationship"
          : employmentDispute
            ? "Employment dispute (dismissal/wages)"
            : "Employment or workplace backdrop",
        fact: speakerAsEmployer
          ? "Employer / company employment relationship"
          : employmentDispute
            ? "Employment dispute (dismissal/wages)"
            : "Employment or workplace backdrop",
        participants: speakerAsEmployer ? ["user", "counterparty_worker"] : ["user", "counterparty_employer"],
        relationships: ["employment"],
        supportsIssues: ["employment"],
        disputed: employmentDispute,
        confidence: employmentDispute ? 0.88 : 0.55,
      }),
    );

    if (employmentDispute) {
      disputeIssueHints.push({
        slug: "employment",
        confidence: speakerAsEmployer ? 0.86 : 0.88,
        reason: speakerAsEmployer
          ? "dispute-event:employer-capacity payroll/staff"
          : "dispute-event:employment dismissal/wages",
      });
    }
  }

  if (
    /\b(divorce|family proceedings|financial (?:order|remedies)|ancillary relief|separation agreement)\b/.test(
      blob,
    )
  ) {
    const familyId = eventId("family", 1);
    ensureParty("user", "spouse", "user");
    ensureParty("counterparty_family", "former_partner", "former partner");
    relationships.push(rel("user", "counterparty_family", "family", [familyId], 0.84));
    addDisputeEvent(
      enrichEvent({
        id: familyId,
        type: "family",
        description: "Family / divorce proceedings",
        fact: "Family / divorce proceedings",
        participants: ["user", "counterparty_family"],
        relationships: ["family"],
        supportsIssues: ["family"],
        disputed: true,
        confidence: 0.86,
      }),
    );
    disputeIssueHints.push({
      slug: "family",
      confidence: 0.86,
      reason: "dispute-event:family proceedings",
    });
  }

  const soldVehicle =
    /\b(sold me|sold him|sold her|sold us)\b.{0,40}\b(used )?(car|van|vehicle)\b/.test(blob) ||
    /\b(used )?(car|van|vehicle)\b.{0,40}\b(sold me|bought from|purchase from)\b/.test(blob) ||
    (/\bemployer\b/.test(blob) &&
      /\b(sold|selling)\b/.test(blob) &&
      /\b(car|van|vehicle)\b/.test(blob) &&
      /\b(money back|broke|refund|fault)\b/.test(blob));

  if (soldVehicle) {
    const saleId = eventId("vehicle_sale", 1);
    ensureParty("user", "buyer", "user");
    const sellerId = hasEmploymentBackdrop ? "counterparty_employer" : "counterparty_seller";
    if (sellerId !== "counterparty_employer") ensureParty(sellerId, "seller", "seller");

    capacities.push(
      capacity(sellerId, "seller", 0.88, [saleId]),
      capacity("user", "buyer", 0.88, [saleId]),
      capacity("user", "consumer", 0.75, [saleId]),
    );
    relationships.push(rel("user", sellerId, "seller_buyer", [saleId], 0.9));

    const defective = /\b(broke|fault|refund|money back|repair)\b/.test(blob);
    addDisputeEvent(
      enrichEvent({
        id: saleId,
        type: "vehicle_sale",
        description: defective ? "Used vehicle sale — defective / refund dispute" : "Private used vehicle sale",
        fact: defective ? "Used vehicle sale — defective / refund dispute" : "Private used vehicle sale",
        participants: ["user", sellerId],
        relationships: ["seller_buyer"],
        supportsIssues: defective
          ? ["consumer_vehicle_repair", "consumer"]
          : ["consumer_vehicle_repair"],
        disputed: true,
        confidence: 0.9,
      }),
    );

    disputeIssueHints.push({
      slug: "consumer_vehicle_repair",
      confidence: 0.88,
      reason: "dispute-event:vehicle_sale seller_buyer defective_goods",
    });

    ambiguities.push(
      withBlocking({
        question: "Was the seller acting as a motor trader when they sold the vehicle?",
        whyItMatters:
          "Consumer Rights Act protections depend on whether the seller was acting in the course of business.",
        materiality: "high",
        affectsIssues: ["consumer_vehicle_repair", "consumer"],
        affectsRetrieval: true,
        reason: "capacity:trader vs private seller on vehicle_sale",
      }),
    );
  }

  const vehiclePurchaseDispute =
    !soldVehicle &&
    !/\bcompany (?:vehicle|car)\b/.test(blob) &&
    /\b(bought|purchase[d]?)\b.{0,40}\b(van|car|vehicle)\b/.test(blob) &&
    /\b(broke|fault|refund|dealer|mot\b|repair)\b/.test(blob);
  const vehicleRepair =
    !soldVehicle &&
    ((/\b(garage|repair|mot\b|workmanship)\b/.test(blob) && /\b(van|car|vehicle)\b/.test(blob)) ||
      vehiclePurchaseDispute);

  if (vehicleRepair) {
    const repairId = eventId("vehicle_repair", 1);
    const relType = vehiclePurchaseDispute ? "seller_buyer" : "consumer_trader_services";
    ensureParty("user", "customer", "user");
    ensureParty("trader_garage", "trader", "garage/dealer");
    capacities.push(
      capacity("trader_garage", "trader", 0.85, [repairId]),
      capacity("user", "consumer", 0.75, [repairId]),
      capacity("user", "owner", 0.7, [repairId]),
      capacity("user", "buyer", 0.7, [repairId]),
    );
    relationships.push(rel("user", "trader_garage", relType, [repairId], 0.85));

    if (/\blimited company|through (my|our) (ltd|limited|company)\b/.test(blob)) {
      capacities.push(capacity("user", "company", 0.82, [repairId]));
      ambiguities.push(
        withBlocking({
          question: "Was the van bought or repaired in a personal capacity or through your company?",
          whyItMatters: "Consumer rights may not apply to company purchases in the same way.",
          materiality: "high",
          affectsIssues: ["consumer_vehicle_repair", "consumer"],
          affectsRetrieval: true,
          reason: "capacity:company vs consumer",
        }),
      );
    } else if (/\bfor (my|our) .{0,20}(business|work)\b|\buse it for work\b|\bplumbing business\b/.test(blob)) {
      ambiguities.push(
        withBlocking({
          question: "Did you buy the vehicle as a consumer, or mainly for business use?",
          whyItMatters: "Business use can change which consumer protections apply.",
          materiality: "high",
          affectsIssues: ["consumer_vehicle_repair", "consumer"],
          affectsRetrieval: true,
          reason: "capacity:business-use vehicle",
        }),
      );
    }

    addDisputeEvent(
      enrichEvent({
        id: repairId,
        type: vehiclePurchaseDispute ? "vehicle_purchase" : "vehicle_repair",
        description: vehiclePurchaseDispute
          ? "Vehicle purchase / dealer dispute"
          : "Vehicle repair / garage services",
        fact: vehiclePurchaseDispute
          ? "Vehicle purchase / dealer dispute"
          : "Vehicle repair / garage services",
        participants: ["user", "trader_garage"],
        relationships: [relType],
        supportsIssues: ["consumer_vehicle_repair"],
        disputed: true,
        confidence: 0.84,
      }),
    );

    disputeIssueHints.push({
      slug: "consumer_vehicle_repair",
      confidence: 0.84,
      reason: `dispute-event:${relType}`,
    });
  }

  if (/\b(landlord|tenant|tenancy|section 21|deposit|mould|disrepair)\b/.test(blob)) {
    const housingId = eventId("housing", 1);
    ensureParty("user", "tenant", "user");
    ensureParty("counterparty_landlord", "landlord", "landlord");
    capacities.push(
      capacity("user", "tenant", 0.88, [housingId]),
      capacity("counterparty_landlord", "landlord", 0.88, [housingId]),
    );
    relationships.push(rel("user", "counterparty_landlord", "landlord_tenant", [housingId], 0.9));

    addDisputeEvent(
      enrichEvent({
        id: housingId,
        type: "housing",
        description: "Landlord / tenant housing dispute",
        fact: "Landlord / tenant housing dispute",
        participants: ["user", "counterparty_landlord"],
        relationships: ["landlord_tenant"],
        supportsIssues: ["housing"],
        disputed: true,
        confidence: 0.88,
      }),
    );

    disputeIssueHints.push({
      slug: "housing",
      confidence: 0.88,
      reason: "dispute-event:landlord_tenant",
    });

    if (
      hasEmploymentBackdrop &&
      /\b(manager|boss|employer).{0,40}(landlord|notice|flat)\b|\b(landlord).{0,40}(manager|boss|employer)\b/.test(
        blob,
      )
    ) {
      ambiguities.push(
        withBlocking({
          question: "Is the live problem the tenancy (notice/repairs) or something at work, or both?",
          whyItMatters: "Landlord and employer roles can create separate legal relationships.",
          materiality: "high",
          affectsIssues: ["housing", "employment"],
          affectsRetrieval: true,
          reason: "dual-capacity:landlord+employer",
        }),
      );
    }
  }

  if (
    /\b(neighbour|neighbor)\b/.test(blob) &&
    /\b(bark|noise|nuisance|dog|loud|boundary|driveway)\b/.test(blob)
  ) {
    const neighbourId = eventId("neighbour", 1);
    ensureParty("user", "resident", "user");
    ensureParty("counterparty_neighbour", "neighbour", "neighbour");
    relationships.push(rel("user", "counterparty_neighbour", "neighbours", [neighbourId], 0.8));

    addDisputeEvent(
      enrichEvent({
        id: neighbourId,
        type: "neighbour_dispute",
        description: "Neighbour nuisance or access dispute",
        fact: "Neighbour nuisance or access dispute",
        participants: ["user", "counterparty_neighbour"],
        relationships: ["neighbours"],
        supportsIssues: ["neighbour_dispute"],
        disputed: true,
        confidence: 0.8,
      }),
    );

    disputeIssueHints.push({
      slug: "neighbour_dispute",
      confidence: 0.8,
      reason: "dispute-event:neighbours",
    });
  }

  if (/\b(pcn|parking ticket|penalty charge|staff car park)\b/.test(blob)) {
    const pcnId = eventId("parking", 1);
    ensureParty("user", "motorist", "user");
    ensureParty("authority", "authority", "council/operator");
    capacities.push(capacity("user", "driver", 0.8, [pcnId]));
    relationships.push(rel("user", "authority", "enforcement", [pcnId], 0.85));

    addDisputeEvent(
      enrichEvent({
        id: pcnId,
        type: "parking_pcn",
        description: "Parking / PCN enforcement",
        fact: "Parking / PCN enforcement",
        participants: ["user", "authority"],
        relationships: ["enforcement"],
        supportsIssues: ["parking_pcn"],
        disputed: true,
        confidence: 0.9,
      }),
    );

    disputeIssueHints.push({
      slug: "parking_pcn",
      confidence: 0.9,
      reason: "dispute-event:parking_enforcement",
    });
  }

  if (/\b(crash|crashed|collision|accident)\b/.test(blob) && /\b(car|van|vehicle)\b/.test(blob)) {
    const crashId = eventId("collision", 1);
    ensureParty("user", "owner", "user");
    capacities.push(
      capacity("user", "owner", 0.75, [crashId]),
      capacity("user", "driver", 0.55, [crashId]),
    );

    addDisputeEvent(
      enrichEvent({
        id: crashId,
        type: "collision",
        description: "Vehicle collision / insurance dispute",
        fact: "Vehicle collision / insurance dispute",
        participants: ["user", "counterparty_employer"].filter((p) =>
          hasEmploymentBackdrop ? true : p === "user",
        ),
        relationships: hasEmploymentBackdrop ? ["employment"] : [],
        supportsIssues: ["consumer"],
        disputed: true,
        confidence: 0.5,
      }),
    );

    ambiguities.push(
      withBlocking({
        question: "Whose insurance applies, and was this a work journey or a private lift?",
        whyItMatters: "Employment backdrop and motor insurance are different legal relationships.",
        materiality: "high",
        affectsIssues: ["consumer", "employment"],
        affectsRetrieval: true,
        reason: "relationship_uncertain:collision",
      }),
    );

    disputeIssueHints.push({
      slug: "consumer",
      confidence: 0.45,
      reason: "dispute-event:collision — relationship uncertain",
    });
  }

  if (/\b(builder|plumber|electrician|trader)\b/.test(blob) && /\b(hired|works|unfinished|extension)\b/.test(blob)) {
    const svcId = eventId("services", 1);
    ensureParty("user", "customer", "user");
    ensureParty("trader_services", "trader", "trader");
    capacities.push(
      capacity("user", "consumer", 0.85, [svcId]),
      capacity("trader_services", "trader", 0.85, [svcId]),
    );
    relationships.push(rel("user", "trader_services", "consumer_trader_services", [svcId], 0.88));

    addDisputeEvent(
      enrichEvent({
        id: svcId,
        type: "consumer_services",
        description: "Consumer services / builder works",
        fact: "Consumer services / builder works",
        participants: ["user", "trader_services"],
        relationships: ["consumer_trader_services"],
        supportsIssues: ["consumer_services"],
        disputed: true,
        confidence: 0.86,
      }),
    );

    disputeIssueHints.push({
      slug: "consumer_services",
      confidence: 0.86,
      reason: "dispute-event:consumer_trader_services",
    });
  }

  if (!disputeEventIds.length && blob.replace(/\s+/g, " ").trim().length < 160) {
    ambiguities.push(
      withBlocking({
        question: "What happened between you and the other person?",
        whyItMatters: "The submission does not establish a legally relevant relationship or event.",
        materiality: "high",
        affectsRetrieval: true,
        reason: "insufficient_facts:no dispute event",
      }),
    );
  }

  return {
    parties: parties.slice(0, 10),
    capacities: capacities.slice(0, 16),
    relationships: relationships.slice(0, 12),
    events: events.slice(0, 16),
    disputeEventIds,
    disputeIssueHints,
    ambiguities: ambiguities.slice(0, 5),
  };
}

export function preferDisputeIssues(
  taxonomyPrimary: { slug: string; confidence: number; reason: string }[],
  taxonomySecondary: { slug: string; confidence: number; reason: string }[],
  model: RelationshipModel,
): {
  primary: { slug: string; confidence: number; reason: string }[];
  secondary: { slug: string; confidence: number; reason: string }[];
} {
  const hints = [...model.disputeIssueHints].sort((a, b) => b.confidence - a.confidence);
  if (!hints.length) {
    return { primary: taxonomyPrimary, secondary: taxonomySecondary };
  }

  const mergeSecondary = (
    primarySlug: string,
    extra: { slug: string; confidence: number; reason: string }[],
  ) =>
    [...extra, ...taxonomyPrimary, ...taxonomySecondary]
      .filter((i) => i.slug !== primarySlug)
      .filter((i, idx, arr) => arr.findIndex((x) => x.slug === i.slug) === idx)
      .slice(0, 4);

  const userCaps = new Set(
    model.capacities.filter((c) => c.partyId === "user").map((c) => c.capacity),
  );
  const uniqueHints = hints.filter(
    (h, i) => hints.findIndex((x) => x.slug === h.slug) === i,
  );

  if (userCaps.has("employer") && uniqueHints.some((h) => h.slug === "employment")) {
    const emp =
      uniqueHints.find((h) => h.slug === "employment") || {
        slug: "employment",
        confidence: 0.84,
        reason: "capacity:employer",
      };
    return { primary: [emp], secondary: mergeSecondary("employment", uniqueHints) };
  }

  const disputedSlugs = new Set(
    model.events.filter((e) => e.disputed).flatMap((e) => e.supportsIssues || []),
  );
  if (disputedSlugs.size) {
    const disputedHint = uniqueHints.find((h) => disputedSlugs.has(h.slug));
    if (disputedHint && (!taxonomyPrimary[0] || !disputedSlugs.has(taxonomyPrimary[0].slug))) {
      return {
        primary: [{ ...disputedHint, reason: `${disputedHint.reason}; disputed-event` }],
        secondary: mergeSecondary(disputedHint.slug, uniqueHints),
      };
    }
  }

  if (uniqueHints.length >= 2 && !model.relationships.some((r) => r.type === "seller_buyer")) {
    const taxSlugEarly = taxonomyPrimary[0]?.slug;
    const primary =
      (taxSlugEarly && uniqueHints.find((h) => h.slug === taxSlugEarly)) || uniqueHints[0]!;
    return { primary: [primary], secondary: mergeSecondary(primary.slug, uniqueHints) };
  }

  const topHint = hints[0]!;
  const taxSlug = taxonomyPrimary[0]?.slug;
  const hasSellerBuyer = model.relationships.some((r) => r.type === "seller_buyer");

  if (taxSlug === "employment" && hasSellerBuyer) {
    const primary = [topHint];
    const secondary = [
      ...hints.slice(1),
      ...(taxonomyPrimary[0]
        ? [
            {
              ...taxonomyPrimary[0],
              confidence: Math.min(taxonomyPrimary[0].confidence, 0.35),
              reason: `backdrop:${taxonomyPrimary[0].reason}`,
            },
          ]
        : []),
      ...taxonomySecondary,
    ]
      .filter((i) => i.slug !== topHint.slug)
      .slice(0, 4);
    return { primary, secondary };
  }

  if (!taxSlug && topHint.confidence >= 0.7) {
    return { primary: [topHint], secondary: hints.slice(1).slice(0, 3) };
  }

  if (model.events.some((e) => e.type === "collision") && taxSlug !== "parking_pcn") {
    if (!taxSlug || taxSlug === "employment") {
      return {
        primary: [{ ...topHint, confidence: Math.min(topHint.confidence, 0.5) }],
        secondary: taxonomyPrimary.concat(taxonomySecondary).slice(0, 3),
      };
    }
  }

  if (!taxSlug) {
    return { primary: [topHint], secondary: hints.slice(1).slice(0, 3) };
  }

  if (hints.some((h) => h.slug === taxSlug)) {
    return {
      primary: taxonomyPrimary.map((p, i) =>
        i === 0 ? { ...p, reason: `${p.reason}; event-confirm` } : p,
      ),
      secondary: mergeSecondary(taxSlug, hints),
    };
  }

  return { primary: taxonomyPrimary, secondary: taxonomySecondary };
}
