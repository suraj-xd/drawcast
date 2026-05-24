import type { BinaryFileData, ExcalidrawElement } from "@/types/diagram";

export type DiagramPlaybackMode = "slow" | "fast" | "explanatory";
export type DiagramPlacement = "auto" | "update-existing" | "new-section";

type CanvasPlaybackTarget = {
  updateDiagram: (
    elements: ExcalidrawElement[],
    opts?: { replace?: boolean; files?: BinaryFileData[]; scroll?: boolean },
  ) => void;
  getElements: () => ExcalidrawElement[];
  getAppState: () => Record<string, unknown> | null;
  executeCommand: (
    command: string,
    params?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

const DEFAULT_MODE: DiagramPlaybackMode = "slow";

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getZoom(appState: Record<string, unknown> | null) {
  const zoom = appState?.zoom;
  if (zoom && typeof zoom === "object" && "value" in zoom) {
    return numberValue((zoom as { value?: unknown }).value, 1);
  }
  return 1;
}

function elementBounds(element: ExcalidrawElement): Bounds {
  const x = numberValue(element.x);
  const y = numberValue(element.y);
  const points = Array.isArray(element.points)
    ? (element.points as Array<[number, number]>)
    : [];

  if ((element.type === "arrow" || element.type === "line") && points.length > 0) {
    const xs = points.map(([px]) => x + px);
    const ys = points.map(([, py]) => y + py);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    return {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      right,
      bottom,
    };
  }

  const width = numberValue(element.width, 1);
  const height = numberValue(element.height, 1);
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function boundsOf(elements: ExcalidrawElement[]): Bounds | null {
  const visible = elements.filter((element) => !element.isDeleted);
  if (visible.length === 0) return null;

  const boxes = visible.map(elementBounds);
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return { x, y, width: right - x, height: bottom - y, right, bottom };
}

function translateElements(
  elements: ExcalidrawElement[],
  dx: number,
  dy: number,
): ExcalidrawElement[] {
  return elements.map((element) => ({
    ...element,
    x: numberValue(element.x) + dx,
    y: numberValue(element.y) + dy,
  }));
}

function remapElementIds(elements: ExcalidrawElement[], sectionId: string) {
  const idMap = new Map(elements.map((element) => [element.id, `${sectionId}-${element.id}`]));
  const remapId = (value: unknown) =>
    typeof value === "string" && idMap.has(value) ? idMap.get(value) : value;

  return elements.map((element) => {
    const next: ExcalidrawElement = {
      ...element,
      id: idMap.get(element.id) ?? element.id,
      customData: {
        ...(element.customData ?? {}),
        drawcast: {
          ...(element.customData?.drawcast ?? {}),
          sectionId,
        },
      },
    };

    if (typeof next.containerId === "string") {
      next.containerId = remapId(next.containerId);
    }
    if (typeof next.frameId === "string") {
      next.frameId = remapId(next.frameId);
    }
    if (Array.isArray(next.boundElements)) {
      next.boundElements = next.boundElements.map((bound: Record<string, unknown>) => ({
        ...bound,
        id: remapId(bound.id),
      }));
    }
    if (next.startBinding && typeof next.startBinding === "object") {
      next.startBinding = {
        ...next.startBinding,
        elementId: remapId(next.startBinding.elementId),
      };
    }
    if (next.endBinding && typeof next.endBinding === "object") {
      next.endBinding = {
        ...next.endBinding,
        elementId: remapId(next.endBinding.elementId),
      };
    }

    return next;
  });
}

function getViewportBounds(canvas: CanvasPlaybackTarget) {
  const state = canvas.getAppState();
  const zoom = getZoom(state);
  const width = numberValue(state?.width, 1200) / zoom;
  const height = numberValue(state?.height, 800) / zoom;
  const left = -numberValue(state?.scrollX) / zoom;
  const top = -numberValue(state?.scrollY) / zoom;
  return {
    x: left,
    y: top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

export function normalizePlaybackMode(value: unknown): DiagramPlaybackMode {
  return value === "fast" || value === "explanatory" || value === "slow"
    ? value
    : DEFAULT_MODE;
}

export function resolveDiagramPlacement(
  instruction: string,
  requested: unknown,
  hasCanvas: boolean,
): Exclude<DiagramPlacement, "auto"> {
  if (requested === "new-section") return "new-section";
  if (requested === "update-existing") return "update-existing";
  if (!hasCanvas) return "update-existing";

  const text = instruction.toLowerCase();
  if (/\b(new|another|separate|else|fresh)\b/.test(text)) return "new-section";
  if (/\b(make|draw|create|generate)\b.{0,40}\b(diagram|architecture|flow|chart)\b/.test(text)) {
    return "new-section";
  }
  if (/\b(add|connect|update|change|rename|delete|remove|replace|move|resize|style|fix)\b/.test(text)) {
    return "update-existing";
  }
  return "update-existing";
}

export function prepareGeneratedSection(
  canvas: CanvasPlaybackTarget,
  elements: ExcalidrawElement[],
  sectionId = `section_${Date.now().toString(36)}`,
) {
  const namespaced = remapElementIds(elements, sectionId);
  const generatedBounds = boundsOf(namespaced);
  if (!generatedBounds) return namespaced;

  const viewport = getViewportBounds(canvas);
  const padding = 96;
  const desiredX =
    viewport.x + Math.max(padding, (viewport.width - generatedBounds.width) / 2);
  const desiredY =
    viewport.y + Math.max(padding, (viewport.height - generatedBounds.height) / 2);

  return translateElements(
    namespaced,
    desiredX - generatedBounds.x,
    desiredY - generatedBounds.y,
  );
}

function sortByPosition(a: ExcalidrawElement, b: ExcalidrawElement) {
  const ab = elementBounds(a);
  const bb = elementBounds(b);
  return ab.x === bb.x ? ab.y - bb.y : ab.x - bb.x;
}

function playbackFrames(elements: ExcalidrawElement[]) {
  const groups = elements.filter((element) => element.customData?.drawcast?.type === "group");
  const groupIcons = elements.filter(
    (element) =>
      element.type === "image" &&
      String(element.id).includes("icon-group-"),
  );
  const nodes = elements
    .filter(
      (element) =>
        element.type !== "arrow" &&
        element.type !== "line" &&
        element.type !== "image" &&
        element.customData?.drawcast?.type !== "group",
    )
    .sort(sortByPosition);
  const icons = elements.filter(
    (element) =>
      element.type === "image" &&
      !String(element.id).includes("icon-group-"),
  );
  const edges = elements
    .filter((element) => element.type === "arrow" || element.type === "line")
    .sort(sortByPosition);

  const frames: ExcalidrawElement[][] = [];
  if (groups.length > 0) frames.push([...groups, ...groupIcons]);

  for (const node of nodes) {
    const box = elementBounds(node);
    const nearbyIcons = icons.filter((icon) => {
      const iconBox = elementBounds(icon);
      return (
        iconBox.x >= box.x - 16 &&
        iconBox.x <= box.right &&
        iconBox.y >= box.y - 16 &&
        iconBox.y <= box.bottom
      );
    });
    frames.push([node, ...nearbyIcons]);
  }

  for (const edge of edges) frames.push([edge]);
  return frames.length > 0 ? frames : [elements];
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function playDiagramOnCanvas({
  canvas,
  elements,
  files,
  replace,
  mode,
}: {
  canvas: CanvasPlaybackTarget;
  elements: ExcalidrawElement[];
  files: BinaryFileData[];
  replace: boolean;
  mode: DiagramPlaybackMode;
}) {
  if (mode === "fast") {
    canvas.updateDiagram(elements, { replace, files, scroll: false });
    await canvas.executeCommand("focus_region", {
      elementIds: elements.map((element) => element.id),
      zoom: 0.95,
    });
    return;
  }

  const frames = playbackFrames(elements);
  const stepDelayMs = mode === "explanatory" ? 700 : 260;
  const cumulative: ExcalidrawElement[] = [];

  for (const frame of frames) {
    cumulative.push(...frame);
    canvas.updateDiagram(replace ? cumulative : frame, {
      replace,
      files,
      scroll: false,
    });
    await canvas.executeCommand("focus_region", {
      elementIds: cumulative.map((element) => element.id),
      zoom: 0.95,
    });
    await wait(stepDelayMs);
  }
}
