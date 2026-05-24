import {
  CANVAS_REALTIME_INSTRUCTIONS,
  CANVAS_REALTIME_TOOLS,
  REALTIME_VOICE,
} from "@/lib/realtime/canvas-tools";
import { getRealtimeModelPreset } from "@/lib/realtime/model-presets";

export const runtime = "nodejs";

function extractAnswerSdp(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.sdp === "string") return record.sdp;
  if (record.answer && typeof record.answer === "object") {
    const answer = record.answer as Record<string, unknown>;
    if (typeof answer.sdp === "string") return answer.sdp;
  }
  return null;
}

function buildSessionConfig(model: string | null | undefined) {
  const realtimeModel = getRealtimeModelPreset(model).id;

  return {
    type: "realtime",
    model: realtimeModel,
    instructions: CANVAS_REALTIME_INSTRUCTIONS,
    output_modalities: ["audio"],
    audio: {
      input: {
        turn_detection: {
          type: "semantic_vad",
          interrupt_response: true,
          create_response: true,
          eagerness: "medium",
        },
        transcription: {
          model: "gpt-4o-mini-transcribe",
        },
      },
      output: {
        voice: REALTIME_VOICE,
      },
    },
    tools: CANVAS_REALTIME_TOOLS,
    tool_choice: "auto",
  };
}

export async function POST(request: Request) {
  let sdp = "";
  let requestApiKey = "";
  let requestModel = "";
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as {
        sdp?: string;
        apiKey?: string;
        model?: string;
      };
      sdp = body.sdp ?? "";
      requestApiKey = body.apiKey ?? "";
      requestModel = body.model ?? "";
    } catch {
      return Response.json(
        { error: "request body must be valid JSON" },
        { status: 400 },
      );
    }
  } else {
    sdp = await request.text();
    requestApiKey = request.headers.get("x-openai-api-key") ?? "";
    requestModel = request.headers.get("x-openai-realtime-model") ?? "";
  }

  if (!sdp.trim()) {
    return Response.json(
      { error: "sdp is required and must be a non-empty string" },
      { status: 400 },
    );
  }

  const apiKey = requestApiKey.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      {
        error:
          "OpenAI API key not configured. Add OPENAI_API_KEY to .env or paste a Realtime key in Settings.",
      },
      { status: 400 },
    );
  }

  const formData = new FormData();
  formData.set("sdp", sdp);
  formData.set("session", JSON.stringify(buildSessionConfig(requestModel)));

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    if (!response.ok) {
      return Response.json(
        {
          error: `Realtime session failed (${response.status}): ${text.slice(
            0,
            500,
          )}`,
        },
        { status: 502 },
      );
    }

    if (contentType.includes("application/json")) {
      const answerSdp = extractAnswerSdp(JSON.parse(text));
      if (!answerSdp) {
        return Response.json(
          { error: "Realtime session response missing SDP answer" },
          { status: 502 },
        );
      }
      return new Response(answerSdp, {
        headers: {
          "Content-Type": "application/sdp",
          "Cache-Control": "no-store, max-age=0",
        },
      });
    }

    return new Response(text, {
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create session";
    return Response.json({ error: message }, { status: 502 });
  }
}
