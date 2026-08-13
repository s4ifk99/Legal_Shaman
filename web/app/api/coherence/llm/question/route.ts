import { NextResponse } from "next/server";

import { coherenceOpenRouterConfig } from "@/lib/coherence/config";
import { coherenceApiGuard } from "@/lib/coherence/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;
  const { apiKey, model } = coherenceOpenRouterConfig();
  return NextResponse.json({ configured: Boolean(apiKey), model });
}

export async function POST(req: Request) {
  const blocked = coherenceApiGuard();
  if (blocked) return blocked;

  const { apiKey, model, siteUrl, siteName } = coherenceOpenRouterConfig();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY not set", fallback: true },
      { status: 503 },
    );
  }

  let body: { system?: string; user?: string };
  try {
    body = (await req.json()) as { system?: string; user?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json", fallback: true }, { status: 400 });
  }

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": siteUrl,
        "X-Title": siteName,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: body.system ?? "" },
          { role: "user", content: body.user ?? "" },
        ],
      }),
    });

    const data = (await upstream.json()) as {
      error?: { message?: string };
      choices?: { message?: { content?: string } }[];
    };

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: data.error?.message || "OpenRouter request failed",
          fallback: true,
        },
        { status: upstream.status },
      );
    }

    return NextResponse.json({
      content: data.choices?.[0]?.message?.content ?? "",
      model,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Proxy error",
        fallback: true,
      },
      { status: 500 },
    );
  }
}
