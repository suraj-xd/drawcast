'use client'

import { IconLock, IconLayoutSidebar, IconSparkles, IconSun, IconMoon, IconSettings } from '@tabler/icons-react'
import type { Diagram } from '@/types/library'
import type { ExcalidrawCanvasHandle } from '@/components/editor/ExcalidrawCanvas'
import type { ThemeOption } from '@/hooks/useUserSettings'
import EditorMenu, { type EditorMenuHandle } from './EditorMenu'

interface Props {
  diagram: Diagram
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  isChatOpen: boolean
  onToggleChat: () => void
  theme: ThemeOption
  onToggleTheme: () => void
  onOpenSettings?: () => void
  onDuplicate?: () => void
  onToggleLock?: () => void
  canvasRef?: React.RefObject<ExcalidrawCanvasHandle | null>
  menuRef?: React.Ref<EditorMenuHandle>
}

export default function EditorTopBar({
  diagram,
  isSidebarOpen,
  onToggleSidebar,
  isChatOpen,
  onToggleChat,
  theme,
  onToggleTheme,
  onOpenSettings,
  onDuplicate,
  onToggleLock,
  canvasRef,
  menuRef,
}: Props) {
  return (
    <header className="flex items-center gap-3 h-11 px-4 bg-background border-b border-border-subtle shrink-0">
      <div className="flex items-center gap-2">
        <img src="/drawcast-logo.png" alt="Drawcast" className="w-6 h-6 shrink-0 rounded-lg" />
        <span className="text-sm font-semibold text-foreground tracking-tight">Drawcast</span>
      </div>

      <button
        onClick={onToggleSidebar}
        className="p-1.5 rounded-lg text-subtle hover:text-foreground hover:bg-surface-hover transition-colors"
        aria-label="Toggle sidebar"
      >
        <IconLayoutSidebar size={18} />
      </button>

      <div className="flex-1" />

      {diagram.locked && (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-[#FEF3C7] border border-[#F59E0B]/40 rounded text-[#D97706]">
          <IconLock size={12} />
          <span className="text-xs font-medium">Locked</span>
        </div>
      )}

      <button
        onClick={onToggleChat}
        className={`p-1.5 rounded-lg hover:bg-surface-hover transition-colors ${
          isChatOpen ? 'text-primary' : 'text-subtle hover:text-foreground'
        }`}
        aria-label="Toggle chat"
      >
        <IconSparkles size={18} />
      </button>

      <button
        onClick={onToggleTheme}
        className="p-1.5 rounded-lg text-subtle hover:text-foreground hover:bg-surface-hover transition-colors"
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </button>

      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-lg text-subtle hover:text-foreground hover:bg-surface-hover transition-colors"
          aria-label="Settings"
        >
          <IconSettings size={18} />
        </button>
      )}

      {canvasRef && onDuplicate && onToggleLock && (
        <EditorMenu
          ref={menuRef}
          diagram={diagram}
          canvasRef={canvasRef}
          onDuplicate={onDuplicate}
          onToggleLock={onToggleLock}
        />
      )}
    </header>
  )
}
