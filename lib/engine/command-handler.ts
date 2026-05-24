import { humanCursorPath } from "./human-cursor";
import {
  createFreeformElements,
  parseFreeformRequest,
} from "@/lib/render/freeform";

type ExcalidrawAPI = {
  getAppState: () => Record<string, unknown>;
  getSceneElements: () => readonly CanvasElement[];
  updateScene: (scene: Record<string, unknown>) => void;
  scrollToContent?: (
    target?: unknown,
    opts?: { fitToViewport?: boolean; fitToContent?: boolean; animate?: boolean },
  ) => void;
  setActiveTool?: (tool: Record<string, unknown>) => void;
};

type CanvasElement = Record<string, unknown> & {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  version?: number;
  isDeleted?: boolean;
  groupIds?: string[];
  points?: Array<[number, number]>;
};

type Point = { x: number; y: number };
type Bounds = ReturnType<typeof getBBox>;

const LASER_ID = "drawcast-agent";
const DEFAULT_WORKSPACE_ZOOM = 0.95;
let laserTimers: number[] = [];
let laserLastPoint: Point | null = null;

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function versionedElement(
  element: CanvasElement,
  updates: Record<string, unknown>,
) {
  return {
    ...element,
    ...updates,
    version: (element.version || 1) + 1,
    versionNonce: Math.floor(Math.random() * 2147483647),
    updated: Date.now(),
  };
}

function getViewportCenter(api: ExcalidrawAPI, width: number, height: number) {
  const state = api.getAppState() || {};
  const zoomValue =
    state.zoom && typeof state.zoom === "object" && "value" in state.zoom
      ? (state.zoom as { value?: unknown }).value
      : undefined;
  const zoom = numberValue(zoomValue, 1);
  const viewportWidth =
    typeof state.width === "number" ? state.width : window.innerWidth;
  const viewportHeight =
    typeof state.height === "number" ? state.height : window.innerHeight;
  return {
    x: (viewportWidth / 2 - numberValue(state.scrollX)) / zoom - width / 2,
    y: (viewportHeight / 2 - numberValue(state.scrollY)) / zoom - height / 2,
  };
}

function getElementCenter(element: CanvasElement): Point {
  return {
    x: numberValue(element.x) + numberValue(element.width) / 2,
    y: numberValue(element.y) + numberValue(element.height) / 2,
  };
}

function getSelectedIds(api: ExcalidrawAPI) {
  const selected = api.getAppState().selectedElementIds;
  if (!selected || typeof selected !== "object") return [];
  return Object.entries(selected as Record<string, unknown>)
    .filter(([, value]) => value === true)
    .map(([id]) => id);
}

function getTargetIds(api: ExcalidrawAPI, params: Record<string, unknown>) {
  const explicit = stringArray(params.elementIds);
  return explicit.length > 0 ? explicit : getSelectedIds(api);
}

function mapById(elements: readonly CanvasElement[]) {
  return new Map(elements.map((element) => [element.id, element]));
}

function getCollaborators(api: ExcalidrawAPI) {
  const current = api.getAppState().collaborators;
  return new Map(current instanceof Map ? current : []);
}

function clearLaserTimers() {
  for (const timer of laserTimers) window.clearTimeout(timer);
  laserTimers = [];
}

function setLaser(api: ExcalidrawAPI, point: Point, button: "down" | "up") {
  laserLastPoint = point;
  const collaborators = getCollaborators(api);
  const previous = (collaborators.get(LASER_ID) as Record<string, unknown>) || {};
  collaborators.set(LASER_ID, {
    ...previous,
    pointer: {
      x: point.x,
      y: point.y,
      tool: "laser",
      renderCursor: false,
    },
    button,
    username: "Drawcast",
  });
  api.updateScene({ collaborators });
}

function clearLaser(api: ExcalidrawAPI) {
  clearLaserTimers();
  const collaborators = getCollaborators(api);
  collaborators.delete(LASER_ID);
  api.updateScene({ collaborators });
}

function finishLaser(api: ExcalidrawAPI, releaseDelay = 1200) {
  if (laserLastPoint) setLaser(api, laserLastPoint, "up");
  laserTimers.push(
    window.setTimeout(() => {
      const collaborators = getCollaborators(api);
      collaborators.delete(LASER_ID);
      api.updateScene({ collaborators });
    }, releaseDelay),
  );
}

function scheduleLaserPath(
  api: ExcalidrawAPI,
  points: Point[],
  speedMs = 24,
  releaseDelay = 1200,
) {
  clearLaserTimers();
  if (points.length === 0) return 0;

  setLaser(api, points[0]!, "down");
  for (let index = 1; index < points.length; index += 1) {
    laserTimers.push(
      window.setTimeout(() => setLaser(api, points[index]!, "down"), index * speedMs),
    );
  }

  const durationMs = Math.max(1, points.length - 1) * speedMs;
  laserTimers.push(
    window.setTimeout(() => finishLaser(api, releaseDelay), durationMs),
  );
  return durationMs + releaseDelay;
}

function circlePathAround(element: CanvasElement, frames = 54) {
  const center = getElementCenter(element);
  const rx = Math.max(24, numberValue(element.width, 80) / 2 + 20);
  const ry = Math.max(24, numberValue(element.height, 80) / 2 + 20);
  const points: Point[] = [];

  for (let index = 0; index <= frames; index += 1) {
    const angle = (index / frames) * Math.PI * 2;
    points.push({
      x: center.x + rx * Math.cos(angle) + (Math.random() - 0.5) * 2,
      y: center.y + ry * Math.sin(angle) + (Math.random() - 0.5) * 2,
    });
  }

  return points;
}

function dwellAt(point: Point, frames = 24) {
  const points: Point[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / frames;
    points.push({
      x: point.x + Math.sin(t * Math.PI * 2 * 0.8) * 2,
      y: point.y + Math.cos(t * Math.PI * 2 * 1.1) * 2,
    });
  }
  return points;
}

function parsePointList(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point) => {
    if (Array.isArray(point) && finiteNumber(point[0]) && finiteNumber(point[1])) {
      return [{ x: Number(point[0]), y: Number(point[1]) }];
    }
    if (
      point &&
      typeof point === "object" &&
      finiteNumber((point as Record<string, unknown>).x) &&
      finiteNumber((point as Record<string, unknown>).y)
    ) {
      return [
        {
          x: Number((point as Record<string, unknown>).x),
          y: Number((point as Record<string, unknown>).y),
        },
      ];
    }
    return [];
  });
}

function selectedElementIds(ids: string[]) {
  return ids.reduce<Record<string, true>>((acc, id) => {
    acc[id] = true;
    return acc;
  }, {});
}

function getBBox(element: CanvasElement) {
  const x = numberValue(element.x);
  const y = numberValue(element.y);
  const width = numberValue(element.width, 1);
  const height = numberValue(element.height, 1);
  return {
    x,
    y,
    width,
    height,
    right: x + width,
    bottom: y + height,
    cx: x + width / 2,
    cy: y + height / 2,
  };
}

function getZoom(api: ExcalidrawAPI) {
  const state = api.getAppState() || {};
  const zoomValue =
    state.zoom && typeof state.zoom === "object" && "value" in state.zoom
      ? (state.zoom as { value?: unknown }).value
      : undefined;
  return numberValue(zoomValue, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getViewportMetrics(api: ExcalidrawAPI, zoomOverride?: number) {
  const state = api.getAppState() || {};
  const zoom = zoomOverride ?? getZoom(api);
  const viewportWidth =
    typeof state.width === "number" ? state.width : window.innerWidth;
  const viewportHeight =
    typeof state.height === "number" ? state.height : window.innerHeight;
  const left = -numberValue(state.scrollX) / zoom;
  const top = -numberValue(state.scrollY) / zoom;
  return {
    zoom,
    x: left,
    y: top,
    width: viewportWidth / zoom,
    height: viewportHeight / zoom,
    right: left + viewportWidth / zoom,
    bottom: top + viewportHeight / zoom,
    center: {
      x: (viewportWidth / 2 - numberValue(state.scrollX)) / zoom,
      y: (viewportHeight / 2 - numberValue(state.scrollY)) / zoom,
    },
    screenWidth: viewportWidth,
    screenHeight: viewportHeight,
  };
}

function viewportAtCenter(api: ExcalidrawAPI, center: Point, zoom: number) {
  const state = api.getAppState() || {};
  const viewportWidth =
    typeof state.width === "number" ? state.width : window.innerWidth;
  const viewportHeight =
    typeof state.height === "number" ? state.height : window.innerHeight;
  const width = viewportWidth / zoom;
  const height = viewportHeight / zoom;
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    right: center.x + width / 2,
    bottom: center.y + height / 2,
  };
}

function setViewport(api: ExcalidrawAPI, center: Point, zoom: number) {
  const state = api.getAppState() || {};
  const viewportWidth =
    typeof state.width === "number" ? state.width : window.innerWidth;
  const viewportHeight =
    typeof state.height === "number" ? state.height : window.innerHeight;
  api.updateScene({
    appState: {
      scrollX: viewportWidth / 2 - center.x * zoom,
      scrollY: viewportHeight / 2 - center.y * zoom,
      zoom: { value: zoom },
    },
  });
}

function visibleElements(elements: readonly CanvasElement[]) {
  return elements.filter((element) => !element.isDeleted);
}

function getElementBounds(element: CanvasElement): Bounds {
  if (
    (element.type === "arrow" || element.type === "line") &&
    Array.isArray(element.points) &&
    element.points.length > 0
  ) {
    const baseX = numberValue(element.x);
    const baseY = numberValue(element.y);
    const xs = element.points.map(([x]) => baseX + x);
    const ys = element.points.map(([, y]) => baseY + y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    return {
      x,
      y,
      width: Math.max(1, right - x),
      height: Math.max(1, bottom - y),
      right,
      bottom,
      cx: x + (right - x) / 2,
      cy: y + (bottom - y) / 2,
    };
  }
  return getBBox(element);
}

function sceneBounds(elements: readonly CanvasElement[]) {
  const visible = visibleElements(elements);
  if (visible.length === 0) return null;
  const boxes = visible.map(getElementBounds);
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    right,
    bottom,
    cx: x + (right - x) / 2,
    cy: y + (bottom - y) / 2,
  };
}

function elementText(element: CanvasElement) {
  if (typeof element.text === "string") return element.text;
  const label = element.label;
  if (label && typeof label === "object") {
    const text = (label as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function drawcastData(element: CanvasElement) {
  const customData = element.customData;
  if (!customData || typeof customData !== "object") return null;
  const dc = (customData as Record<string, unknown>).drawcast;
  return dc && typeof dc === "object"
    ? (dc as Record<string, unknown>)
    : null;
}

function isGroupBackground(element: CanvasElement) {
  return drawcastData(element)?.type === "group";
}

function isBoundText(element: CanvasElement) {
  return typeof element.containerId === "string";
}

function isLayoutSubject(element: CanvasElement) {
  if (element.isDeleted || isGroupBackground(element) || isBoundText(element)) {
    return false;
  }
  return !["arrow", "line", "image", "freedraw"].includes(String(element.type));
}

function expandBounds(box: Bounds, padding: number): Bounds {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
    right: box.right + padding,
    bottom: box.bottom + padding,
    cx: box.cx,
    cy: box.cy,
  };
}

function overlapArea(a: Bounds, b: Bounds) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  return width * height;
}

function overlaps(a: Bounds, b: Bounds) {
  return overlapArea(a, b) > 0;
}

function overlapRatio(a: Bounds, b: Bounds) {
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? overlapArea(a, b) / smaller : 0;
}

function estimateTextWarnings(element: CanvasElement) {
  const text = elementText(element).trim();
  if (!text || element.type === "text") return [];

  const label = element.label && typeof element.label === "object"
    ? (element.label as Record<string, unknown>)
    : {};
  const fontSize = numberValue(label.fontSize, numberValue(element.fontSize, 16));
  const box = getElementBounds(element);
  const availableWidth = Math.max(24, box.width - 28);
  const charsPerLine = Math.max(4, Math.floor(availableWidth / (fontSize * 0.58)));
  const lines = Math.ceil(text.length / charsPerLine);
  const neededHeight = lines * fontSize * 1.25 + 24;

  if (neededHeight > box.height) {
    return [
      {
        type: "text_may_overflow",
        elementId: element.id,
        label: text,
        currentHeight: Math.round(box.height),
        suggestedHeight: Math.ceil(neededHeight),
      },
    ];
  }
  return [];
}

function analyzeCanvas(api: ExcalidrawAPI) {
  const elements = visibleElements(api.getSceneElements());
  const viewport = getViewportMetrics(api);
  const bounds = sceneBounds(elements);
  const subjects = elements.filter(isLayoutSubject);
  const warnings: Array<Record<string, unknown>> = [];

  for (let i = 0; i < subjects.length; i += 1) {
    warnings.push(...estimateTextWarnings(subjects[i]!));
    for (let j = i + 1; j < subjects.length; j += 1) {
      const a = getElementBounds(subjects[i]!);
      const b = getElementBounds(subjects[j]!);
      const ratio = overlapRatio(a, b);
      if (ratio > 0.08) {
        warnings.push({
          type: "elements_overlap",
          elementIds: [subjects[i]!.id, subjects[j]!.id],
          overlapRatio: Number(ratio.toFixed(2)),
        });
      }
    }
  }

  return {
    elementCount: elements.length,
    viewport: {
      x: Math.round(viewport.x),
      y: Math.round(viewport.y),
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      zoom: Number(viewport.zoom.toFixed(2)),
    },
    sceneBounds: bounds
      ? {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
          right: Math.round(bounds.right),
          bottom: Math.round(bounds.bottom),
        }
      : null,
    warnings,
  };
}

function findOpenSpot(api: ExcalidrawAPI, width: number, height: number) {
  const viewport = getViewportMetrics(api);
  const occupied = visibleElements(api.getSceneElements())
    .filter((element) => !isGroupBackground(element))
    .map((element) => expandBounds(getElementBounds(element), 36));
  const baseX = viewport.center.x - width / 2;
  const baseY = viewport.center.y - height / 2;
  const stepX = width + 72;
  const stepY = height + 64;
  const candidates: Point[] = [];

  for (let radius = 0; radius <= 4; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        candidates.push({ x: baseX + dx * stepX, y: baseY + dy * stepY });
      }
    }
  }

  for (const candidate of candidates) {
    const box = {
      x: candidate.x,
      y: candidate.y,
      width,
      height,
      right: candidate.x + width,
      bottom: candidate.y + height,
      cx: candidate.x + width / 2,
      cy: candidate.y + height / 2,
    };
    if (!occupied.some((existing) => overlaps(existing, box))) return candidate;
  }

  const bounds = sceneBounds(api.getSceneElements());
  return bounds
    ? { x: bounds.right + 120, y: Math.max(viewport.y + 96, bounds.y) }
    : { x: baseX, y: baseY };
}

function connectionPoint(from: CanvasElement, to: CanvasElement) {
  const a = getElementBounds(from);
  const b = getElementBounds(to);
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      start: { x: dx >= 0 ? a.right : a.x, y: a.cy },
      end: { x: dx >= 0 ? b.x : b.right, y: b.cy },
    };
  }

  return {
    start: { x: a.cx, y: dy >= 0 ? a.bottom : a.y },
    end: { x: b.cx, y: dy >= 0 ? b.y : b.bottom },
  };
}

function boundsForIds(api: ExcalidrawAPI, ids: Set<string>) {
  const targets = visibleElements(api.getSceneElements()).filter((element) =>
    ids.has(element.id),
  );
  return sceneBounds(targets);
}

function styleUpdates(params: Record<string, unknown>) {
  const allowed = [
    "strokeColor",
    "backgroundColor",
    "fillStyle",
    "strokeWidth",
    "strokeStyle",
    "roughness",
    "opacity",
    "fontSize",
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (params[key] !== undefined) updates[key] = params[key];
  }
  return updates;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function partialFreedrawElement(
  element: CanvasElement,
  pointCount: number,
  versionBump: number,
) {
  const points = Array.isArray(element.points) ? element.points : [];
  const pressures = Array.isArray(element.pressures)
    ? element.pressures
    : [];
  const nextPoints = points.slice(0, pointCount);
  return {
    ...element,
    points: nextPoints,
    pressures: pressures.slice(0, pointCount),
    lastCommittedPoint: nextPoints[nextPoints.length - 1] ?? null,
    version: (element.version || 1) + versionBump,
    versionNonce: Math.floor(Math.random() * 2147483647),
    updated: Date.now(),
  };
}

async function drawFreeformElements(
  api: ExcalidrawAPI,
  elements: CanvasElement[],
  options: { playback: boolean; speedMs: number },
) {
  const existing = [...api.getSceneElements()];
  const ids = elements.map((element) => element.id);

  if (!options.playback) {
    api.updateScene({
      elements: [...existing, ...elements],
      appState: { selectedElementIds: selectedElementIds(ids) },
    });
    return;
  }

  let scene = [...existing];
  for (const element of elements) {
    const points = Array.isArray(element.points) ? element.points : [];
    if (points.length < 6) {
      scene = [...scene, element];
      api.updateScene({
        elements: scene,
        appState: { selectedElementIds: selectedElementIds(ids) },
      });
      await wait(options.speedMs);
      continue;
    }

    const frames = Math.min(28, Math.max(6, Math.ceil(points.length / 5)));
    scene = [...scene, partialFreedrawElement(element, 2, 1)];
    api.updateScene({
      elements: scene,
      appState: { selectedElementIds: selectedElementIds(ids) },
    });

    for (let frame = 1; frame <= frames; frame += 1) {
      const pointCount = Math.min(
        points.length,
        Math.max(2, Math.ceil((points.length * frame) / frames)),
      );
      const partial =
        pointCount >= points.length
          ? element
          : partialFreedrawElement(element, pointCount, frame + 1);
      scene = scene.map((item) =>
        item.id === element.id ? partial : item,
      );
      api.updateScene({
        elements: scene,
        appState: { selectedElementIds: selectedElementIds(ids) },
      });
      if (pointCount < points.length) await wait(options.speedMs);
    }
  }
}

export async function executeEngineCommand(
  api: ExcalidrawAPI,
  command: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  switch (command) {
    case "set_active_tool": {
      api.setActiveTool?.({
        type: typeof params.type === "string" ? params.type : "selection",
        locked: params.locked === true,
      });
      return { ok: true, message: `Tool set to ${params.type || "selection"}` };
    }

    case "analyze_canvas": {
      return { ok: true, canvas: analyzeCanvas(api) };
    }

    case "prepare_workspace": {
      const elements = api.getSceneElements();
      const existingBounds = sceneBounds(elements);
      const currentViewport = getViewportMetrics(api);
      const targetZoom = clamp(
        Number(params.zoom) || DEFAULT_WORKSPACE_ZOOM,
        0.5,
        1.2,
      );
      const targetViewport = viewportAtCenter(
        api,
        currentViewport.center,
        targetZoom,
      );
      const padding = Number(params.padding) || 320;
      const moveExisting =
        params.moveExisting === "right" ? "right" : "left";
      let dx = 0;

      if (existingBounds) {
        dx =
          moveExisting === "left"
            ? Math.min(0, targetViewport.x - padding - existingBounds.right)
            : Math.max(0, targetViewport.right + padding - existingBounds.x);
      }

      if (existingBounds && Math.abs(dx) > 1) {
        api.updateScene({
          elements: elements.map((element) =>
            element.isDeleted
              ? element
              : versionedElement(element, {
                  x: numberValue(element.x) + dx,
                }),
          ),
        });
      }

      setViewport(api, currentViewport.center, targetZoom);
      return {
        ok: true,
        message: existingBounds
          ? `Prepared workspace by moving existing content ${moveExisting}`
          : "Workspace is already empty",
        movedBy: Math.round(dx),
        canvas: analyzeCanvas(api),
      };
    }

    case "create_shape": {
      const { convertToExcalidrawElements } = await import(
        "@excalidraw/excalidraw"
      );
      const requestedShape = String(
        params.shape || params.type || "rectangle",
      ).toLowerCase();
      const shape = ["rectangle", "ellipse", "diamond", "text"].includes(
        requestedShape,
      )
        ? requestedShape
        : "rectangle";
      const label =
        typeof params.label === "string" ? params.label.trim() : "";
      const defaultWidth =
        shape === "text"
          ? Math.max(120, Math.min(360, (label || "Text").length * 12))
          : Math.max(shape === "diamond" ? 150 : 170, label.length * 8 + 48);
      const width = Number(params.width) || defaultWidth;
      const height = Number(params.height) || (shape === "diamond" ? 110 : 88);
      const fallback = getViewportCenter(api, width, height);
      const hasExplicitPosition = finiteNumber(params.x) && finiteNumber(params.y);
      const openSpot = hasExplicitPosition
        ? null
        : findOpenSpot(api, width, height);
      const x = finiteNumber(params.x) ? Number(params.x) : (openSpot?.x ?? fallback.x);
      const y = finiteNumber(params.y) ? Number(params.y) : (openSpot?.y ?? fallback.y);

      const template =
        shape === "text"
          ? {
              type: "text",
              x,
              y,
              text: label || "Text",
              fontSize: Number(params.fontSize) || 24,
            }
          : {
              type: shape,
              x,
              y,
              width,
              height,
              ...(label ? { label: { text: label } } : {}),
              ...styleUpdates(params),
            };

      const created = convertToExcalidrawElements(
        [template] as Parameters<typeof convertToExcalidrawElements>[0],
        { regenerateIds: true },
      ) as Array<{ id: string }>;
      const ids = created.map((element) => element.id);

      api.updateScene({
        elements: [...api.getSceneElements(), ...created],
        appState: { selectedElementIds: selectedElementIds(ids) },
      });

      return {
        ok: true,
        message: label ? `Created ${shape} "${label}"` : `Created ${shape}`,
        createdIds: ids,
      };
    }

    case "create_connector": {
      const { convertToExcalidrawElements } = await import(
        "@excalidraw/excalidraw"
      );
      const elements = api.getSceneElements();
      const elementsById = mapById(elements);
      const startElement =
        typeof params.startElementId === "string"
          ? elementsById.get(params.startElementId)
          : undefined;
      const endElement =
        typeof params.endElementId === "string"
          ? elementsById.get(params.endElementId)
          : undefined;
      const fallback = getViewportCenter(api, 220, 1);
      const boundConnection =
        startElement && endElement
          ? connectionPoint(startElement, endElement)
          : null;
      const start = startElement
        ? boundConnection?.start ?? getElementCenter(startElement)
        : {
            x: finiteNumber(params.x1) ? Number(params.x1) : fallback.x,
            y: finiteNumber(params.y1) ? Number(params.y1) : fallback.y,
          };
      const end = endElement
        ? boundConnection?.end ?? getElementCenter(endElement)
        : {
            x: finiteNumber(params.x2) ? Number(params.x2) : fallback.x + 220,
            y: finiteNumber(params.y2) ? Number(params.y2) : fallback.y,
          };
      const kind = params.kind === "line" ? "line" : "arrow";
      const label =
        typeof params.label === "string" && params.label.trim()
          ? { text: params.label.trim() }
          : undefined;

      const created = convertToExcalidrawElements(
        [
          {
            type: kind,
            x: start.x,
            y: start.y,
            points: [
              [0, 0],
              [end.x - start.x, end.y - start.y],
            ],
            start: startElement ? { id: startElement.id } : undefined,
            end: endElement ? { id: endElement.id } : undefined,
            label,
            strokeColor: params.strokeColor,
            strokeWidth: params.strokeWidth,
            strokeStyle: params.strokeStyle,
            endArrowhead:
              params.endArrowhead === undefined
                ? kind === "arrow"
                  ? "arrow"
                  : null
                : params.endArrowhead,
          },
        ] as Parameters<typeof convertToExcalidrawElements>[0],
        { regenerateIds: true },
      ) as Array<{ id: string }>;
      const ids = created.map((element) => element.id);

      api.updateScene({
        elements: [...elements, ...created],
        appState: { selectedElementIds: selectedElementIds(ids) },
      });
      return { ok: true, message: `Created ${kind}`, createdIds: ids };
    }

    case "draw_freeform": {
      const parsed = parseFreeformRequest(params);
      if (!parsed.ok) return { ok: false, error: parsed.error };

      const hasExplicitOrigin =
        finiteNumber(params.x) && finiteNumber(params.y);
      const origin = hasExplicitOrigin
        ? { x: Number(params.x), y: Number(params.y) }
        : findOpenSpot(
            api,
            parsed.request.localBounds.width + 32,
            parsed.request.localBounds.height + 32,
          );
      const { elements, metrics } = createFreeformElements(
        parsed.request,
        origin,
      );
      const speedMs = clamp(Number(params.speedMs) || 22, 8, 120);

      await drawFreeformElements(api, elements, {
        playback: params.playback !== false,
        speedMs,
      });

      if (params.focus !== false) {
        setViewport(
          api,
          {
            x: metrics.bounds.x + metrics.bounds.width / 2,
            y: metrics.bounds.y + metrics.bounds.height / 2,
          },
          clamp(Number(params.zoom) || DEFAULT_WORKSPACE_ZOOM, 0.45, 1.2),
        );
      }

      return {
        ok: true,
        message: `Drew ${metrics.strokeCount} freeform stroke${
          metrics.strokeCount === 1 ? "" : "s"
        }`,
        createdIds: elements.map((element) => element.id),
        metrics,
        canvas: analyzeCanvas(api),
      };
    }

    case "move_elements": {
      const dx = Number(params.dx) || 0;
      const dy = Number(params.dy) || 0;
      const ids = new Set<string>(getTargetIds(api, params));
      const elements = api.getSceneElements();
      const moveAll = ids.size === 0 && params.moveAll === true;
      const updated = elements.map((element) => {
        if (!moveAll && !ids.has(element.id)) return element;
        return versionedElement(element, {
          x: numberValue(element.x) + dx,
          y: numberValue(element.y) + dy,
        });
      });
      api.updateScene({ elements: updated });
      return {
        ok: true,
        message: `Moved ${moveAll ? elements.length : ids.size} elements`,
      };
    }

    case "resize_elements": {
      const ids = new Set<string>(getTargetIds(api, params));
      if (ids.size === 0) return { ok: false, error: "No elements selected" };
      const scale = Number(params.scale) || 1;
      const updated = api.getSceneElements().map((element) => {
        if (!ids.has(element.id)) return element;
        const width = finiteNumber(params.width)
          ? Number(params.width)
          : numberValue(element.width, 1) * scale;
        const height = finiteNumber(params.height)
          ? Number(params.height)
          : numberValue(element.height, 1) * scale;
        return versionedElement(element, { width, height });
      });
      api.updateScene({ elements: updated });
      return { ok: true, message: `Resized ${ids.size} elements` };
    }

    case "set_style": {
      const updates = styleUpdates(params);
      const ids = new Set<string>(getTargetIds(api, params));

      if (ids.size === 0) {
        api.updateScene({
          appState: {
            currentItemStrokeColor: updates.strokeColor,
            currentItemBackgroundColor: updates.backgroundColor,
            currentItemFillStyle: updates.fillStyle,
            currentItemStrokeWidth: updates.strokeWidth,
            currentItemStrokeStyle: updates.strokeStyle,
            currentItemRoughness: updates.roughness,
            currentItemOpacity: updates.opacity,
            currentItemFontSize: updates.fontSize,
          },
        });
        return { ok: true, message: "Updated current drawing style" };
      }

      const updated = api.getSceneElements().map((element) =>
        ids.has(element.id) ? versionedElement(element, updates) : element,
      );
      api.updateScene({ elements: updated });
      return { ok: true, message: `Styled ${ids.size} elements` };
    }

    case "delete_elements": {
      const elements = api.getSceneElements();
      const ids = new Set<string>(getTargetIds(api, params));
      if (ids.size === 0) return { ok: false, error: "No elements selected" };

      for (const element of elements) {
        if (
          typeof element.containerId === "string" &&
          ids.has(element.containerId)
        ) {
          ids.add(element.id);
        }
        const bound = Array.isArray(element.boundElements)
          ? element.boundElements
          : [];
        if (ids.has(element.id)) {
          for (const boundElement of bound) {
            if (
              boundElement &&
              typeof boundElement === "object" &&
              typeof (boundElement as { id?: unknown }).id === "string"
            ) {
              ids.add((boundElement as { id: string }).id);
            }
          }
        }
      }

      const updated = elements.map((element) =>
        ids.has(element.id) ? versionedElement(element, { isDeleted: true }) : element,
      );
      api.updateScene({ elements: updated, appState: { selectedElementIds: {} } });
      return { ok: true, message: `Deleted ${ids.size} elements` };
    }

    case "duplicate_elements": {
      const elements = api.getSceneElements();
      const ids = new Set<string>(getTargetIds(api, params));
      if (ids.size === 0) return { ok: false, error: "No elements selected" };

      const dx = Number(params.dx) || 32;
      const dy = Number(params.dy) || 32;
      const originals = elements.filter(
        (element) => ids.has(element.id) && !element.isDeleted,
      );
      const idMap = new Map(
        originals.map((element) => [element.id, createLocalId("el")]),
      );
      const groupMap = new Map<string, string>();
      const duplicates = originals.map((element) => {
        const nextGroupIds = Array.isArray(element.groupIds)
          ? element.groupIds.map((groupId) => {
              if (!groupMap.has(groupId)) groupMap.set(groupId, createLocalId("grp"));
              return groupMap.get(groupId)!;
            })
          : [];
        return versionedElement(element, {
          id: idMap.get(element.id),
          x: numberValue(element.x) + dx,
          y: numberValue(element.y) + dy,
          groupIds: nextGroupIds,
          containerId:
            typeof element.containerId === "string" && idMap.has(element.containerId)
              ? idMap.get(element.containerId)
              : element.containerId,
          boundElements: Array.isArray(element.boundElements)
            ? element.boundElements.map((boundElement) => {
                if (
                  boundElement &&
                  typeof boundElement === "object" &&
                  typeof (boundElement as { id?: unknown }).id === "string" &&
                  idMap.has((boundElement as { id: string }).id)
                ) {
                  return {
                    ...boundElement,
                    id: idMap.get((boundElement as { id: string }).id),
                  };
                }
                return boundElement;
              })
            : element.boundElements,
        });
      });
      const duplicateIds = duplicates.map((element) => element.id);
      api.updateScene({
        elements: [...elements, ...duplicates],
        appState: { selectedElementIds: selectedElementIds(duplicateIds) },
      });
      return { ok: true, message: `Duplicated ${duplicates.length} elements`, createdIds: duplicateIds };
    }

    case "update_elements": {
      const updates =
        params.updates && typeof params.updates === "object"
          ? (params.updates as Record<string, Record<string, unknown>>)
          : {};
      const ids = new Set(Object.keys(updates));
      const elements = api.getSceneElements();
      const updated = elements.map((element) => {
        if (!ids.has(element.id)) return element;
        return versionedElement(element, updates[element.id] || {});
      });
      api.updateScene({ elements: updated });
      return { ok: true, message: `Updated ${ids.size} elements` };
    }

    case "arrange_elements": {
      const ids = new Set<string>(getTargetIds(api, params));
      if (ids.size === 0) return { ok: false, error: "No elements selected" };
      const action = String(params.action || "front");
      const elements = [...api.getSceneElements()];
      let arranged = elements;

      if (action === "front") {
        arranged = [
          ...elements.filter((element) => !ids.has(element.id)),
          ...elements.filter((element) => ids.has(element.id)),
        ];
      } else if (action === "back") {
        arranged = [
          ...elements.filter((element) => ids.has(element.id)),
          ...elements.filter((element) => !ids.has(element.id)),
        ];
      } else {
        const direction = action === "backward" ? -1 : 1;
        arranged = [...elements];
        const range =
          direction > 0
            ? [...arranged.keys()].reverse()
            : [...arranged.keys()];
        for (const index of range) {
          const swapIndex = index + direction;
          if (
            swapIndex < 0 ||
            swapIndex >= arranged.length ||
            !ids.has(arranged[index]!.id) ||
            ids.has(arranged[swapIndex]!.id)
          ) {
            continue;
          }
          [arranged[index], arranged[swapIndex]] = [
            arranged[swapIndex]!,
            arranged[index]!,
          ];
        }
      }

      api.updateScene({ elements: arranged });
      return { ok: true, message: `Arranged ${ids.size} elements ${action}` };
    }

    case "align_elements": {
      const ids = new Set<string>(getTargetIds(api, params));
      const action = String(params.action || "");
      const elements = api.getSceneElements();
      const targets = elements.filter((element) => ids.has(element.id));
      if (targets.length < 2) {
        return { ok: false, error: "At least two elements are required" };
      }

      const boxes = targets.map(getBBox);
      const minX = Math.min(...boxes.map((box) => box.x));
      const maxRight = Math.max(...boxes.map((box) => box.right));
      const minY = Math.min(...boxes.map((box) => box.y));
      const maxBottom = Math.max(...boxes.map((box) => box.bottom));
      const centerX = (minX + maxRight) / 2;
      const centerY = (minY + maxBottom) / 2;

      const targetUpdates = new Map<string, Record<string, unknown>>();
      for (const element of targets) {
        const box = getBBox(element);
        if (action === "left") targetUpdates.set(element.id, { x: minX });
        if (action === "right") targetUpdates.set(element.id, { x: maxRight - box.width });
        if (action === "center") targetUpdates.set(element.id, { x: centerX - box.width / 2 });
        if (action === "top") targetUpdates.set(element.id, { y: minY });
        if (action === "bottom") targetUpdates.set(element.id, { y: maxBottom - box.height });
        if (action === "middle") targetUpdates.set(element.id, { y: centerY - box.height / 2 });
      }

      if (action === "distribute_horizontal") {
        const sorted = [...targets].sort((a, b) => numberValue(a.x) - numberValue(b.x));
        const first = getBBox(sorted[0]!);
        const last = getBBox(sorted[sorted.length - 1]!);
        const span = last.cx - first.cx;
        sorted.forEach((element, index) => {
          const box = getBBox(element);
          targetUpdates.set(element.id, {
            x: first.cx + (span * index) / (sorted.length - 1) - box.width / 2,
          });
        });
      }

      if (action === "distribute_vertical") {
        const sorted = [...targets].sort((a, b) => numberValue(a.y) - numberValue(b.y));
        const first = getBBox(sorted[0]!);
        const last = getBBox(sorted[sorted.length - 1]!);
        const span = last.cy - first.cy;
        sorted.forEach((element, index) => {
          const box = getBBox(element);
          targetUpdates.set(element.id, {
            y: first.cy + (span * index) / (sorted.length - 1) - box.height / 2,
          });
        });
      }

      if (targetUpdates.size === 0) {
        return { ok: false, error: `Unknown align action: ${action}` };
      }

      const updated = elements.map((element) =>
        targetUpdates.has(element.id)
          ? versionedElement(element, targetUpdates.get(element.id)!)
          : element,
      );
      api.updateScene({ elements: updated });
      return { ok: true, message: `Aligned ${targets.length} elements` };
    }

    case "group_elements": {
      const ids = new Set<string>(getTargetIds(api, params));
      if (ids.size === 0) return { ok: false, error: "No elements selected" };
      const action = params.action === "ungroup" ? "ungroup" : "group";
      const groupId = createLocalId("grp");
      const updated = api.getSceneElements().map((element) => {
        if (!ids.has(element.id)) return element;
        if (action === "ungroup") return versionedElement(element, { groupIds: [] });
        return versionedElement(element, {
          groupIds: [...(Array.isArray(element.groupIds) ? element.groupIds : []), groupId],
        });
      });
      api.updateScene({ elements: updated, appState: { selectedElementIds: selectedElementIds([...ids]) } });
      return { ok: true, message: `${action === "group" ? "Grouped" : "Ungrouped"} ${ids.size} elements` };
    }

    case "select_elements": {
      const ids = stringArray(params.elementIds);
      api.updateScene({ appState: { selectedElementIds: selectedElementIds(ids) } });
      return { ok: true, message: `Selected ${ids.length} elements` };
    }

    case "repair_layout": {
      const padding = Number(params.padding) || 44;
      const elements = api.getSceneElements();
      const targets = visibleElements(elements).filter(isLayoutSubject);
      const moves = new Map<string, { x: number; y: number }>();

      for (let i = 0; i < targets.length; i += 1) {
        const first = targets[i]!;
        const firstBox = expandBounds(
          getElementBounds(first),
          padding / 2,
        );
        for (let j = i + 1; j < targets.length; j += 1) {
          const second = targets[j]!;
          const secondBox = expandBounds(
            getElementBounds(second),
            padding / 2,
          );
          if (overlapRatio(firstBox, secondBox) <= 0.03) continue;
          const current = moves.get(second.id) ?? {
            x: numberValue(second.x),
            y: numberValue(second.y),
          };
          moves.set(second.id, {
            x: Math.max(current.x, firstBox.right + padding),
            y: current.y,
          });
        }
      }

      const updated = elements.map((element) =>
        moves.has(element.id)
          ? versionedElement(element, moves.get(element.id)!)
          : element,
      );
      api.updateScene({ elements: updated });
      return {
        ok: true,
        message: `Repaired spacing for ${moves.size} elements`,
        movedElementCount: moves.size,
        canvas: analyzeCanvas(api),
      };
    }

    case "focus_region": {
      const ids = new Set<string>(stringArray(params.elementIds));
      const targetBounds =
        ids.size > 0
          ? boundsForIds(api, ids)
          : finiteNumber(params.x) &&
              finiteNumber(params.y) &&
              finiteNumber(params.width) &&
              finiteNumber(params.height)
            ? {
                x: Number(params.x),
                y: Number(params.y),
                width: Number(params.width),
                height: Number(params.height),
                right: Number(params.x) + Number(params.width),
                bottom: Number(params.y) + Number(params.height),
                cx: Number(params.x) + Number(params.width) / 2,
                cy: Number(params.y) + Number(params.height) / 2,
              }
            : sceneBounds(api.getSceneElements());
      if (!targetBounds) {
        return { ok: false, error: "No region to focus" };
      }

      const state = api.getAppState() || {};
      const viewportWidth =
        typeof state.width === "number" ? state.width : window.innerWidth;
      const viewportHeight =
        typeof state.height === "number" ? state.height : window.innerHeight;
      const maxZoom = clamp(
        Number(params.zoom) || DEFAULT_WORKSPACE_ZOOM,
        0.35,
        1.2,
      );
      const padding = Number(params.padding) || 96;
      const fitZoom = Math.min(
        maxZoom,
        viewportWidth / Math.max(1, targetBounds.width + padding * 2),
        viewportHeight / Math.max(1, targetBounds.height + padding * 2),
      );
      const zoom =
        params.fit === true ? clamp(fitZoom, 0.35, maxZoom) : maxZoom;

      setViewport(
        api,
        { x: targetBounds.cx, y: targetBounds.cy },
        zoom,
      );
      return {
        ok: true,
        message: `Focused region at ${Math.round(zoom * 100)}%`,
        zoom,
      };
    }

    case "zoom_to_fit": {
      const ids = new Set<string>(stringArray(params.elementIds));
      const elements = ids.size
        ? api.getSceneElements().filter((element) => ids.has(element.id))
        : api.getSceneElements();
      api.scrollToContent?.(elements, {
        fitToViewport: true,
        fitToContent: true,
        animate: true,
      });
      return { ok: true, message: `Zoomed to ${elements.length} elements` };
    }

    case "laser_start": {
      clearLaserTimers();
      setLaser(
        api,
        {
          x: finiteNumber(params.x) ? Number(params.x) : 0,
          y: finiteNumber(params.y) ? Number(params.y) : 0,
        },
        "down",
      );
      return { ok: true, message: "Laser started" };
    }

    case "laser_move": {
      setLaser(
        api,
        {
          x: finiteNumber(params.x) ? Number(params.x) : numberValue(laserLastPoint?.x),
          y: finiteNumber(params.y) ? Number(params.y) : numberValue(laserLastPoint?.y),
        },
        "down",
      );
      return { ok: true, message: "Laser moved" };
    }

    case "laser_end": {
      finishLaser(api);
      return { ok: true, message: "Laser ended" };
    }

    case "laser_trace_path": {
      const points = parsePointList(params.points);
      if (points.length === 0) return { ok: false, error: "points are required" };
      const durationMs = scheduleLaserPath(
        api,
        points,
        Number(params.speedMs) || 24,
        Number(params.releaseDelayMs) || 1200,
      );
      return { ok: true, message: `Tracing ${points.length} laser points`, durationMs };
    }

    case "laser_explain_elements": {
      const ids = stringArray(params.elementIds);
      const elementsById = mapById(api.getSceneElements());
      const targets = ids.flatMap((id) => {
        const element = elementsById.get(id);
        return element && !element.isDeleted ? [element] : [];
      });
      if (targets.length === 0) {
        return { ok: false, error: "No target elements found" };
      }

      const start =
        laserLastPoint ??
        getViewportCenter(api, 0, 0);
      const points: Point[] = [];
      let from = start;
      for (const target of targets) {
        const center = getElementCenter(target);
        points.push(...humanCursorPath(from, center, 52).slice(points.length ? 1 : 0));
        points.push(...dwellAt(center, Number(params.dwellFrames) || 28));
        if (params.circle !== false) points.push(...circlePathAround(target, 42));
        from = center;
      }

      const durationMs = scheduleLaserPath(
        api,
        points,
        Number(params.speedMs) || 22,
        Number(params.releaseDelayMs) || 1300,
      );
      return {
        ok: true,
        message: `Laser explanation path over ${targets.length} elements`,
        durationMs,
        elementCount: targets.length,
      };
    }

    case "laser_point_at_element": {
      const target = api
        .getSceneElements()
        .find((element) => element.id === params.elementId);
      if (!target) {
        return { ok: false, error: `Element ${params.elementId} not found` };
      }

      const center = getElementCenter(target);
      const from =
        laserLastPoint ??
        (finiteNumber(params.fromX) && finiteNumber(params.fromY)
          ? { x: Number(params.fromX), y: Number(params.fromY) }
          : getViewportCenter(api, 0, 0));
      const points = [
        ...humanCursorPath(from, center, 64),
        ...dwellAt(center, Number(params.dwellFrames) || 20),
        ...(params.circle === false ? [] : circlePathAround(target)),
      ];
      const durationMs = scheduleLaserPath(
        api,
        points,
        Number(params.speedMs) || 22,
        Number(params.releaseDelayMs) || 1200,
      );
      return { ok: true, message: "Laser pointing at element", center, durationMs };
    }

    case "clear_laser": {
      clearLaser(api);
      return { ok: true, message: "Laser cleared" };
    }

    default:
      return { ok: false, error: `Unknown command: ${command}` };
  }
}
