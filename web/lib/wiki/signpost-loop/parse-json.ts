/** Extract a JSON object from LLM output (fences, thinking tags, trailing prose). */
export function parseJsonFromLlm(raw: string): unknown {
  let text = String(raw || "").trim();
  if (!text) throw new Error("empty LLM JSON");

  // Qwen / OpenRouter thinking wrappers and fences
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim();
  text = text.replace(/^[\s\S]*?(?=\{)/, ""); // drop leading prose before first {

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = text.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // Trailing commas / soft repair / truncated trailing junk
        const repaired = slice
          .replace(/,\s*([}\]])/g, "$1")
          .replace(/[\u201c\u201d]/g, '"')
          .replace(/\n/g, " ");
        return JSON.parse(repaired);
      }
    }
    throw new Error("invalid LLM JSON");
  }
}

/** Salvage admit judgments when the model emits broken JSON in `because` strings. */
export function salvageAdmitJudgments(raw: string): Array<{
  facetId: string;
  urlOrId: string;
  relevant: boolean;
  because: string;
}> {
  const out: Array<{
    facetId: string;
    urlOrId: string;
    relevant: boolean;
    because: string;
  }> = [];
  const re =
    /\{\s*"facetId"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"urlOrId"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"relevant"\s*:\s*(true|false)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out.push({
      facetId: m[1]!.replace(/\\"/g, '"'),
      urlOrId: m[2]!.replace(/\\"/g, '"'),
      relevant: m[3] === "true",
      because: "",
    });
  }
  return out;
}
