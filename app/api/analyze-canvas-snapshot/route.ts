import OpenAI from "openai";
import { NextRequest } from "next/server";

const DEFAULT_VISION_MODEL =
  process.env.OPENAI_VISION_MODEL ||
  process.env.OPENAI_DIAGRAM_MODEL ||
  "gpt-5.4-mini";

function extractJSON(content: string) {
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const start = content.indexOf("{");
  if (start === -1) return content;
  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return content.slice(start);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      imageUrl?: string;
      reason?: string;
      detail?: "low" | "auto" | "high" | "original";
      canvas?: unknown;
    };
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";

    if (!imageUrl.startsWith("data:image/")) {
      return Response.json(
        { error: "imageUrl must be a data URL snapshot" },
        { status: 400 },
      );
    }

    const apiKey =
      request.headers.get("x-openai-api-key")?.trim() ||
      process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      return Response.json(
        {
          error:
            "OpenAI API key not configured for visual canvas analysis.",
        },
        { status: 400 },
      );
    }

    const client = new OpenAI({ apiKey });
    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "Check whether the drawing is visually correct.";
    const detail = body.detail ?? "low";
    const response = await client.responses.create({
      model: DEFAULT_VISION_MODEL,
      input: [
        {
          role: "system",
          content:
            "You are a strict visual QA checker for an Excalidraw-style whiteboard. Return only valid JSON.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Inspect the canvas screenshot. Reason: ${reason}

Return JSON:
{
  "ok": boolean,
  "summary": "one concise sentence",
  "issues": [
    {
      "severity": "low" | "medium" | "high",
      "element": "short visual target",
      "problem": "what is visually wrong",
      "suggestion": "specific correction"
    }
  ],
  "positive": ["what looks correct"]
}

Check for overlapping text, labels crossing shapes or arrows, offscreen content, unreadable handwriting, poor spacing, wrong shape identity, and whether the result satisfies the user's instruction. Use the structured canvas summary only as a hint; trust the screenshot for visual layout.

Canvas summary:
${JSON.stringify(body.canvas ?? null).slice(0, 5000)}`,
            },
            {
              type: "input_image",
              image_url: imageUrl,
              detail,
            },
          ],
        },
      ],
      temperature: 0,
      max_output_tokens: 700,
    });

    const text = response.output_text;
    if (!text) {
      return Response.json(
        { error: "Visual analysis returned empty output" },
        { status: 502 },
      );
    }

    try {
      return Response.json(JSON.parse(extractJSON(text)));
    } catch {
      return Response.json({
        ok: false,
        summary: text.slice(0, 800),
        issues: [
          {
            severity: "medium",
            element: "canvas",
            problem: "Visual analysis was not valid JSON.",
            suggestion: "Use the summary as the visual QA result.",
          },
        ],
        positive: [],
      });
    }
  } catch (error) {
    console.error("analyze-canvas-snapshot error:", error);
    return Response.json(
      { error: "Failed to analyze canvas snapshot" },
      { status: 500 },
    );
  }
}
