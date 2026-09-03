export type {
  AmbiguityMateriality,
  MatterAmbiguity,
  MatterDiagnostics,
  MatterEvent,
  MatterEvidenceSet,
  MatterFrame,
  MatterIssue,
  MatterParty,
  MatterRelationship,
  MatterResolutionStatus,
  MatterResolveInput,
  MatterResolveResult,
  MatterRetrievalHit,
  PartyCapacity,
  PartyCapacityKind,
} from "./types";
export { MatterEngine, resolveMatterFrame } from "./resolve";
export { KnowledgeRetriever, matterEvidenceToWikiHits } from "./retrieve";
export { formatMatterInspector } from "./inspector";
export type { MatterInspectorView } from "./inspector";
export { extractRelationshipModel, preferDisputeIssues } from "./relationships";
export { buildRetrievalPlan, syncEventIssueLinks, enrichEvent } from "./retrieval-plan";
export type { RetrievalIntentTrace } from "./retrieval-plan";
export {
  buildConceptRetrievalPlan,
  extractStoryKeyphrases,
  listConceptClusterIds,
  shouldSuppressSlugDefaults,
} from "./conceptRetrievalPlan";
export type { ConceptRetrievalPlan } from "./conceptRetrievalPlan";
export {
  coverageSlotsFrom,
  groupBySlot,
  matchingSlotIds,
  primaryMatterSlug,
  rankByCoverage,
  titleCoversGraph,
  uncoveredSlots,
} from "./coverageSlots";
export type { CoverageSlot } from "./coverageSlots";
export {
  WIKI_AREA_INTENT_DEFAULTS,
  areaForSlug,
  listWikiAreas,
  SLUG_INTENT_DEFAULTS,
} from "./areaIntentDefaults";
export type { WikiAreaIntentDefault } from "./areaIntentDefaults";
export {
  employmentIsBackdropOnly,
  intentAllowedOnGraph,
  titleAllowedOnGraph,
} from "./issueGraphHits";
export {
  filterAdmissibleTitles,
  freeHelpAdmissibleOnGeometry,
  graphIsWeakForHits,
  isNeighbourAttractorTitle,
  sraOrganisationAdmissible,
  storyLooksAmbiguousSeizedDevice,
  storyLooksEmployerSeizedKit,
  titleAdmissibleOnGeometry,
} from "./graphAdmissibility";
export type { MatterGateResult, EvidenceGateResult } from "./types";
export {
  ISSUE_RETRIEVAL_INTENTS,
  ISSUE_RETRIEVAL_SCOPES,
  intentsForIssueSlug,
  plannedIntentsForFrame,
  retrievalScopeForSlugs,
} from "./scopes";
