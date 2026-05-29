-- DropIndex
DROP INDEX "lawyer_bio_trgm_idx";

-- DropIndex
DROP INDEX "lawyer_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "sra_org_business_name_trgm_idx";

-- DropIndex
DROP INDEX "sra_org_embedding_hnsw_idx";

-- DropIndex
DROP INDEX "sra_org_search_text_trgm_idx";

-- RenameIndex
ALTER INDEX "provider_extracted_fields_entity_id_field_name_extracted_value_" RENAME TO "provider_extracted_fields_entity_id_field_name_extracted_va_key";

-- RenameIndex
ALTER INDEX "search_ranking_signals_entity_id_entity_source_practice_area_ci" RENAME TO "search_ranking_signals_entity_id_entity_source_practice_are_key";
