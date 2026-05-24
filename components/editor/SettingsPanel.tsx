"use client";

import { useState, useEffect, useRef } from "react";
import { IconX } from "@tabler/icons-react";
import type { UserSettings } from "@/hooks/useUserSettings";
import {
  REALTIME_MODEL_PRESETS,
  type RealtimeModelId,
} from "@/lib/realtime/model-presets";

interface Props {
  settings: UserSettings;
  onSave: (settings: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
  onClose: () => void;
}

export default function SettingsPanel({ settings, onSave, onClose }: Props) {
  const [openaiRealtimeKey, setOpenaiRealtimeKey] = useState(
    settings.openaiRealtimeKey,
  );
  const [openaiRealtimeModel, setOpenaiRealtimeModel] =
    useState<RealtimeModelId>(settings.openaiRealtimeModel);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  function handleSave() {
    onSave((prev) => ({
      ...prev,
      openaiRealtimeKey: openaiRealtimeKey.trim(),
      openaiRealtimeModel,
    }));
    onClose();
  }

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 outline-none"
    >
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          <button
            onClick={onClose}
            className="text-placeholder hover:text-muted transition-colors"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="mb-4">
            <label className="text-xs font-medium text-subtle uppercase tracking-wider mb-2 block">
              Theme
            </label>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface p-1">
              {(["dark", "light", "system"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    onSave((prev) => ({ ...prev, theme: t }));
                  }}
                  className={`h-8 rounded-lg px-2 text-xs font-medium capitalize transition-colors ${
                    settings.theme === t
                      ? "bg-primary text-white"
                      : "text-subtle hover:bg-surface-hover hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-border-subtle">
            <label className="text-xs font-medium text-subtle">
              OpenAI Realtime API key
            </label>
            <input
              type="password"
              value={openaiRealtimeKey}
              onChange={(e) => setOpenaiRealtimeKey(e.target.value)}
              placeholder="sk-..."
              className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground placeholder-placeholder focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-placeholder">
              Required for live voice and canvas tool calls.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-subtle">
              Realtime voice model
            </label>
            <select
              value={openaiRealtimeModel}
              onChange={(e) =>
                setOpenaiRealtimeModel(e.target.value as RealtimeModelId)
              }
              className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {REALTIME_MODEL_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label} · {preset.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border-subtle">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 text-subtle hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="text-sm px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
