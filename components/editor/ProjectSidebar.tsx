"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  IconPlus,
  IconMessage,
  IconDotsVertical,
  IconPencil,
  IconStar,
  IconStarFilled,
  IconTrash,
} from "@tabler/icons-react";
import { db } from "@/lib/db";
import { createDiagram } from "@/lib/diagram";

interface Props {
  isOpen: boolean;
  onToggle: () => void;
  currentDiagramId: string;
}

interface SidebarDiagram {
  id: string;
  name: string;
  starred: boolean;
  lastOpenedAt: number;
}

interface TimeGroup {
  label: string;
  diagrams: SidebarDiagram[];
}

function groupByTime(diagrams: SidebarDiagram[]): TimeGroup[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const yesterdayMs = todayMs - 86_400_000;
  const last7Ms = todayMs - 7 * 86_400_000;
  const last30Ms = todayMs - 30 * 86_400_000;

  const buckets: Record<string, SidebarDiagram[]> = {
    Today: [],
    Yesterday: [],
    "Last 7 days": [],
    "Last 30 days": [],
    Older: [],
  };

  for (const d of diagrams) {
    const t = d.lastOpenedAt;
    if (t >= todayMs) {
      buckets["Today"].push(d);
    } else if (t >= yesterdayMs) {
      buckets["Yesterday"].push(d);
    } else if (t >= last7Ms) {
      buckets["Last 7 days"].push(d);
    } else if (t >= last30Ms) {
      buckets["Last 30 days"].push(d);
    } else {
      buckets["Older"].push(d);
    }
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, diagrams: items }));
}

function DiagramContextMenu({
  diagram,
  onRename,
  onStar,
  onDelete,
}: {
  diagram: SidebarDiagram;
  onRename: (id: string) => void;
  onStar: (id: string, starred: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      )
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-0.5 rounded text-placeholder hover:text-foreground hover:bg-surface-elevated transition-colors opacity-0 group-hover:opacity-100"
        aria-label="Diagram options"
      >
        <IconDotsVertical size={14} />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 w-40 bg-surface border border-border-subtle rounded-lg shadow-xl py-1 z-50"
        >
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-foreground transition-colors text-left"
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              onRename(diagram.id);
            }}
          >
            <IconPencil size={14} />
            Rename
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-foreground transition-colors text-left"
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              onStar(diagram.id, !diagram.starred);
            }}
          >
            {diagram.starred ? (
              <IconStarFilled size={14} className="text-[#F59E0B]" />
            ) : (
              <IconStar size={14} />
            )}
            {diagram.starred ? "Unstar" : "Star"}
          </button>
          <div className="my-1 border-t border-border-subtle" />
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-400 hover:bg-surface-hover hover:text-red-300 transition-colors text-left"
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              onDelete(diagram.id);
            }}
          >
            <IconTrash size={14} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProjectSidebar({
  isOpen,
  onToggle,
  currentDiagramId,
}: Props) {
  const router = useRouter();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  const allDiagrams = useLiveQuery(
    () =>
      db.diagrams
        .orderBy("lastOpenedAt")
        .reverse()
        .toArray()
        .then((rows) => rows.filter((d) => !d.trashedAt)),
    []
  );

  const groups = useMemo(
    () =>
      groupByTime(
        (allDiagrams ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          starred: d.starred,
          lastOpenedAt: d.lastOpenedAt,
        }))
      ),
    [allDiagrams]
  );

  const handleRenameStart = (id: string) => {
    const d = allDiagrams?.find((x) => x.id === id);
    if (!d) return;
    setRenamingId(id);
    setRenameValue(d.name);
    setTimeout(() => renameRef.current?.select(), 0);
  };

  const handleRenameCommit = async () => {
    if (renamingId && renameValue.trim()) {
      await db.diagrams.update(renamingId, {
        name: renameValue.trim(),
        updatedAt: Date.now(),
      });
    }
    setRenamingId(null);
  };

  const handleStar = async (id: string, starred: boolean) => {
    await db.diagrams.update(id, { starred });
  };

  const handleDelete = async (id: string) => {
    await db.diagrams.update(id, { trashedAt: Date.now() });
    if (id === currentDiagramId) {
      router.push("/");
    }
  };

  const handleNewDiagram = async () => {
    const newDiagram = createDiagram({ name: "Untitled" });
    await db.diagrams.add(newDiagram);
    router.push(`/d/${newDiagram.id}`);
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={`shrink-0 bg-surface border-r border-border-subtle flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${
          isOpen ? "w-[260px]" : "w-0"
        } ${isOpen ? "fixed inset-y-0 left-0 z-50 lg:relative lg:z-auto" : ""}`}
      >
      <div className="min-w-[260px] flex flex-col h-full">
        {/* New diagram button */}
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={handleNewDiagram}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm font-medium text-foreground bg-surface-hover hover:bg-surface-elevated transition-colors"
          >
            <IconPlus size={16} />
            New diagram
          </button>
        </div>

        {/* Project list */}
        <nav className="flex-1 overflow-y-auto px-1.5 py-2 scrollbar-thin">
          {groups.map((group) => (
            <div key={group.label} className="mb-3">
              <h3 className="px-2 py-1 text-[11px] font-medium text-placeholder uppercase tracking-wider">
                {group.label}
              </h3>
              {group.diagrams.map((d) => {
                const isActive = d.id === currentDiagramId;
                const isRenaming = renamingId === d.id;
                return (
                  <div key={d.id} className="group relative">
                    <Link
                      href={`/d/${d.id}`}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-xl text-sm transition-colors ${
                        isActive
                          ? "bg-surface-hover text-foreground font-medium"
                          : "text-muted hover:bg-surface-hover hover:text-foreground"
                      }`}
                    >
                      <IconMessage
                        size={14}
                        className="shrink-0 opacity-50"
                      />
                      {isRenaming ? (
                        <input
                          ref={renameRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={handleRenameCommit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameCommit();
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onClick={(e) => e.preventDefault()}
                          className="flex-1 min-w-0 bg-surface-elevated rounded px-1 py-0.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      ) : (
                        <span className="truncate flex-1 min-w-0">{d.name}</span>
                      )}
                      {d.starred && !isRenaming && (
                        <IconStarFilled size={12} className="shrink-0 text-[#F59E0B] opacity-60" />
                      )}
                    </Link>
                    {!isRenaming && (
                      <div className="absolute right-1 top-1/2 -translate-y-1/2">
                        <DiagramContextMenu
                          diagram={d}
                          onRename={handleRenameStart}
                          onStar={handleStar}
                          onDelete={handleDelete}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {(!allDiagrams || allDiagrams.length === 0) && (
            <p className="px-3 py-2 text-xs text-placeholder">
              No diagrams yet
            </p>
          )}
        </nav>

        <div className="px-3 py-3 border-t border-border-subtle">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-warning">
            Beta build
          </span>
          <span className="mt-1 block text-[11px] leading-4 text-placeholder">
            Diagrams are stored locally. AI drawing may still be rough.
          </span>
        </div>
      </div>
    </aside>
    </>
  );
}
