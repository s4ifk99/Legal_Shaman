import "./load-dotenv";

import { serperPing } from "@/lib/search/serper-client";

async function main() {
  const result = await serperPing();
  console.info(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
