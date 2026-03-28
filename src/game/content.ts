import type {
  Archetype,
  CharacterBlueprint,
  EnemyType,
  ItemTemplate,
  PvpOpponent,
} from "@/src/game/types";
import { ITEM_ICON_ASSETS } from "@/src/game/items";

export const GAME_TITLE = "KHAN-FLICT";
export const DUNGEON_NAME = "Salman's Gym-Powered Dungeon";
export const PLAYER_ARCHETYPE: Archetype = "Warrior";
export const PLAYER_HERO_NAME = "Shah Rukh Khan";
export const HERO_HOOK =
  "Shah Rukh Khan dives into a cursed dungeon to rescue Aishwarya Rai, out-talk Salman Khan, and somehow survive a black armored car boss phase.";

export const STORY_BEATS = [
  {
    eyebrow: "Prologue",
    title: "The Most Unnecessary Kidnapping Ever",
    detail:
      "Salman Khan kidnapped Aishwarya Rai, crowned himself final boss, and turned Filmygarh into a cursed dungeon with pure gym-bro menace.",
  },
  {
    eyebrow: "Squad",
    title: "Unbalanced On Purpose",
    detail:
      "SRK handles style and relic momentum, Amitabh weaponizes narration, and Abhishek solves every room with more bullets than logic.",
  },
  {
    eyebrow: "Finale",
    title: "Black SUV Destruction Derby",
    detail:
      "Every floor escalates until Salman summons an armored car, rage mode triggers, and the dungeon itself becomes the boss arena.",
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
    castName: "Shah Rukh Khan",
    role: "Smooth-talking relic hunter",
    vibe:
      "Wins fights with timing, swagger, and one-liners that somehow buff damage.",
  },
  {
    archetype: "Rogue",
    castName: "Abhishek Bachchan",
    role: "Dual-pistol bullet storm gremlin",
    vibe:
      "Fastest in the squad, lowest patience, and permanently convinced that more bullets is a strategy.",
  },
  {
    archetype: "Mage",
    castName: "Amitabh Bachchan",
    role: "Wise savage narrator",
    vibe:
      "Turns relics into speeches, enemies into listeners, and every room into a dramatic moral lesson.",
  },
] as const;

export const FLOOR_PREVIEW = [
  "Floor 1: Tutorial where everyone still overacts before attacking.",
  "Floor 2: Meme relics appear, including sunglasses that boost charisma but not damage.",
  "Floor 3: Plot-hole corridor with trap spikes, sudden explosions, and optional logic.",
  "Floor 4: Rajpal Yadav trickster phase with stabbing, fleeing, and re-entry nonsense.",
  "Final Arena: Salman rage mode, armored car chaos, and cinematic overkill.",
] as const;

export const ARCHETYPES: Record<Archetype, CharacterBlueprint> = {
  Warrior: {
    archetype: "Warrior",
    title: "SRK, King of Slow-Mo",
    signature: "Balanced duelist with smooth dodges, dramatic finishers, and charm-heavy survivability.",
    lore: "Slides into cursed corridors like every dungeon was written for his entrance shot.",
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
    title: "Abhishek, Bullet Economy Destroyer",
    signature: "Fastest class, highest crit pressure, and absolutely no respect for ammo conservation.",
    lore: "Treats every ambush like a music video with more muzzle flash than planning.",
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
    title: "Amitabh, Living Monologue Engine",
    signature: "Highest burst and relic scaling, with the calm confidence of someone narrating everyone else's mistakes.",
    lore: "Makes cursed artifacts behave simply by sounding disappointed in them.",
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
  "rock": {
    templateId: "rock",
    name: "Method Actor Brick",
    type: "charm",
    slot: "charm",
    description: "A prop that somehow survived editing. Heavy, useless, emotionally committed.",
    icon: ITEM_ICON_ASSETS.rock,
    baseValue: 1,
    premium: false,
    baseBonuses: { defense: 1, speed: -1, luck: -1 },
    color: "#9ca3af",
  },
  "wooden-sword": {
    templateId: "wooden-sword",
    name: "Prop Sword",
    type: "weapon",
    slot: "weapon",
    description: "Looks dangerous on camera, less so in reality.",
    icon: ITEM_ICON_ASSETS["wooden-sword"],
    baseValue: 3,
    premium: false,
    baseBonuses: { attack: 1 },
    color: "#d6d3d1",
  },
  "vanguard-blade": {
    templateId: "vanguard-blade",
    name: "Signature Pose Saber",
    type: "weapon",
    slot: "weapon",
    description: "Built for clean openings, perfect parries, and dramatic close-ups.",
    icon: ITEM_ICON_ASSETS["vanguard-blade"],
    baseValue: 18,
    premium: false,
    baseBonuses: { attack: 4, defense: 1 },
    color: "#7dd3fc",
  },
  "whisper-daggers": {
    templateId: "whisper-daggers",
    name: "Bullet Baarish Pistols",
    type: "weapon",
    slot: "weapon",
    description: "Dual hand cannons that reward reckless confidence and impossible reload timing.",
    icon: "🔫",
    baseValue: 22,
    premium: false,
    baseBonuses: { attack: 3, speed: 2, critChance: 0.04 },
    color: "#f472b6",
  },
  "ember-staff": {
    templateId: "ember-staff",
    name: "Monologue Conductor",
    type: "weapon",
    slot: "weapon",
    description: "A narration staff that makes relics listen and villains question their life choices.",
    icon: "🪄",
    baseValue: 24,
    premium: false,
    baseBonuses: { attack: 5, luck: 1 },
    color: "#fb923c",
  },
  duskmail: {
    templateId: "duskmail",
    name: "Slow-Mo Leather Coat",
    type: "armor",
    slot: "armor",
    description: "The coat alone adds 20 percent more hero framing.",
    icon: ITEM_ICON_ASSETS.duskmail,
    baseValue: 20,
    premium: false,
    baseBonuses: { defense: 4, health: 10 },
    color: "#a78bfa",
  },
  "ember-charm": {
    templateId: "ember-charm",
    name: "Hero Sunglasses",
    type: "charm",
    slot: "charm",
    description: "Boosts aura, attitude, and the illusion that charisma is a combat stat.",
    icon: ITEM_ICON_ASSETS["ember-charm"],
    baseValue: 16,
    premium: false,
    baseBonuses: { speed: 1, luck: 2, critChance: 0.02 },
    color: "#f97316",
  },
  moonbrew: {
    templateId: "moonbrew",
    name: "Masala Energy Flask",
    type: "consumable",
    description: "Restores health, swagger, and the ability to keep talking mid-fight.",
    icon: ITEM_ICON_ASSETS.moonbrew,
    baseValue: 14,
    premium: false,
    baseBonuses: {},
    healAmount: 28,
    color: "#34d399",
  },
  "starforged-idol": {
    templateId: "starforged-idol",
    name: "Aishwarya Memory Relic",
    type: "artifact",
    slot: "artifact",
    description: "A premium artifact tied to the heart of the dungeon and absolutely too dramatic to ignore.",
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
    name: "Chota Pandit",
    color: 0x4ade80,
    health: 34,
    attack: 7,
    defense: 2,
    speed: 3,
  },
  skeleton: {
    name: "Salman Khan",
    color: 0xe5e7eb,
    health: 46,
    attack: 10,
    defense: 4,
    speed: 5,
  },
  wisp: {
    name: "SUV Spirit",
    color: 0x60a5fa,
    health: 28,
    attack: 12,
    defense: 1,
    speed: 8,
  },
};

export const MOCK_PVP_OPPONENTS: PvpOpponent[] = [
  {
    id: "pvp-sable",
    name: "Nawaz, Shadow Strategist",
    archetype: "Rogue",
    combatPower: 77,
    note: "Stealth-heavy rival who punishes panic and exposes weak timing.",
  },
  {
    id: "pvp-warden",
    name: "Ranveer, Berserker of Bad Plans",
    archetype: "Warrior",
    combatPower: 82,
    note: "A loud bruiser who gets stronger as the room gets messier.",
  },
  {
    id: "pvp-lyra",
    name: "Deepika, Precision Assassin",
    archetype: "Mage",
    combatPower: 80,
    note: "A boss-killer tuned to punish sloppy positioning and weak artifact builds.",
  },
];

export const DEFAULT_MARKET_PRICE_WEI = "2500000000000000";
