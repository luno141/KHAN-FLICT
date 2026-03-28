import { ethers } from "ethers";
import {
  ARCHETYPES,
  DEFAULT_MARKET_PRICE_WEI,
  ITEM_TEMPLATES,
  STARTER_LOADOUTS,
} from "@/src/game/content";
import type {
  Archetype,
  CombatLogEntry,
  EnemyType,
  EquippedLoadout,
  InventoryItem,
  LootRollContext,
  MarketplaceListing,
  PlayerProfile,
  PvpMatchRecord,
  Rarity,
  StatBlock,
  StatBonuses,
} from "@/src/game/types";

const RARITY_MULTIPLIERS: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.25,
  rare: 1.55,
  epic: 2.2,
  mythical: 3.5,
};

const RARITY_COLORS: Record<Rarity, string> = {
  common: "#cbd5e1",
  uncommon: "#4ade80",
  rare: "#60a5fa",
  epic: "#c084fc",
  mythical: "#f59e0b",
};

export function createId(prefix: string) {
  return `${prefix}-${generateUuid()}`;
}

export function getDisplayName(archetype: Archetype) {
  const suffix = Math.floor(Math.random() * 900 + 100);
  return `${archetype} ${suffix}`;
}

export function formatMon(wei: string | bigint) {
  const formatted = ethers.formatEther(wei);
  const [whole, decimals = ""] = formatted.split(".");
  const compact = decimals.slice(0, 4).replace(/0+$/, "");
  return compact ? `${whole}.${compact}` : whole;
}

export function mergeStats(base: StatBlock, bonuses: StatBonuses): StatBlock {
  return {
    health: base.health + (bonuses.health ?? 0),
    attack: base.attack + (bonuses.attack ?? 0),
    defense: base.defense + (bonuses.defense ?? 0),
    speed: base.speed + (bonuses.speed ?? 0),
    critChance: base.critChance + (bonuses.critChance ?? 0),
    luck: base.luck + (bonuses.luck ?? 0),
  };
}

export function sumBonuses(items: InventoryItem[]): StatBonuses {
  return items.reduce<StatBonuses>(
    (accumulator, item) => ({
      health: (accumulator.health ?? 0) + (item.bonuses.health ?? 0),
      attack: (accumulator.attack ?? 0) + (item.bonuses.attack ?? 0),
      defense: (accumulator.defense ?? 0) + (item.bonuses.defense ?? 0),
      speed: (accumulator.speed ?? 0) + (item.bonuses.speed ?? 0),
      critChance:
        (accumulator.critChance ?? 0) + (item.bonuses.critChance ?? 0),
      luck: (accumulator.luck ?? 0) + (item.bonuses.luck ?? 0),
    }),
    {},
  );
}

export function getEquippedItems(
  inventory: InventoryItem[],
  equipped: EquippedLoadout,
) {
  const equippedIds = new Set(
    Object.values(equipped).filter((value): value is string => Boolean(value)),
  );

  return inventory.filter((item) => equippedIds.has(item.instanceId));
}

export function getDerivedStats(profile: PlayerProfile) {
  return mergeStats(
    profile.baseStats,
    sumBonuses(getEquippedItems(profile.inventory, profile.equipped)),
  );
}

export function getCombatPower(stats: StatBlock) {
  return Math.round(
    stats.health * 0.25 +
      stats.attack * 2.2 +
      stats.defense * 1.8 +
      stats.speed * 1.3 +
      stats.luck * 1.1 +
      stats.critChance * 100,
  );
}

export function buildItemInstance(
  templateId: string,
  source: InventoryItem["source"],
  rarity: Rarity = "common",
): InventoryItem {
  const template = ITEM_TEMPLATES[templateId];
  const multiplier = RARITY_MULTIPLIERS[rarity];

  return {
    instanceId: createId("item"),
    templateId,
    name: rarity === "common"
      ? template.name
      : `${capitalize(rarity)} ${template.name}`,
    type: template.type,
    slot: template.slot,
    rarity,
    description: template.description,
    icon: template.icon,
    value: Math.round(template.baseValue * multiplier),
    premium: template.premium,
    bonuses: {
      health: Math.round((template.baseBonuses.health ?? 0) * multiplier),
      attack: Math.round((template.baseBonuses.attack ?? 0) * multiplier),
      defense: Math.round((template.baseBonuses.defense ?? 0) * multiplier),
      speed: Math.round((template.baseBonuses.speed ?? 0) * multiplier),
      critChance: Number(
        ((template.baseBonuses.critChance ?? 0) * multiplier).toFixed(2),
      ),
      luck: Math.round((template.baseBonuses.luck ?? 0) * multiplier),
    },
    healAmount: template.healAmount
      ? Math.round(template.healAmount * multiplier)
      : undefined,
    listed: false,
    source,
    chainTokenId: null,
  };
}

export function createStarterInventory(archetype: Archetype) {
  return STARTER_LOADOUTS[archetype].map((templateId) =>
    buildItemInstance(templateId, "starter", "common"),
  );
}

export function createStarterProfile(
  playerId: string,
  archetype: Archetype,
  displayName: string,
  walletAddress: string | null = null,
): PlayerProfile {
  const baseStats = ARCHETYPES[archetype].baseStats;
  const inventory = createStarterInventory(archetype);

  const equipped: EquippedLoadout = {
    weaponId: inventory.find((item) => item.slot === "weapon")?.instanceId ?? null,
    armorId: inventory.find((item) => item.slot === "armor")?.instanceId ?? null,
    artifactId: null,
    charmId: inventory.find((item) => item.slot === "charm")?.instanceId ?? null,
  };

  return {
    playerId,
    displayName,
    walletAddress,
    archetype,
    baseStats,
    inventory,
    equipped,
    runs: [],
    pvpHistory: [],
  };
}

export function rollLoot({ enemyType, luck }: LootRollContext): InventoryItem | null {
  const luckBoost = Math.min(luck * 0.0125, 0.14);
  const rarityRoll = Math.random();
  const dropChanceByEnemy: Record<EnemyType, number> = {
    slime: 0.58,
    skeleton: 0.76,
    wisp: 1,
  };
  const mythicalThresholdByEnemy: Record<EnemyType, number> = {
    slime: 0.01,
    skeleton: 0.03,
    wisp: 0.08,
  };
  const epicThresholdByEnemy: Record<EnemyType, number> = {
    slime: 0.07,
    skeleton: 0.12,
    wisp: 0.2,
  };
  const rareThresholdByEnemy: Record<EnemyType, number> = {
    slime: 0.28,
    skeleton: 0.42,
    wisp: 0.58,
  };
  const uncommonThresholdByEnemy: Record<EnemyType, number> = {
    slime: 0.55,
    skeleton: 0.70,
    wisp: 0.85,
  };

  let rarity: Rarity = "common";
  if (rarityRoll < mythicalThresholdByEnemy[enemyType] + luckBoost / 3) {
    rarity = "mythical";
  } else if (rarityRoll < epicThresholdByEnemy[enemyType] + luckBoost / 2) {
    rarity = "epic";
  } else if (rarityRoll < rareThresholdByEnemy[enemyType] + luckBoost) {
    rarity = "rare";
  } else if (rarityRoll < uncommonThresholdByEnemy[enemyType] + luckBoost * 1.5) {
    rarity = "uncommon";
  }

  const templatePools: Record<EnemyType, string[]> = {
    slime: ["rock", "wooden-sword", "moonbrew"],
    skeleton: ["wooden-sword", "vanguard-blade", "whisper-daggers", "duskmail"],
    wisp: ["ember-charm", "ember-staff", "starforged-idol"],
  };

  if (Math.random() > Math.min(1, dropChanceByEnemy[enemyType] + luckBoost)) {
    return null;
  }

  const pool = templatePools[enemyType];
  const templateId = pool[Math.floor(Math.random() * pool.length)];
  return buildItemInstance(templateId, "loot", rarity);
}

export function consumeItem(
  inventory: InventoryItem[],
  instanceId: string,
  currentHealth: number,
  maxHealth: number,
) {
  const item = inventory.find((candidate) => candidate.instanceId === instanceId);
  if (!item || item.type !== "consumable" || !item.healAmount) {
    return {
      inventory,
      nextHealth: currentHealth,
    };
  }

  return {
    inventory: inventory.filter((candidate) => candidate.instanceId !== instanceId),
    nextHealth: Math.min(maxHealth, currentHealth + item.healAmount),
  };
}

export function createLog(text: string, tone: CombatLogEntry["tone"]): CombatLogEntry {
  return {
    id: createId("log"),
    text,
    tone,
  };
}

export function rarityColor(rarity: Rarity) {
  return RARITY_COLORS[rarity];
}

export function createMockListing(
  item: InventoryItem,
  sellerName: string,
  sellerPlayerId = "vault-trader",
): MarketplaceListing {
  return {
    id: createId("listing"),
    inventoryItemId: item.instanceId,
    item,
    sellerPlayerId,
    sellerName,
    priceWei: DEFAULT_MARKET_PRICE_WEI,
    status: "active",
    createdAt: new Date().toISOString(),
    soldAt: null,
    chainListingId: null,
  };
}

export function calculateDamage(
  attacker: Pick<StatBlock, "attack" | "critChance">,
  defender: Pick<StatBlock, "defense">,
) {
  const crit = Math.random() < attacker.critChance;
  const baseDamage = attacker.attack + Math.floor(Math.random() * 4);
  const mitigated = Math.max(3, baseDamage - defender.defense);
  const damage = crit ? Math.round(mitigated * 1.5) : mitigated;

  return { damage, crit };
}

export function simulateDuel(
  heroName: string,
  heroStats: StatBlock,
  opponentName: string,
  opponentStats: StatBlock,
) {
  let heroHealth = heroStats.health;
  let opponentHealth = opponentStats.health;
  const summary: string[] = [];

  for (let round = 0; round < 6 && heroHealth > 0 && opponentHealth > 0; round += 1) {
    const heroStrike = calculateDamage(heroStats, opponentStats);
    opponentHealth -= heroStrike.damage;
    summary.push(
      `${heroName} hits ${opponentName} for ${heroStrike.damage}${
        heroStrike.crit ? " crit" : ""
      }.`,
    );

    if (opponentHealth <= 0) {
      break;
    }

    const rivalStrike = calculateDamage(opponentStats, heroStats);
    heroHealth -= rivalStrike.damage;
    summary.push(
      `${opponentName} answers for ${rivalStrike.damage}${
        rivalStrike.crit ? " crit" : ""
      }.`,
    );
  }

  return {
    outcome: heroHealth > opponentHealth ? "victory" : "defeat",
    summary: summary.join(" "),
  } as const;
}

export function createPvpHistoryEntry(
  opponentName: string,
  outcome: PvpMatchRecord["outcome"],
  summary: string,
): PvpMatchRecord {
  return {
    id: createId("pvp"),
    opponentName,
    outcome,
    summary,
    createdAt: new Date().toISOString(),
  };
}

export function buildWalletLabel(address: string | null) {
  if (!address) {
    return "Wallet not connected";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function generateUuid() {
  const webCrypto = globalThis.crypto;

  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const randomNibble = Math.floor(Math.random() * 16);
    const value = token === "x" ? randomNibble : (randomNibble & 0x3) | 0x8;
    return value.toString(16);
  });
}
