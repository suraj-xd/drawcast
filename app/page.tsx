"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import { createDiagram } from "@/lib/diagram";

export default function RootPage() {
  const router = useRouter();
  const resolved = useRef(false);

  useEffect(() => {
    if (resolved.current) return;
    resolved.current = true;

    async function resolve() {
      const recent = await db.diagrams
        .orderBy("lastOpenedAt")
        .reverse()
        .filter((d) => !d.trashedAt)
        .first();

      if (recent) {
        router.replace(`/d/${recent.id}`);
      } else {
        const diagram = createDiagram({ name: "Untitled Diagram" });
        await db.diagrams.add(diagram);
        router.replace(`/d/${diagram.id}`);
      }
    }

    resolve();
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen bg-background text-subtle">
      Loading…
    </div>
  );
}
