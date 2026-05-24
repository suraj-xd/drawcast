import OpenAI from "openai";
import type { ExcalidrawElement, GraphResponse } from "@/types/diagram";
import type { DiagramType } from "@/types/library";
import { getSystemPrompt } from "./prompts";
import { layoutGraph } from "../render/layout";
import { fetchIcons } from "../render/icons";

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "EMPTY",
});
const OPENAI_DIAGRAM_MODEL =
  process.env.OPENAI_DIAGRAM_MODEL || "gpt-5.4-mini";

function extractJSON(content: string): string {
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const start = content.indexOf("{");
  if (start === -1) return content;
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return content.slice(start);
}

export async function generateDiagram(
  transcript: string,
  currentGraph?: GraphResponse | null,
  diagramType: DiagramType = "freeform",
  manualEditDebrief?: {
    text: string;
    deletedNodeIds: string[];
    deletedEdgeKeys: Array<{ from: string; to: string }>;
  } | null,
): Promise<{
  elements: ExcalidrawElement[];
  graph: GraphResponse;
  files: import("@/types/diagram").BinaryFileData[];
}> {
  const userMessage = currentGraph
    ? `Current diagram:\n${JSON.stringify(currentGraph)}\n\n${manualEditDebrief ? manualEditDebrief.text + "\n\n" : ""}Latest instruction:\n${transcript}`
    : transcript;

  const content = (
    await openaiClient.responses.create({
      model: OPENAI_DIAGRAM_MODEL,
      input: [
        { role: "system", content: getSystemPrompt(diagramType) },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
      max_output_tokens: 3000,
    })
  ).output_text;

  if (!content) throw new Error("LLM returned empty content");

  const jsonStr = extractJSON(content);
  let graph: GraphResponse;

  try {
    graph = JSON.parse(jsonStr) as GraphResponse;
  } catch {
    console.warn("Failed to parse LLM response as JSON:", content);
    if (currentGraph && currentGraph.nodes.length > 0) {
      console.warn("Falling back to current graph");
      const { elements: fbElements, iconRequests: fbRequests } =
        layoutGraph(currentGraph);
      const fbFiles = fetchIcons(fbRequests);
      return { elements: fbElements, graph: currentGraph, files: fbFiles };
    }
    throw new Error("LLM returned empty graph");
  }

  const explicitWipe =
    /\b(delete|clear|wipe|erase|remove)\s+(every|all)(\s*thing)?\b/i.test(
      transcript,
    );

  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    if (currentGraph && currentGraph.nodes.length > 0 && !explicitWipe) {
      console.warn(
        "LLM returned empty nodes; keeping current graph (no explicit wipe instruction)",
      );
      graph = currentGraph;
    } else if (!explicitWipe) {
      console.error("LLM returned empty graph. Parsed:", JSON.stringify(graph));
      console.error("Raw content:", content);
      throw new Error("LLM returned empty graph");
    }
  }

  if (currentGraph && !explicitWipe) {
    const explicitlyRemovedNodes = new Set([
      ...(graph.remove?.nodes ?? []),
      ...(manualEditDebrief?.deletedNodeIds ?? []),
    ]);
    const explicitlyRemovedEdgeKeys = new Set([
      ...(graph.remove?.edges ?? []).map((e) => `${e.from}|${e.to}`),
      ...(manualEditDebrief?.deletedEdgeKeys ?? []).map(
        (e) => `${e.from}|${e.to}`,
      ),
    ]);
    const llmNodeIds = new Set(graph.nodes.map((n) => n.id));
    const overlap = currentGraph.nodes.filter(
      (n) => llmNodeIds.has(n.id) || explicitlyRemovedNodes.has(n.id),
    ).length;
    if (overlap > 0) {
      const restoredNodes = currentGraph.nodes.filter(
        (n) => !llmNodeIds.has(n.id) && !explicitlyRemovedNodes.has(n.id),
      );
      const allNodeIds = new Set(
        [...graph.nodes, ...restoredNodes].map((n) => n.id),
      );
      const llmEdgeKeys = new Set(graph.edges.map((e) => `${e.from}|${e.to}`));
      const restoredEdges = (currentGraph.edges ?? []).filter(
        (e) =>
          !llmEdgeKeys.has(`${e.from}|${e.to}`) &&
          !explicitlyRemovedEdgeKeys.has(`${e.from}|${e.to}`) &&
          !explicitlyRemovedNodes.has(e.from) &&
          !explicitlyRemovedNodes.has(e.to) &&
          allNodeIds.has(e.from) &&
          allNodeIds.has(e.to),
      );
      graph = {
        direction: graph.direction ?? currentGraph.direction,
        nodes: [...graph.nodes, ...restoredNodes],
        edges: [...graph.edges, ...restoredEdges],
        groups:
          graph.groups && graph.groups.length > 0
            ? graph.groups
            : (currentGraph.groups ?? []),
      };
    }
  }

  const { elements, iconRequests } = layoutGraph(graph);
  const files = fetchIcons(iconRequests);
  return { elements, graph, files };
}
