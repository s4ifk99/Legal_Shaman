/**
 * One GET to SRA GetAll — verifies subscription key and shows HTTP status + body preview.
 * Run: cd web && npm run sra:probe
 */
import "./load-dotenv";

const URL =
  process.env.SRA_ORGANISATIONS_URL?.trim() ||
  "https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/GetAll";

async function main() {
  const key = process.env.SRA_APIM_SUBSCRIPTION_KEY?.trim();
  if (!key) {
    console.error("Missing SRA_APIM_SUBSCRIPTION_KEY in .env / .env.local or environment.");
    console.error("Subscribe at https://sra-prod-apim.developer.azure-api.net and copy the primary key.");
    process.exit(1);
  }

  console.log("GET", URL);
  const res = await fetch(URL, {
    headers: {
      "Cache-Control": "no-cache",
      "Ocp-Apim-Subscription-Key": key,
      "Accept-Encoding": "gzip",
    },
  });

  const text = await res.text();
  let preview = text.slice(0, 800);
  try {
    const j = JSON.parse(text) as unknown;
    preview = JSON.stringify(j, null, 2).slice(0, 1200);
  } catch {
    // keep raw preview
  }

  console.log("HTTP", res.status, res.statusText);
  console.log("Content-Type:", res.headers.get("content-type") ?? "(none)");
  console.log("Body preview:\n", preview);

  if (res.status === 401) {
    console.error(
      "\n401 = Access denied. Regenerate the key in the developer portal or confirm you subscribed to SRA Data Share API V1.",
    );
    process.exit(1);
  }
  if (res.status === 403) {
    console.error(
      "\n403 = Forbidden — subscription may be for a different product, or key disabled.",
    );
    process.exit(1);
  }
  if (!res.ok) {
    process.exit(1);
  }

  console.log("\nOK — SRA API accepted the subscription key for this URL.");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
