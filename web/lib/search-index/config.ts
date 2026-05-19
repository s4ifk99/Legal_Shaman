export const LEGAL_ENTITIES_COLLECTION = "legal_entities";

export function typesenseConfigured(): boolean {
  return Boolean(
    process.env.TYPESENSE_HOST?.trim() && process.env.TYPESENSE_API_KEY?.trim(),
  );
}
