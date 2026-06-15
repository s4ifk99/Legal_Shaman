export type CoverageDataSourceStatus = {
  ok: boolean;
  rowsLoaded: number;
  error?: string;
};

export type CoverageDataSources = {
  sraOrganisations: CoverageDataSourceStatus;
  providerEnrichments: CoverageDataSourceStatus;
};

export type CoverageHealth = {
  expectedSraRows: number | null;
  loadedSraRows: number;
  expectedEnrichmentRows: number | null;
  loadedEnrichmentRows: number;
  warnings: string[];
};

export type CoverageLoadContext = {
  dataSources: CoverageDataSources;
  health: CoverageHealth;
  sraAvailable: boolean;
  enrichmentsAvailable: boolean;
};
