import { IconBeta } from "@tabler/icons-react";

interface BetaBadgeProps {
  compact?: boolean;
}

export default function BetaBadge({ compact = false }: BetaBadgeProps) {
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-warning/30 bg-warning-light/70 px-2 text-[11px] font-semibold uppercase leading-none text-warning"
      title="Drawcast is in beta. Diagrams can be rough while generation improves."
    >
      <IconBeta size={14} stroke={2.2} />
      {!compact && <span>Beta</span>}
    </span>
  );
}
