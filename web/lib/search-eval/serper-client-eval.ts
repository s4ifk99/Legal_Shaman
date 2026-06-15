import {
  isSerperApiConfigured,
  parseSerperOrganicPayload,
  searchSerperOrganic,
} from "@/lib/search/serper-client";
import {
  mapSerperOrganicToFirmHits,
  planFirmWebSearchProvider,
} from "@/lib/provider-osint/firm-web-search";

export async function runSerperClientEval(): Promise<number> {
  let failed = 0;
  const fail = (msg: string) => {
    console.error(`FAIL serper-client: ${msg}`);
    failed++;
  };

  const parsed = parseSerperOrganicPayload({
    organic: [
      {
        title: "Example Solicitors LLP",
        link: "https://www.example-solicitors.co.uk/about",
        snippet: "Law firm",
      },
      { title: "Bad", link: "not-a-url", snippet: "" },
    ],
  });
  if (parsed.length !== 1 || parsed[0]!.link !== "https://www.example-solicitors.co.uk/about") {
    fail("parseSerperOrganicPayload should keep valid organic rows only");
  }
  if (parsed[0]!.sourceProvider !== "serper") {
    fail("parsed rows must have sourceProvider serper");
  }

  const hits = mapSerperOrganicToFirmHits(parsed, "test query");
  if (!hits[0]?.url.includes("example-solicitors.co.uk")) {
    fail("mapSerperOrganicToFirmHits should normalize to origin");
  }

  const savedKey = process.env.SERPER_API_KEY;
  delete process.env.SERPER_API_KEY;
  if (isSerperApiConfigured()) {
    fail("isSerperApiConfigured should be false when key unset");
  }
  const disabled = await searchSerperOrganic({ q: "test", skipCache: true });
  if (!disabled.disabled || disabled.ok) {
    fail("missing key should return disabled status");
  }
  const plan = planFirmWebSearchProvider();
  if (plan.apiConfigured || plan.primary !== "duckduckgo") {
    fail("without key primary provider should be duckduckgo");
  }
  if (disabled.error !== "serper_api_key_missing") {
    fail("missing key should expose serper_api_key_missing");
  }

  if (savedKey) process.env.SERPER_API_KEY = savedKey;
  const planWith = planFirmWebSearchProvider();
  if (savedKey && (!planWith.apiConfigured || planWith.primary !== "serper")) {
    fail("with key configured primary should be serper");
  }

  const logs: string[] = [];
  const logSpy = console.warn;
  console.warn = (msg: string) => {
    logs.push(msg);
  };
  await searchSerperOrganic({ q: "test failure log", skipCache: true });
  console.warn = logSpy;
  const blob = logs.join("");
  if (savedKey && blob.includes(savedKey)) {
    fail("logs must not contain API key");
  }

  if (failed === 0) {
    console.info("PASS serper-client eval");
  }
  return failed;
}
