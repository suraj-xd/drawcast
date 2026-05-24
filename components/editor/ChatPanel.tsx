"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  IconArrowUp,
  IconChevronDown,
  IconKeyboard,
  IconMicrophone,
  IconMicrophoneOff,
  IconX,
} from "@tabler/icons-react";
import type { ExcalidrawCanvasHandle } from "@/components/editor/ExcalidrawCanvas";
import type { Diagram } from "@/types/library";
import type { UserSettings } from "@/hooks/useUserSettings";
import type { DiagramPlaybackMode } from "@/lib/render/playback";
import { useRealtimeCanvasAgent } from "@/hooks/editor/useRealtimeCanvasAgent";
import BetaBadge from "./BetaBadge";

// ─── Public handle ─────────────────────────────────────────────

export interface ChatPanelHandle {
  focusInput: () => void;
}

// ─── Props ─────────────────────────────────────────────────────

interface ChatPanelProps {
  diagramId: string;
  diagram: Diagram | null | undefined;
  settings: UserSettings;
  isLoading: boolean;
  onFallbackSubmit: (
    text: string,
    options?: { playbackMode?: DiagramPlaybackMode },
  ) => void;
  canvasRef: React.RefObject<ExcalidrawCanvasHandle | null>;
  onError?: (msg: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Waveform sub-component ────────────────────────────────────

const BAR_COUNT = 30;

function WaveformBar({ isActive }: { isActive: boolean }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(id);
  }, [isActive]);

  return (
    <div className="flex items-center justify-center gap-[2px] h-6">
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const height = isActive
          ? 4 + 14 * Math.abs(Math.sin((tick * 0.15) + (i * 0.45) + Math.sin(i * 1.3)))
          : 4;
        return (
          <div
            key={i}
            className={`w-[3px] rounded-full transition-all duration-100 ${
              isActive ? "bg-foreground" : "bg-placeholder"
            }`}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}

// ─── ChatPanel ─────────────────────────────────────────────────

const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
  function ChatPanel(
    {
      diagramId,
      diagram,
      settings,
      isLoading,
      onFallbackSubmit,
      canvasRef,
      onError,
      isOpen,
      onClose,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [input, setInput] = useState("");
    const [showTextarea, setShowTextarea] = useState(true);
    const [playbackMode] = useState<DiagramPlaybackMode>("slow");

    const {
      isConnected,
      isListening,
      logs,
      assistantDraft,
      start,
      stop,
      sendText,
    } = useRealtimeCanvasAgent({
      diagramId,
      diagram,
      canvasRef,
      settings,
      playbackMode,
      onError,
    });

    // ── Imperative handle ──────────────────────────────────────

    useImperativeHandle(ref, () => ({
      focusInput() {
        textareaRef.current?.focus();
      },
    }));

    // ── Auto-scroll to bottom on new messages ──────────────────

    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs, assistantDraft]);

    // ── Send message ───────────────────────────────────────────

    const handleSend = useCallback(() => {
      const text = input.trim();
      if (!text) return;
      if (!sendText(text)) {
        onFallbackSubmit(text, { playbackMode });
      }
      setInput("");
    }, [input, sendText, onFallbackSubmit, playbackMode]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    };

    // ── Mic toggle ─────────────────────────────────────────────

    const toggleMic = () => {
      if (isConnected || isListening) {
        stop();
      } else {
        void start();
      }
    };

    // ── Filter visible messages (hide tool messages) ───────────

    const visibleLogs = logs.filter((entry) => entry.role !== "tool");

    // ── Bail if closed ─────────────────────────────────────────

    if (!isOpen) return null;

    // ── Render ─────────────────────────────────────────────────

    return (
      <>
        {/* Mobile backdrop */}
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />

        <div className={`
          flex flex-col bg-surface border-l border-border-subtle
          h-full w-[360px] shrink-0
          fixed inset-y-0 right-0 z-50
          lg:relative lg:z-auto
        `}>
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Chat</h2>
            <BetaBadge />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-subtle hover:bg-surface-hover hover:text-foreground transition-colors"
            aria-label="Close chat panel"
          >
            <IconX size={16} />
          </button>
        </div>

        {/* ── Messages area ──────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {visibleLogs.length === 0 && !assistantDraft ? (
            /* Empty state */
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover">
                <IconMicrophone size={22} className="text-placeholder" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Start a conversation
                </p>
                <p className="mt-1 text-xs text-subtle">
                  Type a message or use your mic
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleLogs.map((entry) => {
                if (entry.role === "user") {
                  return (
                    <div key={entry.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-chat-user-bubble px-4 py-2.5">
                        <p className="whitespace-pre-wrap text-sm text-foreground">
                          {entry.text}
                        </p>
                      </div>
                    </div>
                  );
                }

                /* assistant / system */
                return (
                  <div key={entry.id} className="flex items-start gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20">
                      <img
                        src="/drawcast-logo.png"
                        alt="Drawcast"
                        className="w-4 h-4 rounded-full"
                      />
                    </div>
                    <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-chat-ai-bubble px-4 py-2.5">
                      <p className="whitespace-pre-wrap text-sm text-foreground">
                        {entry.text}
                      </p>
                    </div>
                  </div>
                );
              })}

              {/* Streaming assistant draft */}
              {assistantDraft && (
                <div className="flex items-start gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20">
                    <img
                      src="/drawcast-logo.png"
                      alt="Drawcast"
                      width={16}
                      height={16}
                      className="rounded-full"
                    />
                  </div>
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-chat-ai-bubble px-4 py-2.5">
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {assistantDraft}
                      <span className="ml-1 inline-block h-3.5 w-[2px] animate-pulse bg-primary align-middle rounded-full" />
                    </p>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Input area ─────────────────────────────────────── */}
        <div className="px-3 pb-3 space-y-2">
          {/* Textarea (toggleable) */}
          {showTextarea && (
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter your message..."
                rows={2}
                className="w-full resize-none rounded-2xl bg-chat-input-bg px-4 py-3 pr-12 text-sm text-foreground placeholder-placeholder focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-white transition-colors hover:bg-primary-hover disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                <IconArrowUp size={16} />
              </button>
            </div>
          )}

          {/* Voice waveform bar */}
          <div className="flex items-center gap-2 rounded-2xl bg-surface-elevated px-3 py-2">
            <div className="flex-1 overflow-hidden">
              <WaveformBar isActive={isListening} />
            </div>

            {/* Mic toggle */}
            <button
              type="button"
              onClick={toggleMic}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                isListening
                  ? "bg-recording text-white"
                  : "text-subtle hover:bg-surface-hover hover:text-foreground"
              }`}
              aria-label={isListening ? "Stop listening" : "Start listening"}
            >
              {isListening ? (
                <IconMicrophoneOff size={17} />
              ) : (
                <IconMicrophone size={17} />
              )}
            </button>

            {/* Keyboard toggle */}
            <button
              type="button"
              onClick={() => setShowTextarea((v) => !v)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-subtle hover:bg-surface-hover hover:text-foreground transition-colors"
              aria-label={showTextarea ? "Hide keyboard" : "Show keyboard"}
            >
              {showTextarea ? (
                <IconChevronDown size={17} />
              ) : (
                <IconKeyboard size={17} />
              )}
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-subtle hover:bg-surface-hover hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <IconX size={17} />
            </button>
          </div>
        </div>
      </div>
      </>
    );
  },
);

ChatPanel.displayName = "ChatPanel";
export default ChatPanel;
