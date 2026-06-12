/**
 * Typesense env + document mapping for directory listings (safe for CLI scripts; no server-only).
 */
import Typesense from "typesense";
import type { Listing } from "@/lib/data";
import {
  resolveTypesenseNodeConfig,
  typesenseTlsErrorHint,
} from "@/lib/search-index/connectivity-hints";
import {
  getListingSearchDocument,
} from "@/lib/search/listing-document";

type TsClient = InstanceType<typeof Typesense.Client>;

export type ListingTypesenseDocument = {
  id: string;
  searchText?: string;
  businessName?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  city?: string;
  postcode?: string;
  phone?: string;
  isFree: boolean;
  isLegalAid?: boolean;
};

function typesenseHost(): string | null {
  return resolveTypesenseNodeConfig()?.host ?? null;
}

function typesenseApiKey(): string | null {
  return process.env.TYPESENSE_API_KEY?.trim() || null;
}

export function typesenseListingsConfigured(): boolean {
  return Boolean(typesenseHost() && typesenseApiKey());
}

export function buildTypesenseListingsClientFromEnv(options?: {
  connectionTimeoutSeconds?: number;
}): TsClient | null {
  const node = resolveTypesenseNodeConfig();
  if (!node) return null;
  return new Typesense.Client({
    nodes: [{ host: node.host, port: node.port, protocol: node.protocol }],
    apiKey: process.env.TYPESENSE_API_KEY!.trim(),
    connectionTimeoutSeconds: options?.connectionTimeoutSeconds ?? 15,
  });
}

export { typesenseTlsErrorHint };

export function listingToTypesenseDocument(listing: Listing): ListingTypesenseDocument {
  return {
    id: listing.id,
    searchText: getListingSearchDocument(listing),
    businessName: listing.businessName,
    description: listing.description,
    category: listing.category,
    subcategory: listing.subcategory,
    city: listing.city,
    postcode: listing.postcode,
    phone: listing.phone,
    isFree: listing.isFree,
    isLegalAid: listing.isLegalAid === true,
  };
}
