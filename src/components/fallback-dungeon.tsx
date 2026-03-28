"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DUNGEON_NAME, ENEMY_THEME, PLAYER_HERO_NAME } from "@/src/game/content";
import { calculateDamage, createLog } from "@/src/game/helpers";
import { resolveItemIcon } from "@/src/game/items";
import { buildSafeDungeon } from "@/src/game/dungeon/map";
import type {
  Archetype,
  CombatLogEntry,
  DungeonRunSummary,
  EnemyType,
  InventoryItem,
  LootRollContext,
  StatBlock,
} from "@/src/game/types";

type FallbackDungeonProps = {
  active: boolean;
  archetype: Archetype;
  runId: string;
  stats: StatBlock;
  onLog: (entry: CombatLogEntry) => void;
  onHealthChange: (value: number) => void;
  onLootCollected: (item: InventoryItem) => void;
  onRunComplete: (summary: DungeonRunSummary) => void;
  resolveLoot: (context: LootRollContext) => InventoryItem | null;
};

type TilePoint = { x: number; y: number };
type FacingDirection =
  | "north"
  | "north-east"
  | "east"
  | "south-east"
  | "south"
  | "south-west"
  | "west"
  | "north-west";

type EnemyState = {
  id: string;
  kind: EnemyType;
  tile: TilePoint;
  health: number;
  alive: boolean;
};

type LootState = {
  id: string;
  item: InventoryItem;
  tile: TilePoint;
};

const TILE_SIZE = 28;

const PLAYER_ASSET_ROOT = "/assets/khan-flict/characters/shahrukh-khan/rotations";
const ABHISHEK_ASSET_ROOT = "/assets/khan-flict/characters/abhishek/rotations";
const AMITABH_ASSET_ROOT = "/assets/khan-flict/characters/amitabh/rotations";
const SALMAN_ASSET_ROOT = "/assets/khan-flict/characters/salman/rotations";
const CHOTA_PANDIT_ASSET_ROOT = "/assets/khan-flict/characters/chota-pandit/rotations";
const SCENE_IMAGE = "/assets/khan-flict/scenes/dungeon-stage.png";
const SCENE_IMAGE_ALT = "/assets/khan-flict/scenes/dungeon-stage-alt.png";

const COMPANION_LAYOUT = [
  { name: "Abhishek", dx: -0.8, dy: 0.15, assetRoot: ABHISHEK_ASSET_ROOT },
  { name: "Amitabh", dx: 0.82, dy: 0.05, assetRoot: AMITABH_ASSET_ROOT },
] as const;

function getDirectionFromDelta(dx: number, dy: number): FacingDirection {
  if (dx === 0 && dy < 0) return "north";
  if (dx > 0 && dy < 0) return "north-east";
  if (dx > 0 && dy === 0) return "east";
  if (dx > 0 && dy > 0) return "south-east";
  if (dx === 0 && dy > 0) return "south";
  if (dx < 0 && dy > 0) return "south-west";
  if (dx < 0 && dy === 0) return "west";
  if (dx < 0 && dy < 0) return "north-west";
  return "south";
}

function directionFromMove(from: TilePoint, to: TilePoint): FacingDirection {
  return getDirectionFromDelta(to.x - from.x, to.y - from.y);
}

function getAssetForDirection(assetRoot: string, direction: FacingDirection) {
  return `${assetRoot}/${direction}.png`;
}

export function FallbackDungeon(props: FallbackDungeonProps) {
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const safeDungeon = useMemo(() => buildSafeDungeon(960, 576), []);
  const stageWidth = safeDungeon.metrics.widthTiles * TILE_SIZE;
  const stageHeight = safeDungeon.metrics.heightTiles * TILE_SIZE;
  const initialEnemies = useMemo<EnemyState[]>(
    () =>
      safeDungeon.encounterLayout.enemies.map((enemy, index) => ({
        id: `fallback-enemy-${index}`,
        kind: enemy.kind,
        tile: {
          x: Math.floor((enemy.x - safeDungeon.metrics.originX) / 16),
          y: Math.floor((enemy.y - safeDungeon.metrics.originY) / 16),
        },
        health: ENEMY_THEME[enemy.kind].health,
        alive: true,
      })),
    [safeDungeon],
  );

  const [playerTile, setPlayerTile] = useState<TilePoint>({
    x: Math.floor((safeDungeon.encounterLayout.player.x - safeDungeon.metrics.originX) / 16),
    y: Math.floor((safeDungeon.encounterLayout.player.y - safeDungeon.metrics.originY) / 16),
  });
  const [portalTile] = useState<TilePoint>({
    x: Math.floor((safeDungeon.encounterLayout.portal.x - safeDungeon.metrics.originX) / 16),
    y: Math.floor((safeDungeon.encounterLayout.portal.y - safeDungeon.metrics.originY) / 16),
  });
  const [enemies, setEnemies] = useState<EnemyState[]>(initialEnemies);
  const [loot, setLoot] = useState<LootState[]>([]);
  const [health, setHealth] = useState(props.stats.health);
  const [resolved, setResolved] = useState(false);
  const [startedAt] = useState(() => new Date().toISOString());
  const [stageScale, setStageScale] = useState(1);
  const [playerDirection, setPlayerDirection] = useState<FacingDirection>("south");
  const [enemyDirections, setEnemyDirections] = useState<Record<string, FacingDirection>>(
    () =>
      Object.fromEntries(
        initialEnemies.map((enemy) => [enemy.id, enemy.kind === "wisp" ? "south" : "west"]),
      ),
  );

  useEffect(() => {
    setPlayerTile({
      x: Math.floor((safeDungeon.encounterLayout.player.x - safeDungeon.metrics.originX) / 16),
      y: Math.floor((safeDungeon.encounterLayout.player.y - safeDungeon.metrics.originY) / 16),
    });
    setEnemies(initialEnemies);
    setLoot([]);
    setHealth(props.stats.health);
    setResolved(false);
    setPlayerDirection("south");
    setEnemyDirections(
      Object.fromEntries(
        initialEnemies.map((enemy) => [enemy.id, enemy.kind === "wisp" ? "south" : "west"]),
      ),
    );
    callbacksRef.current.onHealthChange(props.stats.health);
    callbacksRef.current.onLog(
      createLog("Fallback dungeon engaged. Move with WASD and strike with Space.", "neutral"),
    );
  }, [initialEnemies, props.runId, props.stats.health, safeDungeon]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    function updateScale() {
      const currentElement = viewportRef.current;
      if (!currentElement) {
        return;
      }

      const widthScale = Math.max(0.4, (currentElement.clientWidth - 24) / stageWidth);
      const heightScale = Math.max(0.4, (currentElement.clientHeight - 24) / stageHeight);
      setStageScale(Math.min(1, widthScale, heightScale));
    }

    updateScale();

    const observer = new ResizeObserver(() => {
      updateScale();
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [stageHeight, stageWidth]);

  const allEnemiesDown = enemies.every((enemy) => !enemy.alive);

  function isWalkable(tile: TilePoint) {
    return safeDungeon.walkableGrid[tile.y]?.[tile.x] ?? false;
  }

  function sameTile(a: TilePoint, b: TilePoint) {
    return a.x === b.x && a.y === b.y;
  }

  function manhattan(a: TilePoint, b: TilePoint) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function moveEnemies(currentEnemies: EnemyState[], currentPlayer: TilePoint) {
    let nextHealth = health;
    const nextDirections: Record<string, FacingDirection> = {};

    const moved = currentEnemies.map((enemy) => {
      if (!enemy.alive) {
        nextDirections[enemy.id] = enemyDirections[enemy.id] ?? "south";
        return enemy;
      }

      const dx = Math.sign(currentPlayer.x - enemy.tile.x);
      const dy = Math.sign(currentPlayer.y - enemy.tile.y);
      const options: TilePoint[] = [
        { x: enemy.tile.x + dx, y: enemy.tile.y },
        { x: enemy.tile.x, y: enemy.tile.y + dy },
      ].filter((tile) => isWalkable(tile));

      const nextTile =
        options.find((tile) => !sameTile(tile, currentPlayer)) ?? enemy.tile;

      const distance = manhattan(nextTile, currentPlayer);
      if (distance <= 1) {
        const hit = calculateDamage(
          {
            attack: ENEMY_THEME[enemy.kind].attack,
            critChance: enemy.kind === "wisp" ? 0.16 : 0.06,
          },
          { defense: callbacksRef.current.stats.defense },
        );
        nextHealth = Math.max(0, nextHealth - hit.damage);
        callbacksRef.current.onLog(
          createLog(
            `${ENEMY_THEME[enemy.kind].name} hits you for ${hit.damage}${hit.crit ? " crit" : ""}.`,
            "bad",
          ),
        );
        nextDirections[enemy.id] = getDirectionFromDelta(
          currentPlayer.x - enemy.tile.x,
          currentPlayer.y - enemy.tile.y,
        );
        return enemy;
      }

      nextDirections[enemy.id] = directionFromMove(enemy.tile, nextTile);
      return {
        ...enemy,
        tile: nextTile,
      };
    });

    setEnemyDirections((current) => ({
      ...current,
      ...nextDirections,
    }));

    if (nextHealth !== health) {
      setHealth(nextHealth);
      callbacksRef.current.onHealthChange(nextHealth);
      if (nextHealth <= 0 && !resolved) {
        setResolved(true);
        callbacksRef.current.onRunComplete({
          id: callbacksRef.current.runId,
          roomName: DUNGEON_NAME,
          enemiesDefeated: moved.filter((enemy) => !enemy.alive).length,
          lootCollected: loot.length,
          outcome: "defeat",
          startedAt,
          endedAt: new Date().toISOString(),
          notes: "The fallback dungeon still got you. Try the scene again.",
        });
      }
    }

    return moved;
  }

  useEffect(() => {
    if (!props.active || resolved) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (resolved) {
        return;
      }

      const key = event.key.toLowerCase();
      let nextPlayer = playerTile;
      let acted = false;

      if (key === "w") nextPlayer = { x: playerTile.x, y: playerTile.y - 1 };
      if (key === "s") nextPlayer = { x: playerTile.x, y: playerTile.y + 1 };
      if (key === "a") nextPlayer = { x: playerTile.x - 1, y: playerTile.y };
      if (key === "d") nextPlayer = { x: playerTile.x + 1, y: playerTile.y };

      if (["w", "a", "s", "d"].includes(key)) {
        event.preventDefault();
        setPlayerDirection(directionFromMove(playerTile, nextPlayer));
        if (isWalkable(nextPlayer)) {
          setPlayerTile(nextPlayer);
          acted = true;

          const collected = loot.find((drop) => sameTile(drop.tile, nextPlayer));
          if (collected) {
            callbacksRef.current.onLootCollected(collected.item);
            callbacksRef.current.onLog(createLog(`Looted ${collected.item.name}.`, "loot"));
            setLoot((current) => current.filter((drop) => drop.id !== collected.id));
          }

          if (allEnemiesDown && sameTile(nextPlayer, portalTile)) {
            setResolved(true);
            callbacksRef.current.onRunComplete({
              id: callbacksRef.current.runId,
              roomName: DUNGEON_NAME,
              enemiesDefeated: enemies.filter((enemy) => !enemy.alive).length,
              lootCollected: loot.length,
              outcome: "victory",
              startedAt,
              endedAt: new Date().toISOString(),
              notes: "Fallback dungeon cleared. The rescue route is open.",
            });
            return;
          }
        }
      }

      if (key === " " || key === "space") {
        event.preventDefault();
        acted = true;

        const target = enemies
          .filter((enemy) => enemy.alive)
          .sort((left, right) => manhattan(left.tile, playerTile) - manhattan(right.tile, playerTile))[0];

        if (!target || manhattan(target.tile, playerTile) > 1) {
          callbacksRef.current.onLog(createLog("Swing missed. Step closer to strike.", "neutral"));
        } else {
          const hit = calculateDamage(
            {
              attack: callbacksRef.current.stats.attack,
              critChance: callbacksRef.current.stats.critChance,
            },
            { defense: ENEMY_THEME[target.kind].defense },
          );

          setEnemies((current) => {
            const next = current.map((enemy) => {
              if (enemy.id !== target.id) {
                return enemy;
              }

              const nextHealth = enemy.health - hit.damage;
              if (nextHealth > 0) {
                return { ...enemy, health: nextHealth };
              }

              const lootDrop = callbacksRef.current.resolveLoot({
                enemyType: enemy.kind,
                luck: callbacksRef.current.stats.luck,
              });
              if (lootDrop) {
                setLoot((drops) => [
                  ...drops,
                  {
                    id: `${enemy.id}-loot`,
                    item: lootDrop,
                    tile: enemy.tile,
                  },
                ]);
              }

              callbacksRef.current.onLog(
                createLog(
                  `Defeated ${ENEMY_THEME[enemy.kind].name}${lootDrop ? ` and dropped ${lootDrop.name}` : ""}.`,
                  "good",
                ),
              );

              return { ...enemy, health: 0, alive: false };
            });

            return moveEnemies(next, playerTile);
          });

          callbacksRef.current.onLog(
            createLog(
              `You hit ${ENEMY_THEME[target.kind].name} for ${hit.damage}${hit.crit ? " crit" : ""}.`,
              hit.crit ? "good" : "neutral",
            ),
          );
          setEnemyDirections((current) => ({
            ...current,
            [target.id]: getDirectionFromDelta(
              playerTile.x - target.tile.x,
              playerTile.y - target.tile.y,
            ),
          }));
        }
      }

      if (acted && (key !== " " && key !== "space")) {
        setEnemies((current) => moveEnemies(current, nextPlayer));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    allEnemiesDown,
    enemies,
    health,
    loot,
    playerTile,
    portalTile,
    props.active,
    resolved,
    safeDungeon.walkableGrid,
    startedAt,
  ]);

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#050816]/85 shadow-[0_0_90px_rgba(86,229,255,0.08)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3">
        <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-amber-100">
          Dungeon Live
        </span>
        <span className="rounded-full border border-lime-400/20 bg-lime-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-lime-200">
          WASD + Space
        </span>
      </div>

      <div className="px-4 pb-4 pt-14">
        <div
          ref={viewportRef}
          className="relative mx-auto overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#08101d]"
          style={{ height: "min(72vh, 760px)" }}
        >
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width: stageWidth,
              height: stageHeight,
              transform: `translate(-50%, -50%) scale(${stageScale})`,
              transformOrigin: "center center",
            }}
          >
          <img
            src={SCENE_IMAGE}
            alt="Dungeon backdrop"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-95"
            draggable={false}
          />
          <img
            src={SCENE_IMAGE_ALT}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-24 mix-blend-screen"
            draggable={false}
          />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(22,163,74,0.08),transparent_35%),linear-gradient(180deg,rgba(5,8,22,0.12),rgba(5,8,22,0.38))]" />

          {safeDungeon.walkableGrid.map((row, y) =>
            row.map((walkable, x) => (
              <div
                key={`${x}-${y}`}
                className={`absolute ${
                  walkable ? "bg-stone-200/12" : "bg-slate-950/0"
                }`}
                style={{
                  left: x * TILE_SIZE,
                  top: y * TILE_SIZE,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                  boxShadow: walkable
                    ? "inset 0 0 0 1px rgba(255,255,255,0.04), 0 0 18px rgba(240,210,170,0.05)"
                    : "none",
                  backdropFilter: walkable ? "blur(0.5px)" : undefined,
                }}
              />
            )),
          )}

          {!allEnemiesDown ? null : (
            <div
              className="absolute flex items-center justify-center"
              style={{
                left: portalTile.x * TILE_SIZE - 8,
                top: portalTile.y * TILE_SIZE - 14,
                width: TILE_SIZE + 16,
                height: TILE_SIZE + 16,
              }}
            >
              <div className="absolute inset-0 rounded-full border border-amber-300/55 bg-amber-300/15 shadow-[0_0_40px_rgba(245,158,11,0.35)]" />
              <div className="absolute inset-[10px] rounded-full border border-white/30" />
              <span className="relative z-10 text-[10px] font-semibold uppercase tracking-[0.26em] text-amber-100">
                Exit
              </span>
            </div>
          )}

          {loot.map((drop) => (
            <div
              key={drop.id}
              className="absolute flex items-center justify-center"
              style={{
                left: drop.tile.x * TILE_SIZE - 6,
                top: drop.tile.y * TILE_SIZE - 10,
                width: TILE_SIZE + 12,
                height: TILE_SIZE + 12,
              }}
            >
              <div className="absolute inset-0 rounded-full bg-amber-300/18 blur-sm" />
              <img
                src={resolveItemIcon(drop.item)}
                alt={drop.item.name}
                className="relative z-10 h-8 w-8 object-contain drop-shadow-[0_0_14px_rgba(250,204,21,0.4)]"
                draggable={false}
              />
            </div>
          ))}

          {enemies
            .filter((enemy) => enemy.alive)
            .map((enemy) => (
              <div
                key={enemy.id}
                className="absolute flex flex-col items-center justify-center"
                style={{
                  left: enemy.tile.x * TILE_SIZE - 10,
                  top: enemy.tile.y * TILE_SIZE - 26,
                  width: TILE_SIZE + 20,
                  height: TILE_SIZE + 34,
                }}
              >
                <div className="mb-1 h-1.5 w-10 overflow-hidden rounded-full bg-slate-900">
                  <div
                    className="h-full rounded-full bg-lime-400"
                    style={{
                      width: `${Math.max(0, Math.round((enemy.health / ENEMY_THEME[enemy.kind].health) * 100))}%`,
                    }}
                  />
                </div>
                <div className="relative flex h-14 w-14 items-end justify-center">
                  <div className="absolute bottom-1 h-3 w-8 rounded-full bg-black/40 blur-sm" />
                  <img
                    src={getAssetForDirection(
                      enemy.kind === "wisp" ? SALMAN_ASSET_ROOT : CHOTA_PANDIT_ASSET_ROOT,
                      enemyDirections[enemy.id] ?? "south",
                    )}
                    alt={ENEMY_THEME[enemy.kind].name}
                    className="relative z-10 h-12 w-12 object-contain"
                    style={{ imageRendering: "pixelated" }}
                    draggable={false}
                  />
                </div>
                <div className="mt-1 rounded-full border border-rose-400/20 bg-black/35 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-rose-100">
                  {ENEMY_THEME[enemy.kind].name}
                </div>
              </div>
            ))}

          {COMPANION_LAYOUT.map((companion) => (
            <div
              key={companion.name}
              className="absolute flex items-end justify-center"
              style={{
                left: playerTile.x * TILE_SIZE + companion.dx * TILE_SIZE - 14,
                top: playerTile.y * TILE_SIZE + companion.dy * TILE_SIZE - 24,
                width: TILE_SIZE + 18,
                height: TILE_SIZE + 26,
              }}
            >
              <div className="absolute bottom-1 h-3 w-8 rounded-full bg-black/30 blur-sm" />
              <img
                src={getAssetForDirection(companion.assetRoot, playerDirection)}
                alt={companion.name}
                className="relative z-10 h-12 w-12 object-contain opacity-90"
                style={{ imageRendering: "pixelated" }}
                draggable={false}
              />
            </div>
          ))}

          <div
            className="absolute flex items-end justify-center"
            style={{
              left: playerTile.x * TILE_SIZE - 12,
              top: playerTile.y * TILE_SIZE - 28,
              width: TILE_SIZE + 24,
              height: TILE_SIZE + 34,
            }}
          >
            <div className="absolute bottom-1 h-3 w-9 rounded-full bg-black/35 blur-sm" />
            <img
              src={getAssetForDirection(PLAYER_ASSET_ROOT, playerDirection)}
              alt={PLAYER_HERO_NAME}
              className="relative z-10 h-14 w-14 object-contain"
              style={{ imageRendering: "pixelated" }}
              draggable={false}
            />
          </div>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 bg-black/25 px-4 py-3 text-xs text-slate-300">
        {PLAYER_HERO_NAME} is live with Abhishek and Amitabh on the floor. Clear the enemies, grab the drops, then step onto the exit ring.
      </div>
    </div>
  );
}
