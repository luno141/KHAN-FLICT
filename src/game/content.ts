import type {
  Archetype,
  CharacterBlueprint,
  EnemyType,
  ItemTemplate,
  PvpOpponent,
} from "@/src/game/types";
import { ITEM_ICON_ASSETS } from "@/src/game/items";

export const GAME_TITLE = "Relic Rush";
export const DUNGEON_NAME = "Undead Mire Vault";
export const PLAYER_ARCHETYPE: Archetype = "Warrior";
export const PLAYER_HERO_NAME = "Vault Warden";
export const HERO_HOOK =
  "Connect your wallet, breach the vault, and clear a fast relic run through the undead mire.";

export const STORY_BEATS = [
  {
    eyebrow: "Breach",
    title: "The Marsh Opened First",
    detail:
      "An old vault cracked beneath the swamp and spilled slimes, cursewater, and relic energy into the ruins.",
  },
  {
    eyebrow: "Squad",
    title: "Three Specialists, One Route",
    detail:
      "The Warden holds the line, the Shade Runner hunts angles, and the Ember Scholar turns relic scraps into live firepower.",
  },
  {
    eyebrow: "Extract",
    title: "Grab The Core And Get Out",
    detail:
      "Every room is a sprint for better drops, stronger loadouts, and one more clean escape through the vault gate.",
  },
] as const;

export const SQUAD_SPOTLIGHTS: Array<{
  archetype: Archetype;
  castName: string;
  role: string;
  vibe: string;
}> = [
  {
    archetype: "Warrior",
    castName: "Vault Warden",
    role: "Frontline relic breaker",
    vibe:
      "Balanced, durable, and built to push into the room first without losing tempo.",
  },
  {
    archetype: "Rogue",
    castName: "Shade Runner",
    role: "High-speed flanker",
    vibe:
      "Crit-heavy skirmisher tuned for quick pivots, loot pressure, and fast cleanups.",
  },
  {
    archetype: "Mage",
    castName: "Ember Scholar",
    role: "Glyph-burst caster",
    vibe:
      "Turns cursed relic residue into precision damage and scales hardest with rare drops.",
  },
] as const;

export const FLOOR_PREVIEW = [
  "Bog entry: scout the route",
  "Ruin hall: first pressure wave",
  "Bone bridge: elite slime push",
  "Vault antechamber: premium relic chance",
  "Core seal: clear and extract",
] as const;

export const ARCHETYPES: Record<Archetype, CharacterBlueprint> = {
  Warrior: {
    archetype: "Warrior",
    title: "Vault Warden, Frontline Breacher",
    signature:
      "Balanced duelist with strong sustain, stable damage, and the best first-room safety.",
    lore:
      "Built to survive bad angles, claim the lane, and drag the team through collapsing ruins.",
    baseStats: {
      health: 124,
      attack: 16,
      defense: 10,
      speed: 5,
      critChance: 0.08,
      luck: 4,
    },
  },
  Rogue: {
    archetype: "Rogue",
    title: "Shade Runner, Ruin Flanker",
    signature:
      "Fastest class, strongest crit spikes, and the cleanest relic farming tempo.",
    lore:
      "A vault ghost who slips through pressure points and turns panic into momentum.",
    baseStats: {
      health: 92,
      attack: 14,
      defense: 5,
      speed: 9,
      critChance: 0.2,
      luck: 8,
    },
  },
  Mage: {
    archetype: "Mage",
    title: "Ember Scholar, Glyph Breaker",
    signature:
      "Highest burst and best relic scaling, with enough utility to stabilize any messy run.",
    lore:
      "Reads the ruin faster than anyone else and weaponizes every cursed pattern it finds.",
    baseStats: {
      health: 84,
      attack: 18,
      defense: 4,
      speed: 7,
      critChance: 0.12,
      luck: 6,
    },
  },
};

export const ITEM_TEMPLATES: Record<string, ItemTemplate> = {
  rock: {
    templateId: "rock",
    name: "Stone Fragment",
    type: "charm",
    slot: "charm",
    description: "A chipped shard from the vault floor. Crude, dense, and still oddly lucky.",
    icon: ITEM_ICON_ASSETS.rock,
    baseValue: 1,
    premium: false,
    baseBonuses: { defense: 1, speed: -1, luck: -1 },
    color: "#9ca3af",
  },
  "wooden-sword": {
    templateId: "wooden-sword",
    name: "Bone Knife",
    type: "weapon",
    slot: "weapon",
    description: "Cut from old remains and sharpened for quick dirty work in tight rooms.",
    icon: ITEM_ICON_ASSETS["wooden-sword"],
    baseValue: 3,
    premium: false,
    baseBonuses: { attack: 1 },
    color: "#d6d3d1",
  },
  "vanguard-blade": {
    templateId: "vanguard-blade",
    name: "Crystal Edge",
    type: "weapon",
    slot: "weapon",
    description: "A relic blade grown straight from the mire wall. Stable, sharp, and bright.",
    icon: ITEM_ICON_ASSETS["vanguard-blade"],
    baseValue: 18,
    premium: false,
    baseBonuses: { attack: 4, defense: 1 },
    color: "#7dd3fc",
  },
  "whisper-daggers": {
    templateId: "whisper-daggers",
    name: "Skullburst Knives",
    type: "weapon",
    slot: "weapon",
    description: "Twin throwers built for hit-and-fade pressure and greedy crit fishing.",
    icon: ITEM_ICON_ASSETS["whisper-daggers"],
    baseValue: 22,
    premium: false,
    baseBonuses: { attack: 3, speed: 2, critChance: 0.04 },
    color: "#f472b6",
  },
  "ember-staff": {
    templateId: "ember-staff",
    name: "Mire Scepter",
    type: "weapon",
    slot: "weapon",
    description: "A crystal focus that turns damp cursewater into clean ranged burst.",
    icon: ITEM_ICON_ASSETS["ember-staff"],
    baseValue: 24,
    premium: false,
    baseBonuses: { attack: 5, luck: 1 },
    color: "#fb923c",
  },
  duskmail: {
    templateId: "duskmail",
    name: "Ruin Plate",
    type: "armor",
    slot: "armor",
    description: "Salvaged vault plating that trades elegance for surviving one more room.",
    icon: ITEM_ICON_ASSETS.duskmail,
    baseValue: 20,
    premium: false,
    baseBonuses: { defense: 4, health: 10 },
    color: "#a78bfa",
  },
  "ember-charm": {
    templateId: "ember-charm",
    name: "Gate Sigil",
    type: "charm",
    slot: "charm",
    description: "A skull-marked seal that hums louder the closer you get to the vault core.",
    icon: ITEM_ICON_ASSETS["ember-charm"],
    baseValue: 16,
    premium: false,
    baseBonuses: { speed: 1, luck: 2, critChance: 0.02 },
    color: "#f97316",
  },
  moonbrew: {
    templateId: "moonbrew",
    name: "Dewglass Tonic",
    type: "consumable",
    description: "Distilled mire bloom that patches wounds and gets you moving again.",
    icon: ITEM_ICON_ASSETS.moonbrew,
    baseValue: 14,
    premium: false,
    baseBonuses: {},
    healAmount: 28,
    color: "#34d399",
  },
  "starforged-idol": {
    templateId: "starforged-idol",
    name: "Lich Crown Relic",
    type: "artifact",
    slot: "artifact",
    description: "A premium relic pulled from the deepest seal, pulsing with old vault authority.",
    icon: ITEM_ICON_ASSETS["starforged-idol"],
    baseValue: 80,
    premium: true,
    baseBonuses: { attack: 3, defense: 2, luck: 4 },
    color: "#fde047",
  },
};

export const STARTER_LOADOUTS: Record<Archetype, string[]> = {
  Warrior: ["vanguard-blade", "duskmail", "moonbrew"],
  Rogue: ["whisper-daggers", "ember-charm", "moonbrew"],
  Mage: ["ember-staff", "ember-charm", "moonbrew"],
};

export const ENEMY_THEME: Record<
  EnemyType,
  { name: string; color: number; health: number; attack: number; defense: number; speed: number }
> = {
  slime: {
    name: "Green Slime",
    color: 0x4ade80,
    health: 34,
    attack: 7,
    defense: 2,
    speed: 3,
  },
  skeleton: {
    name: "Blue Slime",
    color: 0x60a5fa,
    health: 46,
    attack: 10,
    defense: 4,
    speed: 5,
  },
  wisp: {
    name: "Red Slime",
    color: 0xf87171,
    health: 28,
    attack: 12,
    defense: 1,
    speed: 8,
  },
};

export const MOCK_PVP_OPPONENTS: PvpOpponent[] = [
  {
    id: "pvp-fen-stalker",
    name: "Fen Stalker",
    archetype: "Rogue",
    combatPower: 77,
    note: "A fast rival build that punishes slow opens and weak crit resistance.",
  },
  {
    id: "pvp-ruin-sentinel",
    name: "Ruin Sentinel",
    archetype: "Warrior",
    combatPower: 82,
    note: "Frontline bruiser tuned to outlast sloppy loadouts and win the long trade.",
  },
  {
    id: "pvp-ash-cipher",
    name: "Ash Cipher",
    archetype: "Mage",
    combatPower: 80,
    note: "Burst-heavy caster built to expose weak artifact scaling and poor positioning.",
  },
];

export const DEFAULT_MARKET_PRICE_WEI = "2500000000000000";
