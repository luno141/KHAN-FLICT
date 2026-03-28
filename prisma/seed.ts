/**
 * Seed the database with starter marketplace listings so the marketplace
 * isn't empty when the game first loads.
 *
 * Run: npx tsx prisma/seed.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database…");

  // Create a "Vault Trader" NPC seller
  const seller = await prisma.player.upsert({
    where: { id: "npc-vault-trader" },
    create: {
      id: "npc-vault-trader",
      displayName: "Vault Trader",
    },
    update: {},
  });

  await prisma.character.upsert({
    where: { playerId: seller.id },
    create: {
      playerId: seller.id,
      archetype: "Warrior",
      health: 100,
      attack: 12,
      defense: 6,
      speed: 6,
      critChance: 0.1,
      luck: 4,
    },
    update: {},
  });

  // Seed items
  const seedItems = [
    {
      templateId: "starforged-idol",
      name: "⭐ Starforged Idol",
      type: "artifact",
      slot: "artifact",
      rarity: "epic",
      description: "A relic forged in starfire. Radiates immense power.",
      icon: "🌟",
      value: 120,
      premium: true,
      healthBonus: 0,
      attackBonus: 5,
      defenseBonus: 3,
      speedBonus: 0,
      critBonus: 0.08,
      luckBonus: 2,
      source: "market",
      priceWei: "2500000000000000", // 0.0025 MON
    },
    {
      templateId: "ember-charm",
      name: "🔥 Ember Charm",
      type: "charm",
      slot: "charm",
      rarity: "rare",
      description: "A smouldering charm. Warmth pulses through it.",
      icon: "🔥",
      value: 80,
      premium: true,
      healthBonus: 0,
      attackBonus: 3,
      defenseBonus: 0,
      speedBonus: 2,
      critBonus: 0.04,
      luckBonus: 1,
      source: "market",
      priceWei: "1500000000000000", // 0.0015 MON
    },
  ];

  for (const seed of seedItems) {
    const itemId = `seed-${seed.templateId}`;
    const instanceId = `seed-instance-${seed.templateId}`;

    // Ensure the item template exists
    await prisma.item.upsert({
      where: { id: seed.templateId },
      create: {
        id: seed.templateId,
        name: seed.name,
        type: seed.type,
        slot: seed.slot,
        description: seed.description,
        icon: seed.icon,
        baseValue: seed.value,
        premium: seed.premium,
      },
      update: {},
    });

    // Create the inventory item owned by the NPC seller
    await prisma.inventoryItem.upsert({
      where: { id: instanceId },
      create: {
        id: instanceId,
        playerId: seller.id,
        itemId: seed.templateId,
        templateId: seed.templateId,
        name: seed.name,
        type: seed.type,
        slot: seed.slot,
        rarity: seed.rarity,
        description: seed.description,
        icon: seed.icon,
        value: seed.value,
        premium: seed.premium,
        healthBonus: seed.healthBonus,
        attackBonus: seed.attackBonus,
        defenseBonus: seed.defenseBonus,
        speedBonus: seed.speedBonus,
        critBonus: seed.critBonus,
        luckBonus: seed.luckBonus,
        listed: true,
        source: seed.source,
      },
      update: {},
    });

    // Create the marketplace listing
    await prisma.marketplaceListing.upsert({
      where: { inventoryItemId: instanceId },
      create: {
        id: `seed-listing-${seed.templateId}`,
        sellerPlayerId: seller.id,
        inventoryItemId: instanceId,
        priceWei: seed.priceWei,
        status: "active",
      },
      update: {},
    });
  }

  console.log("✅ Seeded 2 marketplace listings from Vault Trader.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
