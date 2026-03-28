import { ITEM_TEMPLATES } from "@/src/game/content";
import {
  createPvpHistoryEntry,
  createStarterProfile,
  simulateDuel,
} from "@/src/game/helpers";
import type {
  BootstrapProfileInput,
  CreateListingInput,
  InventoryItem,
  MarketplaceListing,
  MockPvpInput,
  PlayerProfile,
  PlayerSnapshot,
  PurchaseListingInput,
  SyncProfileInput,
} from "@/src/game/types";
import { getPrismaClient } from "@/src/server/db";

type PrismaPlayerRecord = Awaited<ReturnType<typeof getPlayerRecord>>;

export async function bootstrapProfile(
  input: BootstrapProfileInput,
): Promise<PlayerSnapshot> {
  const prisma = getPrismaClient();

  const existing =
    (await prisma.player.findUnique({
      where: { id: input.playerId },
    })) ??
    (input.walletAddress
      ? await prisma.player.findUnique({
          where: { walletAddress: input.walletAddress },
        })
      : null);

  if (!existing) {
    const profile = createStarterProfile(
      input.playerId,
      input.archetype,
      input.displayName,
      input.walletAddress ?? null,
    );

    await prisma.$transaction(async (tx) => {
      await tx.player.create({
        data: {
          id: profile.playerId,
          displayName: profile.displayName,
          walletAddress: profile.walletAddress,
        },
      });

      await tx.character.create({
        data: {
          playerId: profile.playerId,
          archetype: profile.archetype,
          health: profile.baseStats.health,
          attack: profile.baseStats.attack,
          defense: profile.baseStats.defense,
          speed: profile.baseStats.speed,
          critChance: profile.baseStats.critChance,
          luck: profile.baseStats.luck,
        },
      });

      for (const item of profile.inventory) {
        await upsertItemTemplate(tx, item.templateId);
        await tx.inventoryItem.create({
          data: inventoryItemToRecord(profile.playerId, item),
        });
      }

      const equippedEntries = Object.entries(profile.equipped)
        .filter((entry): entry is [string, string] => Boolean(entry[1]));

      if (equippedEntries.length > 0) {
        await tx.equippedItem.createMany({
          data: equippedEntries.map(([slot, inventoryItemId]) => ({
            playerId: profile.playerId,
            slot,
            inventoryItemId,
          })),
        });
      }
    });
  } else {
    await prisma.player.update({
      where: { id: existing.id },
      data: {
        displayName: input.displayName,
        walletAddress: input.walletAddress ?? existing.walletAddress,
      },
    });
  }

  return getPlayerSnapshot(existing?.id ?? input.playerId);
}

export async function getPlayerSnapshot(playerId: string): Promise<PlayerSnapshot> {
  const prisma = getPrismaClient();
  const player = await getPlayerRecord(prisma, playerId);

  if (!player) {
    throw new Error("Player profile not found.");
  }

  const listings = await getActiveListings();
  const purchaseHistory = await prisma.purchaseHistory.findMany({
    where: { buyerPlayerId: player.id },
    orderBy: { purchasedAt: "desc" },
  });

  return {
    profile: mapPlayerRecord(player),
    listings,
    purchaseHistory: purchaseHistory.map((record) => ({
      id: record.id,
      listingId: record.listingId,
      buyerPlayerId: record.buyerPlayerId,
      sellerPlayerId: record.sellerPlayerId,
      itemName: record.itemName,
      priceWei: record.priceWei,
      purchasedAt: record.purchasedAt.toISOString(),
    })),
  };
}

export async function syncProfileState(
  input: SyncProfileInput,
): Promise<PlayerSnapshot> {
  const prisma = getPrismaClient();
  const player = await getRequiredPlayerRecord(prisma, input.playerId);
  const canonicalPlayerId = player.id;

  await prisma.$transaction(async (tx) => {
    for (const item of input.inventory) {
      await upsertItemTemplate(tx, item.templateId);
      await tx.inventoryItem.upsert({
        where: { id: item.instanceId },
        create: inventoryItemToRecord(canonicalPlayerId, item),
        update: inventoryItemToRecord(canonicalPlayerId, item),
      });
    }

    const safeIds = input.inventory.map((item) => item.instanceId);
    await tx.inventoryItem.deleteMany({
      where: {
        playerId: canonicalPlayerId,
        listed: false,
        ...(safeIds.length > 0 ? { id: { notIn: safeIds } } : {}),
      },
    });

    await tx.equippedItem.deleteMany({
      where: { playerId: canonicalPlayerId },
    });

    const equippedEntries = Object.entries(input.equipped)
      .filter((entry): entry is [string, string] => Boolean(entry[1]));

    if (equippedEntries.length > 0) {
      await tx.equippedItem.createMany({
        data: equippedEntries.map(([slot, inventoryItemId]) => ({
          playerId: canonicalPlayerId,
          slot,
          inventoryItemId,
        })),
      });
    }

    for (const run of input.runs) {
      await tx.dungeonRun.upsert({
        where: { id: run.id },
        create: {
          id: run.id,
          playerId: canonicalPlayerId,
          roomName: run.roomName,
          enemiesDefeated: run.enemiesDefeated,
          lootCollected: run.lootCollected,
          outcome: run.outcome,
          startedAt: new Date(run.startedAt),
          endedAt: new Date(run.endedAt),
          notes: run.notes,
        },
        update: {
          roomName: run.roomName,
          enemiesDefeated: run.enemiesDefeated,
          lootCollected: run.lootCollected,
          outcome: run.outcome,
          startedAt: new Date(run.startedAt),
          endedAt: new Date(run.endedAt),
          notes: run.notes,
        },
      });
    }

    for (const match of input.pvpHistory) {
      await tx.pvpMatch.upsert({
        where: { id: match.id },
        create: {
          id: match.id,
          playerId: canonicalPlayerId,
          opponentName: match.opponentName,
          outcome: match.outcome,
          summary: match.summary,
          createdAt: new Date(match.createdAt),
        },
        update: {
          opponentName: match.opponentName,
          outcome: match.outcome,
          summary: match.summary,
          createdAt: new Date(match.createdAt),
        },
      });
    }

    if (input.walletAddress) {
      await tx.player.update({
        where: { id: canonicalPlayerId },
        data: { walletAddress: input.walletAddress },
      });
    }
  });

  return getPlayerSnapshot(canonicalPlayerId);
}

export async function getActiveListings(): Promise<MarketplaceListing[]> {
  const prisma = getPrismaClient();

  const listings = await prisma.marketplaceListing.findMany({
    where: { status: "active" },
    include: {
      seller: true,
      inventoryItem: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return listings.map((listing) => ({
    id: listing.id,
    inventoryItemId: listing.inventoryItemId,
    item: mapInventoryRecord(listing.inventoryItem),
    sellerPlayerId: listing.sellerPlayerId,
    sellerName: listing.seller.displayName,
    priceWei: listing.priceWei,
    status: listing.status as MarketplaceListing["status"],
    createdAt: listing.createdAt.toISOString(),
    soldAt: listing.soldAt?.toISOString() ?? null,
    chainListingId: listing.chainListingId,
  }));
}

export async function createMarketListing(
  input: CreateListingInput,
): Promise<MarketplaceListing[]> {
  const prisma = getPrismaClient();
  validateCreateListingInput(input);
  const player = await getRequiredPlayerRecord(prisma, input.playerId);

  const inventoryItem = await prisma.inventoryItem.findUnique({
    where: { id: input.inventoryItemId },
    include: { player: true },
  });

  if (!inventoryItem || inventoryItem.playerId !== player.id) {
    throw new Error("Artifact not found in inventory.");
  }
  if (!inventoryItem.premium) {
    throw new Error("Only premium artifacts can be listed.");
  }
  if (inventoryItem.listed) {
    throw new Error("Artifact is already listed.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.inventoryItem.update({
      where: { id: input.inventoryItemId },
      data: { listed: true },
    });

    await tx.marketplaceListing.create({
      data: {
        id: crypto.randomUUID(),
        sellerPlayerId: player.id,
        inventoryItemId: input.inventoryItemId,
        priceWei: input.priceWei,
        status: "active",
        chainListingId: input.chainListingId ?? null,
      },
    });
  });

  return getActiveListings();
}

export async function purchaseMarketListing(
  input: PurchaseListingInput,
): Promise<PlayerSnapshot> {
  const prisma = getPrismaClient();
  validatePurchaseListingInput(input);
  const buyer = await getRequiredPlayerRecord(prisma, input.buyerPlayerId);

  const listing = await prisma.marketplaceListing.findUnique({
    where: { id: input.listingId },
    include: { inventoryItem: true },
  });

  if (!listing || listing.status !== "active") {
    throw new Error("Listing not found.");
  }
  if (listing.sellerPlayerId === buyer.id) {
    throw new Error("You already own this listing.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.marketplaceListing.update({
      where: { id: input.listingId },
      data: {
        status: "sold",
        soldAt: new Date(),
        buyerPlayerId: buyer.id,
      },
    });

    await tx.inventoryItem.update({
      where: { id: listing.inventoryItemId },
      data: {
        playerId: buyer.id,
        listed: false,
      },
    });

    await tx.equippedItem.deleteMany({
      where: {
        playerId: listing.sellerPlayerId,
        inventoryItemId: listing.inventoryItemId,
      },
    });

    await tx.purchaseHistory.create({
      data: {
        id: crypto.randomUUID(),
        listingId: listing.id,
        buyerPlayerId: buyer.id,
        sellerPlayerId: listing.sellerPlayerId,
        itemName: listing.inventoryItem.name,
        priceWei: listing.priceWei,
      },
    });
  });

  return getPlayerSnapshot(buyer.id);
}

export async function recordMockPvp(
  input: MockPvpInput,
): Promise<PlayerSnapshot> {
  const snapshot = await getPlayerSnapshot(input.playerId);
  const opponent = {
    Warrior: { health: 110, attack: 15, defense: 9, speed: 5, critChance: 0.1, luck: 4 },
    Rogue: { health: 86, attack: 14, defense: 5, speed: 9, critChance: 0.18, luck: 7 },
    Mage: { health: 80, attack: 17, defense: 4, speed: 7, critChance: 0.12, luck: 6 },
  };

  const selectedOpponent = input.opponentId.includes("warden")
    ? { name: "Rune Warden", stats: opponent.Warrior }
    : input.opponentId.includes("sable")
      ? { name: "Sable Fen", stats: opponent.Rogue }
      : { name: "Lyra Hex", stats: opponent.Mage };

  const duel = simulateDuel(
    snapshot.profile.displayName,
    input.buildStats,
    selectedOpponent.name,
    selectedOpponent.stats,
  );

  const nextEntry = createPvpHistoryEntry(
    selectedOpponent.name,
    duel.outcome,
    duel.summary,
  );

  return syncProfileState({
    playerId: snapshot.profile.playerId,
    inventory: snapshot.profile.inventory,
    equipped: snapshot.profile.equipped,
    runs: snapshot.profile.runs,
    pvpHistory: [nextEntry, ...snapshot.profile.pvpHistory].slice(0, 8),
    walletAddress: snapshot.profile.walletAddress,
  });
}

async function getPlayerRecord(
  prisma: ReturnType<typeof getPrismaClient>,
  playerId: string,
) {
  const include = {
    character: true,
    inventoryItems: {
      orderBy: { createdAt: "desc" as const },
    },
    equippedItems: true,
    dungeonRuns: {
      orderBy: { endedAt: "desc" as const },
      take: 8,
    },
    pvpMatches: {
      orderBy: { createdAt: "desc" as const },
      take: 8,
    },
  };

  const directRecord = await prisma.player.findUnique({
    where: { id: playerId },
    include,
  });

  if (directRecord) {
    return directRecord;
  }

  return prisma.player.findUnique({
    where: { walletAddress: playerId },
    include: {
      ...include,
    },
  });
}

async function getRequiredPlayerRecord(
  prisma: ReturnType<typeof getPrismaClient>,
  playerId: string,
) {
  const player = await getPlayerRecord(prisma, playerId);

  if (!player) {
    throw new Error("Player profile not found.");
  }

  return player;
}

function mapPlayerRecord(player: NonNullable<PrismaPlayerRecord>): PlayerProfile {
  const equipped: PlayerProfile["equipped"] = {
    weaponId: null,
    armorId: null,
    artifactId: null,
    charmId: null,
  };

  for (const entry of player.equippedItems) {
    if (entry.slot === "weapon") equipped.weaponId = entry.inventoryItemId;
    if (entry.slot === "armor") equipped.armorId = entry.inventoryItemId;
    if (entry.slot === "artifact") equipped.artifactId = entry.inventoryItemId;
    if (entry.slot === "charm") equipped.charmId = entry.inventoryItemId;
  }

  return {
    playerId: player.id,
    displayName: player.displayName,
    walletAddress: player.walletAddress,
    archetype: player.character?.archetype as PlayerProfile["archetype"],
    baseStats: {
      health: player.character?.health ?? 100,
      attack: player.character?.attack ?? 12,
      defense: player.character?.defense ?? 6,
      speed: player.character?.speed ?? 6,
      critChance: player.character?.critChance ?? 0.1,
      luck: player.character?.luck ?? 4,
    },
    inventory: player.inventoryItems.map(mapInventoryRecord),
    equipped,
    runs: player.dungeonRuns.map((run) => ({
      id: run.id,
      roomName: run.roomName,
      enemiesDefeated: run.enemiesDefeated,
      lootCollected: run.lootCollected,
      outcome: run.outcome as PlayerProfile["runs"][number]["outcome"],
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt.toISOString(),
      notes: run.notes,
    })),
    pvpHistory: player.pvpMatches.map((match) => ({
      id: match.id,
      opponentName: match.opponentName,
      outcome: match.outcome as PlayerProfile["pvpHistory"][number]["outcome"],
      summary: match.summary,
      createdAt: match.createdAt.toISOString(),
    })),
  };
}

function mapInventoryRecord(record: {
  id: string;
  templateId: string;
  name: string;
  type: string;
  slot: string | null;
  rarity: string;
  description: string;
  icon: string;
  value: number;
  premium: boolean;
  healthBonus: number;
  attackBonus: number;
  defenseBonus: number;
  speedBonus: number;
  critBonus: number;
  luckBonus: number;
  healAmount: number | null;
  listed: boolean;
  source: string;
  chainTokenId: string | null;
}) {
  return {
    instanceId: record.id,
    templateId: record.templateId,
    name: record.name,
    type: record.type as InventoryItem["type"],
    slot: record.slot as InventoryItem["slot"],
    rarity: record.rarity as InventoryItem["rarity"],
    description: record.description,
    icon: record.icon,
    value: record.value,
    premium: record.premium,
    bonuses: {
      health: record.healthBonus,
      attack: record.attackBonus,
      defense: record.defenseBonus,
      speed: record.speedBonus,
      critChance: record.critBonus,
      luck: record.luckBonus,
    },
    healAmount: record.healAmount ?? undefined,
    listed: record.listed,
    source: record.source as InventoryItem["source"],
    chainTokenId: record.chainTokenId,
  } satisfies InventoryItem;
}

function inventoryItemToRecord(playerId: string, item: InventoryItem) {
  return {
    id: item.instanceId,
    playerId,
    itemId: item.templateId,
    templateId: item.templateId,
    name: item.name,
    type: item.type,
    slot: item.slot ?? null,
    rarity: item.rarity,
    description: item.description,
    icon: item.icon,
    value: item.value,
    premium: item.premium,
    healthBonus: item.bonuses.health ?? 0,
    attackBonus: item.bonuses.attack ?? 0,
    defenseBonus: item.bonuses.defense ?? 0,
    speedBonus: item.bonuses.speed ?? 0,
    critBonus: item.bonuses.critChance ?? 0,
    luckBonus: item.bonuses.luck ?? 0,
    healAmount: item.healAmount ?? null,
    listed: item.listed,
    source: item.source,
    chainTokenId: item.chainTokenId ?? null,
  };
}

async function upsertItemTemplate(
  tx: any,
  templateId: string,
) {
  const template = ITEM_TEMPLATES[templateId];
  if (!template) {
    throw new Error(`Unknown item template: ${templateId}`);
  }

  await tx.item.upsert({
    where: { id: templateId },
    create: {
      id: templateId,
      name: template.name,
      type: template.type,
      slot: template.slot ?? null,
      description: template.description,
      icon: template.icon,
      baseValue: template.baseValue,
      premium: template.premium,
      baseHealthBonus: template.baseBonuses.health ?? 0,
      baseAttackBonus: template.baseBonuses.attack ?? 0,
      baseDefenseBonus: template.baseBonuses.defense ?? 0,
      baseSpeedBonus: template.baseBonuses.speed ?? 0,
      baseCritBonus: template.baseBonuses.critChance ?? 0,
      baseLuckBonus: template.baseBonuses.luck ?? 0,
      healAmount: template.healAmount ?? null,
    },
    update: {
      name: template.name,
      type: template.type,
      slot: template.slot ?? null,
      description: template.description,
      icon: template.icon,
      baseValue: template.baseValue,
      premium: template.premium,
      baseHealthBonus: template.baseBonuses.health ?? 0,
      baseAttackBonus: template.baseBonuses.attack ?? 0,
      baseDefenseBonus: template.baseBonuses.defense ?? 0,
      baseSpeedBonus: template.baseBonuses.speed ?? 0,
      baseCritBonus: template.baseBonuses.critChance ?? 0,
      baseLuckBonus: template.baseBonuses.luck ?? 0,
      healAmount: template.healAmount ?? null,
    },
  });
}

function validateCreateListingInput(input: CreateListingInput) {
  if (!input.playerId || !input.inventoryItemId) {
    throw new Error("playerId and inventoryItemId are required.");
  }
  if (!/^\d+$/.test(input.priceWei) || BigInt(input.priceWei) <= 0n) {
    throw new Error("Listing price must be a positive wei string.");
  }
}

function validatePurchaseListingInput(input: PurchaseListingInput) {
  if (!input.buyerPlayerId || !input.listingId) {
    throw new Error("buyerPlayerId and listingId are required.");
  }
}
