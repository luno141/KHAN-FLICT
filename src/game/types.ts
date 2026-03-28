export type Archetype = "Warrior" | "Rogue" | "Mage";

export type EnemyType = "slime" | "skeleton" | "wisp";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "mythical";

export type ItemType = "weapon" | "armor" | "artifact" | "charm" | "consumable";

export type EquipmentSlot = "weapon" | "armor" | "artifact" | "charm";

export type ListingStatus = "active" | "sold" | "cancelled";

export type PvpOutcome = "victory" | "defeat";

export type RunOutcome = "victory" | "defeat" | "abandoned";

export type Tone = "neutral" | "good" | "bad" | "loot";

export type StatBlock = {
  health: number;
  attack: number;
  defense: number;
  speed: number;
  critChance: number;
  luck: number;
};

export type StatBonuses = Partial<StatBlock>;

export type CharacterBlueprint = {
  archetype: Archetype;
  title: string;
  signature: string;
  lore: string;
  baseStats: StatBlock;
};

export type ItemTemplate = {
  templateId: string;
  name: string;
  type: ItemType;
  slot?: EquipmentSlot;
  description: string;
  icon: string;
  baseValue: number;
  premium: boolean;
  baseBonuses: StatBonuses;
  healAmount?: number;
  color: string;
};

export type InventoryItem = {
  instanceId: string;
  templateId: string;
  name: string;
  type: ItemType;
  slot?: EquipmentSlot;
  rarity: Rarity;
  description: string;
  icon: string;
  value: number;
  premium: boolean;
  bonuses: StatBonuses;
  healAmount?: number;
  listed: boolean;
  source: "starter" | "loot" | "market";
  chainTokenId?: string | null;
};

export type EquippedLoadout = {
  weaponId: string | null;
  armorId: string | null;
  artifactId: string | null;
  charmId: string | null;
};

export type CombatLogEntry = {
  id: string;
  text: string;
  tone: Tone;
};

export type DungeonRunSummary = {
  id: string;
  roomName: string;
  enemiesDefeated: number;
  lootCollected: number;
  outcome: RunOutcome;
  startedAt: string;
  endedAt: string;
  notes: string;
};

export type MarketplaceListing = {
  id: string;
  inventoryItemId: string;
  item: InventoryItem;
  sellerPlayerId: string;
  sellerName: string;
  priceWei: string;
  status: ListingStatus;
  createdAt: string;
  soldAt?: string | null;
  chainListingId?: string | null;
};

export type PurchaseRecord = {
  id: string;
  listingId: string;
  buyerPlayerId: string;
  sellerPlayerId: string;
  itemName: string;
  priceWei: string;
  purchasedAt: string;
};

export type PvpOpponent = {
  id: string;
  name: string;
  archetype: Archetype;
  combatPower: number;
  note: string;
};

export type PvpMatchRecord = {
  id: string;
  opponentName: string;
  outcome: PvpOutcome;
  summary: string;
  createdAt: string;
};

export type PlayerProfile = {
  playerId: string;
  displayName: string;
  walletAddress: string | null;
  archetype: Archetype;
  baseStats: StatBlock;
  inventory: InventoryItem[];
  equipped: EquippedLoadout;
  runs: DungeonRunSummary[];
  pvpHistory: PvpMatchRecord[];
};

export type PlayerSnapshot = {
  profile: PlayerProfile;
  listings: MarketplaceListing[];
  purchaseHistory: PurchaseRecord[];
};

export type BootstrapProfileInput = {
  playerId: string;
  archetype: Archetype;
  displayName: string;
  walletAddress?: string | null;
};

export type SyncProfileInput = {
  playerId: string;
  inventory: InventoryItem[];
  equipped: EquippedLoadout;
  runs: DungeonRunSummary[];
  pvpHistory: PvpMatchRecord[];
  walletAddress?: string | null;
};

export type CreateListingInput = {
  playerId: string;
  inventoryItemId: string;
  priceWei: string;
  chainListingId?: string | null;
};

export type PurchaseListingInput = {
  buyerPlayerId: string;
  listingId: string;
};

export type MockPvpInput = {
  playerId: string;
  opponentId: string;
  buildStats: StatBlock;
};

export type LootRollContext = {
  enemyType: EnemyType;
  luck: number;
};

export type TxAction = {
  id: string;
  label: string;
  txHash: string;
  explorerUrl: string;
  confirmationMs: number;
  timestamp: string;
};
