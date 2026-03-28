"use client";

import { rarityColor } from "@/src/game/helpers";
import { isAssetIcon, resolveItemIcon } from "@/src/game/items";
import type { InventoryItem } from "@/src/game/types";

export function Section({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_0_60px_rgba(86,229,255,0.04)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
        </div>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
      <p className="text-[11px] uppercase tracking-[0.26em] text-slate-500">
        {label}
      </p>
      <p className={`mt-3 text-2xl font-semibold ${emphasis ?? "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

export function InventoryBadge({ item }: { item: InventoryItem }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.2em]"
      style={{
        borderColor: `${rarityColor(item.rarity)}55`,
        color: rarityColor(item.rarity),
        background: `${rarityColor(item.rarity)}15`,
      }}
    >
      {item.rarity}
    </span>
  );
}

export function ItemVisual({
  item,
  className,
}: {
  item: Pick<InventoryItem, "templateId" | "icon" | "name">;
  className?: string;
}) {
  const icon = resolveItemIcon(item);

  if (isAssetIcon(icon)) {
    return (
      <img
        src={icon}
        alt={item.name}
        className={className ?? "h-10 w-10 object-contain"}
      />
    );
  }

  return <span className={className ?? "text-2xl"}>{icon}</span>;
}
