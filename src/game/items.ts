import type { InventoryItem } from "@/src/game/types";

export const ITEM_ICON_ASSETS: Record<string, string> = {
  rock: "/assets/relic-rush/items/stone-fragment.png",
  "wooden-sword": "/assets/relic-rush/items/bone-knife.png",
  "vanguard-blade": "/assets/relic-rush/items/crystal-edge.png",
  "whisper-daggers": "/assets/relic-rush/items/skullburst-knives.png",
  "ember-staff": "/assets/relic-rush/items/mire-scepter.png",
  duskmail: "/assets/relic-rush/items/ruin-plate.png",
  "ember-charm": "/assets/relic-rush/items/gate-sigil.png",
  moonbrew: "/assets/relic-rush/items/dewglass-tonic.png",
  "starforged-idol": "/assets/relic-rush/items/lich-crown.png",
};

export function resolveItemIcon(
  item: Pick<InventoryItem, "templateId" | "icon">,
) {
  return ITEM_ICON_ASSETS[item.templateId] ?? item.icon;
}

export function isAssetIcon(icon: string) {
  return icon.startsWith("/");
}
