"use client";

import { useRef, useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { nanoid } from "nanoid";
import ExcalidrawCanvas, {
  ExcalidrawCanvasHandle,
} from "@/components/editor/ExcalidrawCanvas";
import ProjectSidebar from "@/components/editor/ProjectSidebar";
import ChatPanel, { type ChatPanelHandle } from "@/components/editor/ChatPanel";
import EditorTopBar from "@/components/editor/EditorTopBar";
import { type EditorMenuHandle } from "@/components/editor/EditorMenu";
import { useAutoSave } from "@/hooks/editor/useAutoSave";
import { useAIGeneration } from "@/hooks/editor/useAIGeneration";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import type { Diagram } from "@/types/library";
import { useUserSettings } from "@/hooks/useUserSettings";
import SettingsPanel from "@/components/editor/SettingsPanel";
import ShortcutsModal from "@/components/editor/ShortcutsModal";
import StorageBanner from "@/components/editor/StorageBanner";

interface Props {
  params: Promise<{ id: string }>;
}

export default function EditorPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const canvasRef = useRef<ExcalidrawCanvasHandle>(null);
  const chatRef = useRef<ChatPanelHandle>(null);
  const menuRef = useRef<EditorMenuHandle>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Open panels by default on desktop
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setSidebarOpen(true);
      setChatOpen(true);
    }
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { settings, setSettings } = useUserSettings();

  const diagram = useLiveQuery(() => db.diagrams.get(id), [id]);

  useEffect(() => {
    if (diagram) db.diagrams.update(id, { lastOpenedAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, diagram?.id]);

  const { triggerSave, forceSave, saveStatus } = useAutoSave(id, canvasRef);
  const { loadingPhase, isLoading, errorMessage, showError, handleSilence } =
    useAIGeneration({ id, diagram, canvasRef, settings });

  useEffect(() => {
    if (diagram === null) router.replace("/");
  }, [diagram, router]);

  useKeyboardShortcuts({
    "mod+s": () => forceSave(canvasRef.current?.getElements() ?? []),
    "mod+k": () => chatRef.current?.focusInput(),
    "mod+e": () => menuRef.current?.toggle(),
    "mod+shift+l": () => handleToggleLock(),
    "?": () => setShortcutsOpen(true),
  });

  async function handleDuplicate() {
    if (!diagram) return;
    const newId = nanoid();
    const now = Date.now();
    const duplicate: Diagram = {
      ...diagram,
      id: newId,
      name: `${diagram.name} (copy)`,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      version: 1,
      trashedAt: null,
      starred: false,
    };
    await db.diagrams.add(duplicate);
    router.push(`/d/${newId}`);
  }

  async function handleToggleLock() {
    if (!diagram) return;
    await db.diagrams.update(id, { locked: !diagram.locked });
  }

  if (diagram === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-subtle">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
      <EditorTopBar
        diagram={diagram!}
        onDuplicate={handleDuplicate}
        onToggleLock={handleToggleLock}
        onOpenSettings={() => setSettingsOpen(true)}
        menuRef={menuRef}
        canvasRef={canvasRef}
        isSidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        isChatOpen={chatOpen}
        onToggleChat={() => setChatOpen(!chatOpen)}
        theme={settings.theme}
        onToggleTheme={() => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}
      />

      <StorageBanner />

      {errorMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="px-4 py-2 bg-red-500/90 text-white text-sm rounded-lg shadow-lg">
            {errorMessage}
          </div>
        </div>
      )}

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}

      {settingsOpen && (
        <SettingsPanel settings={settings} onSave={setSettings} onClose={() => setSettingsOpen(false)} />
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Project Sidebar */}
        <ProjectSidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          currentDiagramId={id}
        />

        {/* Center: Excalidraw Canvas */}
        <div className="flex-1 min-h-0 min-w-0 p-2 lg:p-3 bg-background">
          <div
            className="relative w-full h-full rounded-2xl overflow-hidden bg-canvas-bg border border-border-subtle"
            style={{ maxWidth: 4096, maxHeight: 4096 }}
          >
            <ExcalidrawCanvas
              ref={canvasRef}
              initialElements={diagram!.elements}
              initialFiles={diagram!.files ?? {}}
              onChange={(elements) => triggerSave(elements)}
            />
            {loadingPhase !== "idle" && (
              <div className="absolute bottom-3 right-3 w-2 h-2 rounded-full bg-zinc-400 animate-pulse pointer-events-none" />
            )}
            {diagram?.locked && (
              <div className="absolute inset-0 pointer-events-none flex items-end justify-center pb-6 z-10">
                <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 border border-yellow-500/40 rounded-lg backdrop-blur-sm">
                  <span className="text-yellow-400 text-sm font-medium">
                    This diagram is locked. Voice input is disabled.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Chat Panel */}
        <ChatPanel
          ref={chatRef}
          diagramId={id}
          diagram={diagram}
          settings={settings}
          isLoading={isLoading}
          onFallbackSubmit={handleSilence}
          canvasRef={canvasRef}
          onError={showError}
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
        />
      </div>
    </div>
  );
}
