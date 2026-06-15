import {
  assertMinimalSraNamePatch,
  buildSraNamePatchRecord,
  chooseSraIndexTitle,
  SRA_NAME_PATCH_FIELD_DENylist,
} from "@/lib/search-index/sra-title-source";

export function runSraTitleSourceEval(): number {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL sra-title-source: ${msg}`);
    failed++;
  };

  const austins = chooseSraIndexTitle({
    sraId: "1002231",
    searchText: "1002231\nAUSTINS SOLICITORS\nNOTTINGHAM",
    orgDisplayName: "Organisation 1002231",
    organisationName: "",
    tradingName: "",
    firmName: "",
    businessName: "Organisation 1002231",
    firmBusinessName: "AUSTINS SOLICITORS",
  });
  if (austins.title !== "AUSTINS SOLICITORS" || austins.reason !== "firm_business_name") {
    fail(`sra:1002231 expected firm business_name, got "${austins.title}" (${austins.reason})`);
  }

  const placeholderVsFirm = chooseSraIndexTitle({
    sraId: "404976",
    searchText: "404976",
    orgDisplayName: "London, WC2H 9JQ",
    organisationName: "AUSTINS SOLICITORS",
    tradingName: "",
    firmName: "",
    businessName: "Organisation 404976",
    firmBusinessName: "AUSTINS SOLICITORS LLP",
  });
  if (placeholderVsFirm.title !== "AUSTINS SOLICITORS LLP") {
    fail(`placeholder displayName must not override firm.businessName (got "${placeholderVsFirm.title}")`);
  }
  if (placeholderVsFirm.reason !== "firm_business_name") {
    fail(`expected firm_business_name reason, got ${placeholderVsFirm.reason}`);
  }

  const patch = buildSraNamePatchRecord({
    entityId: "sra:1002231",
    title: "AUSTINS SOLICITORS",
    includeSearchText: true,
    searchText: "1002231\nAUSTINS SOLICITORS",
  });
  try {
    assertMinimalSraNamePatch(patch);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  for (const key of SRA_NAME_PATCH_FIELD_DENylist) {
    if (key in patch) fail(`name patch must not include ${key}`);
  }
  const allowedKeys = new Set(["id", "title", "displayName", "exactTitle", "searchText"]);
  for (const key of Object.keys(patch)) {
    if (!allowedKeys.has(key)) fail(`unexpected patch field ${key}`);
  }

  const titleOnly = buildSraNamePatchRecord({ entityId: "sra:1", title: "Acme LLP" });
  if (Object.keys(titleOnly).join(",") !== "id,title,displayName,exactTitle") {
    fail(`default patch should be title-only fields, got ${Object.keys(titleOnly).join(",")}`);
  }

  return failed;
}
