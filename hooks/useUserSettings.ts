"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_REALTIME_MODEL,
  getRealtimeModelPreset,
  type RealtimeModelId,
} from "@/lib/realtime/model-presets";

export type ThemeOption = 'dark' | 'light' | 'system';

export interface UserSettings {
  openaiRealtimeKey: string;
  openaiRealtimeModel: RealtimeModelId;
  theme: ThemeOption;
}

const STORAGE_KEY = "drawcast-user-settings";

const DEFAULT_SETTINGS: UserSettings = {
  openaiRealtimeKey: "",
  openaiRealtimeModel: DEFAULT_REALTIME_MODEL,
  theme: "dark",
};

function applyTheme(theme: ThemeOption) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }
  try {
    localStorage.setItem("drawcast-theme", theme);
  } catch {
    /* ignore */
  }
}

let clientCache: UserSettings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();
let didScheduleHydrate = false;

function load(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      openaiRealtimeKey:
        typeof parsed?.openaiRealtimeKey === "string"
          ? parsed.openaiRealtimeKey
          : "",
      openaiRealtimeModel: getRealtimeModelPreset(
        typeof parsed?.openaiRealtimeModel === "string"
          ? parsed.openaiRealtimeModel
          : undefined,
      ).id,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function getSnapshot(): UserSettings {
  return clientCache;
}

function getServerSnapshot(): UserSettings {
  return DEFAULT_SETTINGS;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(onChange);
    };
  }

  const onStorage = () => {
    clientCache = load();
    listeners.forEach((l) => l());
  };
  window.addEventListener("storage", onStorage);

  if (!didScheduleHydrate) {
    didScheduleHydrate = true;
    clientCache = load();
    queueMicrotask(() => {
      listeners.forEach((l) => l());
    });
  }

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useUserSettings() {
  const settings = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setSettings = useCallback(
    (update: UserSettings | ((prev: UserSettings) => UserSettings)) => {
      const next =
        typeof update === "function"
          ? (update as (prev: UserSettings) => UserSettings)(clientCache)
          : update;
      clientCache = {
        ...next,
        openaiRealtimeModel: getRealtimeModelPreset(next.openaiRealtimeModel).id,
        theme: next.theme ?? "dark",
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clientCache));
      } catch {
        /* ignore quota / private mode */
      }
      applyTheme(clientCache.theme);
      listeners.forEach((l) => l());
    },
    [],
  );

  return { settings, setSettings };
}
