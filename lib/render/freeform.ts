import type { ExcalidrawElement } from "@/types/diagram";

type Point = { x: number; y: number; pressure?: number };
type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

export type FreeformStroke = {
  anchors: Point[];
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  pressure?: number;
  wobble?: number;
  spacing?: number;
  closed?: boolean;
};

export type FreeformRequest = {
  strokes: FreeformStroke[];
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  pressure: number;
  wobble: number;
  spacing: number;
  scale: number;
  group: boolean;
  seed: number;
  localBounds: Bounds;
};

export type FreeformResult = {
  elements: ExcalidrawElement[];
  metrics: {
    strokeCount: number;
    pointCount: number;
    anchorCount: number;
    averagePointsPerStroke: number;
    bounds: Bounds;
  };
};

const STYLE_PRESETS = {
  pencil: {
    strokeWidth: 3,
    opacity: 88,
    pressure: 0.5,
    wobble: 1.7,
    spacing: 11,
  },
  pen: {
    strokeWidth: 2,
    opacity: 96,
    pressure: 0.55,
    wobble: 0.9,
    spacing: 9,
  },
  marker: {
    strokeWidth: 5,
    opacity: 92,
    pressure: 0.65,
    wobble: 1.1,
    spacing: 8,
  },
} as const;

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function hashSeed(value: unknown) {
  const input = String(value ?? `${Date.now()}_${Math.random()}`);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    let next = (seed += 0x6d2b79f5);
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function parsePoint(value: unknown): Point | null {
  if (
    Array.isArray(value) &&
    finiteNumber(value[0]) &&
    finiteNumber(value[1])
  ) {
    return {
      x: value[0],
      y: value[1],
      pressure: finiteNumber(value[2]) ? value[2] : undefined,
    };
  }

  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!finiteNumber(record.x) || !finiteNumber(record.y)) return null;
  return {
    x: record.x,
    y: record.y,
    pressure: finiteNumber(record.pressure) ? record.pressure : undefined,
  };
}

function parsePoints(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point) => {
    const parsed = parsePoint(point);
    return parsed ? [parsed] : [];
  });
}

function stylePreset(value: unknown) {
  if (value === "pen") return STYLE_PRESETS.pen;
  if (value === "marker") return STYLE_PRESETS.marker;
  return STYLE_PRESETS.pencil;
}

function parseStroke(value: unknown): FreeformStroke | null {
  if (Array.isArray(value)) {
    const anchors = parsePoints(value);
    return anchors.length > 0 ? { anchors } : null;
  }

  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const anchors = parsePoints(record.points);
  if (anchors.length === 0) return null;
  return {
    anchors,
    strokeColor:
      typeof record.strokeColor === "string" ? record.strokeColor : undefined,
    strokeWidth: finiteNumber(record.strokeWidth)
      ? clamp(record.strokeWidth, 0.5, 24)
      : undefined,
    opacity: finiteNumber(record.opacity)
      ? clamp(record.opacity, 1, 100)
      : undefined,
    pressure: finiteNumber(record.pressure)
      ? clamp(record.pressure, 0.05, 1)
      : undefined,
    wobble: finiteNumber(record.wobble)
      ? clamp(record.wobble, 0, 8)
      : undefined,
    spacing: finiteNumber(record.spacing)
      ? clamp(record.spacing, 4, 40)
      : undefined,
    closed: record.closed === true,
  };
}

function boundsOfPoints(points: Point[]): Bounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
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
  };
}

function boundsOfStrokes(strokes: FreeformStroke[]) {
  return boundsOfPoints(strokes.flatMap((stroke) => stroke.anchors));
}

function scaleStroke(stroke: FreeformStroke, scale: number): FreeformStroke {
  return {
    ...stroke,
    anchors: stroke.anchors.map((point) => ({
      ...point,
      x: point.x * scale,
      y: point.y * scale,
    })),
  };
}

export function parseFreeformRequest(
  params: Record<string, unknown>,
): { ok: true; request: FreeformRequest } | { ok: false; error: string } {
  const preset = stylePreset(params.style);
  const rawStrokes = Array.isArray(params.strokes)
    ? params.strokes
    : params.points
      ? [params.points]
      : [];
  const parsedStrokes = rawStrokes.flatMap((raw) => {
    const stroke = parseStroke(raw);
    return stroke ? [stroke] : [];
  });

  if (parsedStrokes.length === 0) {
    return { ok: false, error: "strokes or points are required" };
  }

  const scale = clamp(numberValue(params.scale, 1), 0.05, 12);
  const strokes = parsedStrokes.map((stroke) => scaleStroke(stroke, scale));
  const localBounds = boundsOfStrokes(strokes);

  return {
    ok: true,
    request: {
      strokes,
      strokeColor: stringValue(params.strokeColor, "#1e1e1e"),
      strokeWidth: clamp(
        numberValue(params.strokeWidth, preset.strokeWidth),
        0.5,
        24,
      ),
      opacity: clamp(numberValue(params.opacity, preset.opacity), 1, 100),
      pressure: clamp(numberValue(params.pressure, preset.pressure), 0.05, 1),
      wobble: clamp(numberValue(params.wobble, preset.wobble), 0, 8),
      spacing: clamp(numberValue(params.spacing, preset.spacing), 4, 40),
      scale,
      group: params.group !== false,
      seed: hashSeed(params.seed),
      localBounds,
    },
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function smoothPoints(points: Point[], amount: number) {
  if (points.length < 4 || amount <= 0) return points;
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    const prev = points[index - 1]!;
    const next = points[index + 1]!;
    return {
      ...point,
      x: point.x * (1 - amount) + ((prev.x + next.x) / 2) * amount,
      y: point.y * (1 - amount) + ((prev.y + next.y) / 2) * amount,
    };
  });
}

function humanizeStroke(
  stroke: FreeformStroke,
  options: {
    pressure: number;
    wobble: number;
    spacing: number;
    seed: number;
  },
) {
  let anchors = stroke.anchors;
  if (stroke.closed && anchors.length > 2) {
    const first = anchors[0]!;
    const last = anchors[anchors.length - 1]!;
    if (distance(first, last) > 0.1) anchors = [...anchors, first];
  }

  if (anchors.length === 1) {
    const point = anchors[0]!;
    anchors = [
      { ...point, x: point.x - 0.5 },
      { ...point, x: point.x + 0.5 },
    ];
  }

  const segmentLengths = anchors
    .slice(0, -1)
    .map((point, index) => distance(point, anchors[index + 1]!));
  const totalLength = Math.max(
    1,
    segmentLengths.reduce((sum, length) => sum + length, 0),
  );
  const rand = mulberry32(options.seed);
  const phaseA = rand() * Math.PI * 2;
  const phaseB = rand() * Math.PI * 2;
  const freqA = 1.4 + rand() * 1.8;
  const freqB = 4.5 + rand() * 3.5;
  const generated: Point[] = [];
  let travelled = 0;

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index]!;
    const end = anchors[index + 1]!;
    const length = segmentLengths[index] || 1;
    const steps = Math.max(3, Math.min(72, Math.ceil(length / options.spacing)));
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const invLength = 1 / Math.max(1, Math.hypot(dx, dy));
    const nx = -dy * invLength;
    const ny = dx * invLength;
    const tx = dx * invLength;
    const ty = dy * invLength;

    for (let step = 0; step <= steps; step += 1) {
      if (index > 0 && step === 0) continue;
      const rawT = step / steps;
      const humanT = clamp(
        rawT + Math.sin(rawT * Math.PI) * (rand() - 0.5) * 0.035,
        0,
        1,
      );
      const globalT = clamp((travelled + length * rawT) / totalLength, 0, 1);
      const envelope = Math.pow(Math.sin(globalT * Math.PI), 0.72);
      const wave =
        Math.sin(globalT * Math.PI * 2 * freqA + phaseA) * 0.7 +
        Math.sin(globalT * Math.PI * 2 * freqB + phaseB) * 0.22;
      const noise = (rand() - 0.5) * 0.75;
      const wobble = options.wobble * envelope * (wave + noise);
      const tangentLag = (rand() - 0.5) * options.wobble * envelope * 0.34;
      const pressureSource =
        start.pressure ??
        end.pressure ??
        stroke.pressure ??
        options.pressure;
      const pressure =
        pressureSource +
        Math.sin(globalT * Math.PI * 2 + phaseB) * 0.045 +
        (rand() - 0.5) * 0.05 -
        (1 - envelope) * 0.07;

      generated.push({
        x: start.x + dx * humanT + nx * wobble + tx * tangentLag,
        y: start.y + dy * humanT + ny * wobble + ty * tangentLag,
        pressure: clamp(pressure, 0.12, 0.98),
      });
    }

    travelled += length;
  }

  return smoothPoints(generated, 0.18);
}

function createFreedrawElement({
  points,
  stroke,
  request,
  seed,
  groupIds,
}: {
  points: Point[];
  stroke: FreeformStroke;
  request: FreeformRequest;
  seed: number;
  groupIds: string[];
}): ExcalidrawElement {
  const bounds = boundsOfPoints(points);
  const localPoints = points.map((point) => [
    Number((point.x - bounds.x).toFixed(2)),
    Number((point.y - bounds.y).toFixed(2)),
  ]);
  const pressures = points.map((point) =>
    Number(clamp(point.pressure ?? request.pressure, 0.05, 1).toFixed(3)),
  );

  return {
    id: createLocalId("freeform"),
    type: "freedraw",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    angle: 0,
    strokeColor: stroke.strokeColor ?? request.strokeColor,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: stroke.strokeWidth ?? request.strokeWidth,
    strokeStyle: "solid",
    roughness: 0,
    opacity: stroke.opacity ?? request.opacity,
    roundness: null,
    seed,
    version: 1,
    versionNonce: Math.floor(Math.random() * 2147483647),
    index: null,
    isDeleted: false,
    groupIds,
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    points: localPoints,
    pressures,
    simulatePressure: false,
    lastCommittedPoint: localPoints[localPoints.length - 1] ?? null,
    customData: {
      drawcast: {
        type: "freeform",
        anchorCount: stroke.anchors.length,
        pointCount: localPoints.length,
      },
    },
  };
}

export function createFreeformElements(
  request: FreeformRequest,
  origin: { x: number; y: number },
): FreeformResult {
  const groupIds = request.group ? [createLocalId("grp")] : [];
  const dx = origin.x - request.localBounds.x;
  const dy = origin.y - request.localBounds.y;
  const elements = request.strokes.map((stroke, index) => {
    const translated: FreeformStroke = {
      ...stroke,
      anchors: stroke.anchors.map((point) => ({
        ...point,
        x: point.x + dx,
        y: point.y + dy,
      })),
    };
    const points = humanizeStroke(translated, {
      pressure: stroke.pressure ?? request.pressure,
      wobble: stroke.wobble ?? request.wobble,
      spacing: stroke.spacing ?? request.spacing,
      seed: request.seed + index * 101,
    });
    return createFreedrawElement({
      points,
      stroke,
      request,
      seed: request.seed + index,
      groupIds,
    });
  });

  const allPoints = elements.flatMap((element) => {
    const x = numberValue(element.x, 0);
    const y = numberValue(element.y, 0);
    return Array.isArray(element.points)
      ? (element.points as Array<[number, number]>).map(([px, py]) => ({
          x: x + px,
          y: y + py,
        }))
      : [];
  });
  const pointCount = allPoints.length;
  const bounds = boundsOfPoints(allPoints);

  return {
    elements,
    metrics: {
      strokeCount: elements.length,
      pointCount,
      anchorCount: request.strokes.reduce(
        (sum, stroke) => sum + stroke.anchors.length,
        0,
      ),
      averagePointsPerStroke:
        elements.length > 0 ? Math.round(pointCount / elements.length) : 0,
      bounds,
    },
  };
}
