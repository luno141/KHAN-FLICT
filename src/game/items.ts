import type { InventoryItem } from "@/src/game/types";

export const ITEM_ICON_ASSETS: Record<string, string> = {
  rock: "/assets/khan-flict/items/rock.png",
  "wooden-sword": "/assets/khan-flict/items/stick.png",
  "vanguard-blade": "/assets/khan-flict/items/trident.png",
  duskmail: "/assets/khan-flict/items/hat1.png",
  "ember-charm": "/assets/khan-flict/items/swag.png",
  moonbrew: "/assets/khan-flict/items/pot.png",
  "starforged-idol": "/assets/khan-flict/items/bhramastra.png",
};

export function resolveItemIcon(
  item: Pick<InventoryItem, "templateId" | "icon">,
) {
  return ITEM_ICON_ASSETS[item.templateId] ?? item.icon;
}

export function isAssetIcon(icon: string) {
  return icon.startsWith("/");
}
