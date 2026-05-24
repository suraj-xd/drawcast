export type RealtimeModelId =
  | "gpt-realtime-mini"
  | "gpt-realtime-1.5"
  | "gpt-realtime-2";

export interface RealtimeModelPreset {
  id: RealtimeModelId;
  label: string;
  shortLabel: string;
  description: string;
  pricing: {
    textInput: number;
    textCachedInput: number;
    textOutput: number;
    audioInput: number;
    audioCachedInput: number;
    audioOutput: number;
    imageInput: number;
    imageCachedInput: number;
  };
}

export const DEFAULT_REALTIME_MODEL: RealtimeModelId = "gpt-realtime-2";

export const REALTIME_MODEL_PRESETS: RealtimeModelPreset[] = [
  {
    id: "gpt-realtime-mini",
    label: "Mini",
    shortLabel: "Mini",
    description: "Lowest-cost realtime voice model.",
    pricing: {
      textInput: 0.6,
      textCachedInput: 0.06,
      textOutput: 2.4,
      audioInput: 10,
      audioCachedInput: 0.3,
      audioOutput: 20,
      imageInput: 0.8,
      imageCachedInput: 0.08,
    },
  },
  {
    id: "gpt-realtime-1.5",
    label: "Medium",
    shortLabel: "1.5",
    description: "Fast flagship voice model for audio in and audio out.",
    pricing: {
      textInput: 4,
      textCachedInput: 0.4,
      textOutput: 16,
      audioInput: 32,
      audioCachedInput: 0.4,
      audioOutput: 64,
      imageInput: 5,
      imageCachedInput: 0.5,
    },
  },
  {
    id: "gpt-realtime-2",
    label: "Ultra",
    shortLabel: "2",
    description: "Most capable realtime voice model with stronger tool use.",
    pricing: {
      textInput: 4,
      textCachedInput: 0.4,
      textOutput: 24,
      audioInput: 32,
      audioCachedInput: 0.4,
      audioOutput: 64,
      imageInput: 5,
      imageCachedInput: 0.5,
    },
  },
];

export function getRealtimeModelPreset(
  model: string | null | undefined,
): RealtimeModelPreset {
  return (
    REALTIME_MODEL_PRESETS.find((preset) => preset.id === model) ??
    REALTIME_MODEL_PRESETS.find((preset) => preset.id === DEFAULT_REALTIME_MODEL)!
  );
}
