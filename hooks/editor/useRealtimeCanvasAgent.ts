"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "@/lib/db";
import type { ExcalidrawCanvasHandle } from "@/components/editor/ExcalidrawCanvas";
import type { ExcalidrawElement, GraphResponse } from "@/types/diagram";
import type { Diagram } from "@/types/library";
import type { UserSettings } from "@/hooks/useUserSettings";
import {
  getRealtimeModelPreset,
  type RealtimeModelId,
} from "@/lib/realtime/model-presets";
import {
  normalizePlaybackMode,
  playDiagramOnCanvas,
  prepareGeneratedSection,
  resolveDiagramPlacement,
  type DiagramPlaybackMode,
} from "@/lib/render/playback";

type AgentStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "thinking"
  | "tool"
  | "error";

type LogRole = "user" | "assistant" | "tool" | "system";

export interface RealtimeLogEntry {
  id: string;
  role: LogRole;
  text: string;
  timestamp: number;
}

export interface RealtimeUsageTotals {
  responses: number;
  totalTokens: number;
  inputTextTokens: number;
  inputCachedTextTokens: number;
  inputAudioTokens: number;
  inputCachedAudioTokens: number;
  inputImageTokens: number;
  inputCachedImageTokens: number;
  transcriptionInputAudioTokens: number;
  transcriptionOutputTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
  estimatedCostUsd: number;
}

interface Options {
  diagramId: string;
  diagram: Diagram | null | undefined;
  canvasRef: React.RefObject<ExcalidrawCanvasHandle | null>;
  settings: UserSettings;
  playbackMode?: DiagramPlaybackMode;
  onError?: (message: string) => void;
}

interface FunctionCallItem {
  type: "function_call";
  name: string;
  call_id: string;
  arguments?: string;
}

const EMPTY_USAGE_TOTALS: RealtimeUsageTotals = {
  responses: 0,
  totalTokens: 0,
  inputTextTokens: 0,
  inputCachedTextTokens: 0,
  inputAudioTokens: 0,
  inputCachedAudioTokens: 0,
  inputImageTokens: 0,
  inputCachedImageTokens: 0,
  transcriptionInputAudioTokens: 0,
  transcriptionOutputTokens: 0,
  outputTextTokens: 0,
  outputAudioTokens: 0,
  estimatedCostUsd: 0,
};

const TRANSCRIPTION_PRICE_PER_MILLION = {
  audioInput: 1.25,
  output: 5,
};

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normalizeTranscript(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function elementLabel(element: ExcalidrawElement): string {
  if (typeof element.text === "string") return element.text;
  if (typeof element.label?.text === "string") return element.label.text;
  return "";
}

function addRealtimeUsage(
  current: RealtimeUsageTotals,
  usage: unknown,
  model: RealtimeModelId,
): RealtimeUsageTotals {
  if (!usage || typeof usage !== "object") return current;
  const price = getRealtimeModelPreset(model).pricing;
  const record = usage as Record<string, unknown>;
  const inputDetails =
    record.input_token_details && typeof record.input_token_details === "object"
      ? (record.input_token_details as Record<string, unknown>)
      : {};
  const outputDetails =
    record.output_token_details &&
    typeof record.output_token_details === "object"
      ? (record.output_token_details as Record<string, unknown>)
      : {};
  const cachedDetails =
    inputDetails.cached_tokens_details &&
    typeof inputDetails.cached_tokens_details === "object"
      ? (inputDetails.cached_tokens_details as Record<string, unknown>)
      : {};

  const inputTextTokens = numberFrom(inputDetails.text_tokens);
  const inputAudioTokens = numberFrom(inputDetails.audio_tokens);
  const inputImageTokens = numberFrom(inputDetails.image_tokens);
  const inputCachedTextTokens = numberFrom(cachedDetails.text_tokens);
  const inputCachedAudioTokens = numberFrom(cachedDetails.audio_tokens);
  const inputCachedImageTokens = numberFrom(cachedDetails.image_tokens);
  const outputTextTokens = numberFrom(outputDetails.text_tokens);
  const outputAudioTokens = numberFrom(outputDetails.audio_tokens);
  const uncachedTextInput = Math.max(0, inputTextTokens - inputCachedTextTokens);
  const uncachedAudioInput = Math.max(
    0,
    inputAudioTokens - inputCachedAudioTokens,
  );
  const uncachedImageInput = Math.max(
    0,
    inputImageTokens - inputCachedImageTokens,
  );
  const responseCost =
    (uncachedTextInput * price.textInput +
      inputCachedTextTokens * price.textCachedInput +
      uncachedAudioInput * price.audioInput +
      inputCachedAudioTokens * price.audioCachedInput +
      uncachedImageInput * price.imageInput +
      inputCachedImageTokens * price.imageCachedInput +
      outputTextTokens * price.textOutput +
      outputAudioTokens * price.audioOutput) /
    1_000_000;

  return {
    responses: current.responses + 1,
    totalTokens: current.totalTokens + numberFrom(record.total_tokens),
    inputTextTokens: current.inputTextTokens + inputTextTokens,
    inputCachedTextTokens:
      current.inputCachedTextTokens + inputCachedTextTokens,
    inputAudioTokens: current.inputAudioTokens + inputAudioTokens,
    inputCachedAudioTokens:
      current.inputCachedAudioTokens + inputCachedAudioTokens,
    inputImageTokens: current.inputImageTokens + inputImageTokens,
    inputCachedImageTokens:
      current.inputCachedImageTokens + inputCachedImageTokens,
    transcriptionInputAudioTokens: current.transcriptionInputAudioTokens,
    transcriptionOutputTokens: current.transcriptionOutputTokens,
    outputTextTokens: current.outputTextTokens + outputTextTokens,
    outputAudioTokens: current.outputAudioTokens + outputAudioTokens,
    estimatedCostUsd: current.estimatedCostUsd + responseCost,
  };
}

function addTranscriptionUsage(
  current: RealtimeUsageTotals,
  usage: unknown,
): RealtimeUsageTotals {
  if (!usage || typeof usage !== "object") return current;
  const record = usage as Record<string, unknown>;
  const inputDetails =
    record.input_token_details && typeof record.input_token_details === "object"
      ? (record.input_token_details as Record<string, unknown>)
      : {};
  const inputAudioTokens = numberFrom(inputDetails.audio_tokens);
  const outputTokens = numberFrom(record.output_tokens);
  const cost =
    (inputAudioTokens * TRANSCRIPTION_PRICE_PER_MILLION.audioInput +
      outputTokens * TRANSCRIPTION_PRICE_PER_MILLION.output) /
    1_000_000;

  return {
    ...current,
    totalTokens: current.totalTokens + numberFrom(record.total_tokens),
    transcriptionInputAudioTokens:
      current.transcriptionInputAudioTokens + inputAudioTokens,
    transcriptionOutputTokens:
      current.transcriptionOutputTokens + outputTokens,
    estimatedCostUsd: current.estimatedCostUsd + cost,
  };
}

function summarizeCanvas(elements: ExcalidrawElement[]) {
  const visible = elements.filter((element) => !element.isDeleted);
  return {
    elementCount: visible.length,
    elements: visible.slice(0, 80).map((element) => ({
      id: element.id,
      type: element.type,
      label: elementLabel(element),
      x: Math.round(Number(element.x) || 0),
      y: Math.round(Number(element.y) || 0),
      width: Math.round(Number(element.width) || 0),
      height: Math.round(Number(element.height) || 0),
      pointCount: Array.isArray(element.points)
        ? element.points.length
        : undefined,
      containerId: element.containerId,
      boundElements: element.boundElements,
    })),
  };
}

function summarizeGraph(graph: GraphResponse | null) {
  if (!graph) return null;
  return {
    direction: graph.direction,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      group: node.group,
    })),
    edges: graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label,
    })),
  };
}

export function useRealtimeCanvasAgent({
  diagramId,
  diagram,
  canvasRef,
  settings,
  playbackMode = "slow",
  onError,
}: Options) {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [inputDraft, setInputDraft] = useState("");
  const [assistantDraft, setAssistantDraft] = useState("");
  const [logs, setLogs] = useState<RealtimeLogEntry[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeModelId, setActiveModelId] = useState<RealtimeModelId | null>(
    null,
  );
  const [usageTotals, setUsageTotals] =
    useState<RealtimeUsageTotals>(EMPTY_USAGE_TOTALS);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeSessionRef = useRef(0);
  const handledCallsRef = useRef(new Set<string>());
  const responseActiveRef = useRef(false);
  const pendingResponseCreateRef = useRef(false);
  const assistantDraftRef = useRef("");
  const draftKindRef = useRef<"audio" | "text" | null>(null);
  const assistantMentionedElementIdsRef = useRef(new Set<string>());
  const activeModelRef = useRef<RealtimeModelId>(
    getRealtimeModelPreset(settings.openaiRealtimeModel).id,
  );
  const diagramRef = useRef(diagram);
  const settingsRef = useRef(settings);
  const playbackModeRef = useRef<DiagramPlaybackMode>(playbackMode);
  const onErrorRef = useRef(onError);

  diagramRef.current = diagram;
  settingsRef.current = settings;
  playbackModeRef.current = playbackMode;
  onErrorRef.current = onError;

  const pushLog = useCallback((role: LogRole, text: string) => {
    const normalized = normalizeTranscript(text);
    if (!normalized) return;
    setLogs((current) => [
      ...current.slice(-79),
      {
        id: createId(role),
        role,
        text: normalized,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const notifyError = useCallback(
    (message: string) => {
      setStatus("error");
      setStatusText(message);
      onErrorRef.current?.(message);
    },
    [],
  );

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const channel = dcRef.current;
    if (!channel || channel.readyState !== "open") return false;
    channel.send(JSON.stringify(event));
    return true;
  }, []);

  const requestResponse = useCallback(() => {
    if (responseActiveRef.current) {
      pendingResponseCreateRef.current = true;
      return false;
    }

    responseActiveRef.current = true;
    pendingResponseCreateRef.current = false;
    setStatus("thinking");
    setStatusText("Responding");

    const sent = sendEvent({ type: "response.create" });
    if (!sent) {
      responseActiveRef.current = false;
      pendingResponseCreateRef.current = false;
    }
    return sent;
  }, [sendEvent]);

  const finalizeAssistantDraft = useCallback(() => {
    const text = assistantDraftRef.current.trim();
    if (text) pushLog("assistant", text);
    assistantDraftRef.current = "";
    draftKindRef.current = null;
    setAssistantDraft("");
  }, [pushLog]);

  const syncLaserToAssistantText = useCallback(
    (text: string) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const normalizedText = normalizeForMatch(text);
      if (!normalizedText) return;

      const candidates = canvas
        .getElements()
        .filter((element) => !element.isDeleted)
        .map((element) => {
          const label = elementLabel(element);
          const normalizedLabel = normalizeForMatch(label);
          return { element, normalizedLabel };
        })
        .filter(
          ({ element, normalizedLabel }) =>
            normalizedLabel.length >= 4 &&
            !assistantMentionedElementIdsRef.current.has(element.id),
        )
        .map((candidate) => ({
          ...candidate,
          index: normalizedText.indexOf(candidate.normalizedLabel),
        }))
        .filter((candidate) => candidate.index >= 0)
        .sort((a, b) => a.index - b.index);

      const match = candidates[0];
      if (!match) return;

      assistantMentionedElementIdsRef.current.add(match.element.id);
      void canvas.executeCommand("laser_point_at_element", {
        elementId: match.element.id,
        circle: false,
        speedMs: 12,
        dwellFrames: 8,
        releaseDelayMs: 650,
      });
    },
    [canvasRef],
  );

  const appendAssistantDelta = useCallback(
    (delta: string, kind: "audio" | "text") => {
      if (!delta) return;
      if (kind === "audio" && draftKindRef.current !== "audio") {
        assistantDraftRef.current = "";
        draftKindRef.current = "audio";
        assistantMentionedElementIdsRef.current = new Set();
      }
      if (kind === "text" && draftKindRef.current === "audio") return;
      if (!draftKindRef.current) {
        draftKindRef.current = kind;
        assistantMentionedElementIdsRef.current = new Set();
      }
      assistantDraftRef.current += delta;
      setAssistantDraft(assistantDraftRef.current);
      syncLaserToAssistantText(assistantDraftRef.current);
    },
    [syncLaserToAssistantText],
  );

  const cleanup = useCallback(() => {
    setIsConnected(false);
    setIsListening(false);
    setActiveTool(null);
    setActiveModelId(null);
    responseActiveRef.current = false;
    pendingResponseCreateRef.current = false;
    finalizeAssistantDraft();

    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        /* noop */
      }
      dcRef.current = null;
    }

    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        /* noop */
      }
      pcRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
  }, [finalizeAssistantDraft]);

  const executeGenerateDiagram = useCallback(
    async (args: Record<string, unknown>) => {
      const instruction =
        typeof args.instruction === "string" ? args.instruction.trim() : "";
      if (!instruction) {
        return { ok: false, error: "instruction is required" };
      }

      const currentDiagram = diagramRef.current;
      const canvas = canvasRef.current;
      if (!currentDiagram || !canvas) {
        return { ok: false, error: "canvas is not ready" };
      }

      const liveElements = canvas.getElements();
      const placement = resolveDiagramPlacement(
        instruction,
        args.placement,
        liveElements.some((element) => !element.isDeleted),
      );
      const mode = normalizePlaybackMode(args.mode ?? playbackModeRef.current);
      const res = await fetch("/api/generate-diagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: instruction,
          currentGraph:
            placement === "new-section"
              ? null
              : liveElements.length
                ? currentDiagram.graph
                : null,
          diagramType: currentDiagram.diagramType,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.elements) {
        return {
          ok: false,
          error: data.error ?? "diagram generation failed",
        };
      }

      if (placement === "new-section") {
        await canvas.executeCommand("prepare_workspace", {
          moveExisting: "left",
          padding: 360,
          zoom: 0.95,
        });
      }

      const elements =
        placement === "new-section"
          ? prepareGeneratedSection(canvas, data.elements)
          : data.elements;
      const files = data.files ?? [];

      await playDiagramOnCanvas({
        canvas,
        elements,
        files,
        replace: placement !== "new-section",
        mode,
      });

      await canvas.executeCommand("repair_layout", { padding: 44 });
      await canvas.executeCommand("focus_region", {
        elementIds: elements.map((element: ExcalidrawElement) => element.id),
        zoom: 0.95,
      });

      await db.diagrams.update(diagramId, {
        graph: data.graph,
        transcript: `${currentDiagram.transcript}\n${instruction}`.trim(),
        metadata: {
          ...currentDiagram.metadata,
          generatedVia: "voice",
        },
        updatedAt: Date.now(),
      });

      const graph = data.graph as GraphResponse;
      return {
        ok: true,
        message: `Updated diagram with ${graph.nodes.length} nodes and ${graph.edges.length} connections in ${mode} mode`,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        mode,
        placement,
        usedFallback: data.usedFallback === true,
      };
    },
    [canvasRef, diagramId],
  );

  const executeTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      const canvas = canvasRef.current;
      const currentDiagram = diagramRef.current;

      if (name === "get_canvas_state") {
        const elements = canvas?.getElements() ?? [];
        return {
          ok: true,
          canvas: summarizeCanvas(elements),
          graph: summarizeGraph(currentDiagram?.graph ?? null),
        };
      }

      if (name === "generate_diagram_from_instruction") {
        return executeGenerateDiagram(args);
      }

      if (!canvas) return { ok: false, error: "canvas is not ready" };

      if (name === "capture_canvas_snapshot") {
        const imageUrl = await canvas.exportThumbnail?.();
        if (!imageUrl) {
          return { ok: false, error: "canvas snapshot is not available" };
        }

        const detail =
          args.detail === "high" || args.detail === "auto"
            ? args.detail
            : "low";
        const reason =
          typeof args.reason === "string" && args.reason.trim()
            ? args.reason.trim()
            : "Inspect the current canvas for visual correctness.";
        const visualRes = await fetch("/api/analyze-canvas-snapshot", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(settingsRef.current.openaiRealtimeKey
              ? { "x-openai-api-key": settingsRef.current.openaiRealtimeKey }
              : {}),
          },
          body: JSON.stringify({
            imageUrl,
            detail,
            reason,
            canvas: summarizeCanvas(canvas.getElements()),
          }),
        });
        const visual = (await visualRes.json()) as Record<string, unknown>;

        if (!visualRes.ok) {
          return {
            ok: false,
            error:
              typeof visual.error === "string"
                ? visual.error
                : "visual canvas analysis failed",
            captured: true,
            detail,
            imageBytes: imageUrl.length,
            canvas: summarizeCanvas(canvas.getElements()),
          };
        }

        const issues = Array.isArray(visual.issues) ? visual.issues : [];
        return {
          ok: true,
          message:
            issues.length > 0
              ? `Visual QA found ${issues.length} issue${
                  issues.length === 1 ? "" : "s"
                }`
              : "Visual QA found no obvious issues",
          visual,
          issueCount: issues.length,
          detail,
          imageBytes: imageUrl.length,
          canvas: summarizeCanvas(canvas.getElements()),
        };
      }

      const result = await canvas.executeCommand(name, args);
      if (result?.ok === false || result?.error) return result;
      return { ok: true, ...result };
    },
    [canvasRef, executeGenerateDiagram],
  );

  const handleFunctionCalls = useCallback(
    async (calls: FunctionCallItem[]) => {
      const pending = calls.filter((call) => {
        if (!call.call_id || handledCallsRef.current.has(call.call_id)) {
          return false;
        }
        handledCallsRef.current.add(call.call_id);
        return true;
      });

      if (pending.length === 0) return;
      setStatus("tool");

      for (const call of pending) {
        setActiveTool(call.name);
        setStatusText(`Running ${call.name}`);
        pushLog("tool", `Running ${call.name}`);
        const args = parseArguments(call.arguments);
        let output: Record<string, unknown>;
        try {
          output = await executeTool(call.name, args);
        } catch (error) {
          output = {
            ok: false,
            error: error instanceof Error ? error.message : "tool failed",
          };
        }

        pushLog(
          "tool",
          output.ok === false
            ? `${call.name} failed: ${String(output.error ?? "unknown error")}`
            : `${call.name} completed`,
        );

        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(output),
          },
        });
      }

      setActiveTool(null);
      requestResponse();
    },
    [executeTool, pushLog, requestResponse, sendEvent],
  );

  const handleServerEvent = useCallback(
    (event: Record<string, unknown>) => {
      const eventType = typeof event.type === "string" ? event.type : "";

      if (eventType === "session.created" || eventType === "session.updated") {
        setStatus("connected");
        setStatusText("Connected");
        return;
      }

      if (eventType === "response.created") {
        responseActiveRef.current = true;
        assistantMentionedElementIdsRef.current = new Set();
        return;
      }

      if (eventType === "input_audio_buffer.speech_started") {
        setStatus("listening");
        setStatusText("Listening");
        finalizeAssistantDraft();
        return;
      }

      if (eventType === "input_audio_buffer.speech_stopped") {
        setStatus("thinking");
        setStatusText("Thinking");
        return;
      }

      if (eventType === "conversation.item.input_audio_transcription.delta") {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (delta) setInputDraft((current) => current + delta);
        return;
      }

      if (
        eventType === "conversation.item.input_audio_transcription.completed"
      ) {
        const transcript =
          typeof event.transcript === "string" ? event.transcript : "";
        const normalized = normalizeTranscript(transcript);
        setInputDraft("");
        if (normalized) pushLog("user", normalized);
        setUsageTotals((current) =>
          addTranscriptionUsage(current, event.usage),
        );
        return;
      }

      if (
        eventType === "response.output_audio_transcript.delta" ||
        eventType === "response.audio_transcript.delta"
      ) {
        appendAssistantDelta(String(event.delta ?? ""), "audio");
        return;
      }

      if (
        eventType === "response.output_audio_transcript.done" ||
        eventType === "response.audio_transcript.done"
      ) {
        finalizeAssistantDraft();
        return;
      }

      if (eventType === "response.output_text.delta") {
        appendAssistantDelta(String(event.delta ?? ""), "text");
        return;
      }

      if (eventType === "response.output_text.done") {
        finalizeAssistantDraft();
        return;
      }

      if (eventType === "response.function_call_arguments.delta") {
        setStatus("tool");
        setStatusText("Preparing tool call");
        return;
      }

      if (eventType === "response.output_item.done") {
        return;
      }

      if (eventType === "response.done") {
        responseActiveRef.current = false;
        const response =
          event.response && typeof event.response === "object"
            ? (event.response as Record<string, unknown>)
            : null;
        setUsageTotals((current) =>
          addRealtimeUsage(current, response?.usage, activeModelRef.current),
        );
        const output = Array.isArray(response?.output)
          ? response.output
          : [];
        const functionCalls = output.filter(
          (item: Record<string, unknown>) => item.type === "function_call",
        ) as unknown as FunctionCallItem[];

        if (functionCalls.length > 0) {
          void handleFunctionCalls(functionCalls);
          return;
        }

        finalizeAssistantDraft();
        if (pendingResponseCreateRef.current) {
          pendingResponseCreateRef.current = false;
          window.setTimeout(() => {
            requestResponse();
          }, 0);
          return;
        }

        setStatus("connected");
        setStatusText("Connected");
        return;
      }

      if (eventType === "error") {
        const error =
          event.error && typeof event.error === "object"
            ? (event.error as Record<string, unknown>)
            : null;
        const message =
          typeof error?.message === "string"
            ? error.message
            : typeof event.message === "string"
              ? event.message
              : "Realtime error";
        if (message.includes("active response in progress")) {
          pendingResponseCreateRef.current = true;
          setStatus("thinking");
          setStatusText("Waiting for active response");
          return;
        }
        responseActiveRef.current = false;
        notifyError(message);
      }
    },
    [
      appendAssistantDelta,
      finalizeAssistantDraft,
      handleFunctionCalls,
      notifyError,
      pushLog,
      requestResponse,
    ],
  );

  const stop = useCallback(() => {
    activeSessionRef.current += 1;
    cleanup();
    setStatus("idle");
    setStatusText("Ready");
  }, [cleanup]);

  const start = useCallback(async () => {
    stop();
    const sessionId = ++activeSessionRef.current;
    handledCallsRef.current = new Set();
    setStatus("connecting");
    setStatusText("Connecting");

    try {
      const realtimeModel = getRealtimeModelPreset(
        settingsRef.current.openaiRealtimeModel,
      ).id;
      activeModelRef.current = realtimeModel;
      setActiveModelId(realtimeModel);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (sessionId !== activeSessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const pc = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0] ?? null;
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const dc = pc.createDataChannel("oai-events");

      pcRef.current = pc;
      dcRef.current = dc;
      streamRef.current = stream;
      audioRef.current = audio;

      dc.onopen = () => {
        if (sessionId !== activeSessionRef.current) return;
        setIsConnected(true);
        setIsListening(true);
        setStatus("connected");
        setStatusText("Connected");
        pushLog("system", "Realtime canvas agent connected");
      };

      dc.onclose = () => {
        if (sessionId !== activeSessionRef.current) return;
        setIsConnected(false);
        setIsListening(false);
        setStatus("idle");
        setStatusText("Disconnected");
      };

      dc.onerror = () => {
        if (sessionId !== activeSessionRef.current) return;
        notifyError("Realtime data channel error");
      };

      dc.onmessage = (messageEvent) => {
        if (sessionId !== activeSessionRef.current) return;
        try {
          handleServerEvent(JSON.parse(messageEvent.data));
        } catch {
          /* ignore non-json events */
        }
      };

      pc.onconnectionstatechange = () => {
        if (sessionId !== activeSessionRef.current) return;
        if (pc.connectionState === "connected") {
          setIsConnected(true);
          setIsListening(true);
          setStatus("connected");
          setStatusText("Connected");
          return;
        }
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          setIsConnected(false);
          setIsListening(false);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const localSdp = pc.localDescription?.sdp;
      if (!localSdp) {
        throw new Error("Browser did not create an SDP offer");
      }

      const res = await fetch("/api/realtime-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
          ...(settingsRef.current.openaiRealtimeKey
            ? { "x-openai-api-key": settingsRef.current.openaiRealtimeKey }
            : {}),
          "x-openai-realtime-model": realtimeModel,
        },
        body: localSdp,
      });
      const answerSdp = await res.text();
      if (!res.ok) {
        let message = answerSdp;
        try {
          const payload = JSON.parse(answerSdp) as { error?: string };
          message = payload.error ?? message;
        } catch {
          /* response was plain text */
        }
        throw new Error(message || "Failed to create Realtime session");
      }
      if (!answerSdp.trim()) {
        throw new Error("Realtime session response missing SDP answer");
      }

      if (sessionId !== activeSessionRef.current) return;
      await pc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
    } catch (error) {
      if (sessionId !== activeSessionRef.current) return;
      cleanup();
      notifyError(
        error instanceof Error ? error.message : "Failed to start Realtime",
      );
    }
  }, [cleanup, handleServerEvent, notifyError, pushLog, stop]);

  const sendText = useCallback(
    (text: string) => {
      const normalized = normalizeTranscript(text);
      if (!normalized) return false;
      if (!isConnected) return false;
      finalizeAssistantDraft();
      pushLog("user", normalized);
      setStatus("thinking");
      setStatusText("Thinking");
      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: normalized }],
        },
      });
      requestResponse();
      return true;
    },
    [finalizeAssistantDraft, isConnected, pushLog, requestResponse, sendEvent],
  );

  useEffect(() => {
    return () => {
      activeSessionRef.current += 1;
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    statusText,
    isConnected,
    isListening,
    inputDraft,
    assistantDraft,
    logs,
    activeTool,
    activeModelId,
    usageTotals,
    start,
    stop,
    sendText,
  };
}
