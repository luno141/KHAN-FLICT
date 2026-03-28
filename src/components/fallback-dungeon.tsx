"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DUNGEON_NAME, ENEMY_THEME, PLAYER_HERO_NAME } from "@/src/game/content";
import { calculateDamage, createId, createLog } from "@/src/game/helpers";
import { isAssetIcon, resolveItemIcon } from "@/src/game/items";
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

const PLAYER_SHEETS = {
  Warrior: "/assets/relic-rush/characters/warrior-1",
  Rogue: "/assets/relic-rush/characters/warrior-2",
  Mage: "/assets/relic-rush/characters/warrior-3",
} as const satisfies Record<Archetype, string>;

const ENEMY_SHEETS: Record<EnemyType, string> = {
  slime: "/assets/relic-rush/enemies/green-slime",
  skeleton: "/assets/relic-rush/enemies/blue-slime",
  wisp: "/assets/relic-rush/enemies/red-slime",
};

const COMPANION_LAYOUT = [
  { name: "Shade Runner", dx: -0.8, dy: 0.15, sheetRoot: PLAYER_SHEETS.Rogue },
  { name: "Ember Scholar", dx: 0.82, dy: 0.05, sheetRoot: PLAYER_SHEETS.Mage },
] as const;

const PLAYER_FRAME = { width: 96, height: 96 };
const ENEMY_FRAME = { width: 128, height: 128 };
const PORTAL_ICON = "/assets/relic-rush/items/gate-sigil.png";
const SCENE_TILE_SHEET = "/assets/relic-rush/tiles/Ground_rocks.png";
const SCENE_OBJECT_SHEET = "/assets/relic-rush/tiles/Objects.png";

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

function isFacingLeft(direction: FacingDirection) {
  return direction === "west" || direction === "north-west" || direction === "south-west";
}

function scheduleUiUpdate(task: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(task);
    return;
  }

  window.setTimeout(task, 0);
}

function SpriteStrip({
  src,
  frameWidth,
  frameHeight,
  frameCount,
  frameIndex,
  width,
  height,
  flipX = false,
  className,
}: {
  src: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  frameIndex: number;
  width: number;
  height: number;
  flipX?: boolean;
  className?: string;
}) {
  const style: CSSProperties = {
    width,
    height,
    backgroundImage: `url(${src})`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: `-${(frameIndex % frameCount) * frameWidth}px 0`,
    backgroundSize: `${frameWidth * frameCount}px ${frameHeight}px`,
    imageRendering: "pixelated",
    transform: flipX ? "scaleX(-1)" : undefined,
    transformOrigin: "center",
  };

  return <div className={className} style={style} aria-hidden="true" />;
}

export function FallbackDungeon(props: FallbackDungeonProps) {
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastInputAtRef = useRef(0);
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
  const [animationTick, setAnimationTick] = useState(0);

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
    scheduleUiUpdate(() => {
      callbacksRef.current.onHealthChange(props.stats.health);
      callbacksRef.current.onLog(
        createLog("Fallback vault path engaged. Move with WASD and strike with Space.", "neutral"),
      );
    });
  }, [initialEnemies, props.runId, props.stats.health, safeDungeon]);

  useEffect(() => {
    if (!props.active) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setAnimationTick((current) => current + 1);
    }, 180);

    return () => window.clearInterval(intervalId);
  }, [props.active]);

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
        scheduleUiUpdate(() => {
          callbacksRef.current.onLog(
            createLog(
              `${ENEMY_THEME[enemy.kind].name} hits you for ${hit.damage}${hit.crit ? " crit" : ""}.`,
              "bad",
            ),
          );
        });
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
      scheduleUiUpdate(() => {
        callbacksRef.current.onHealthChange(nextHealth);
      });
      if (nextHealth <= 0 && !resolved) {
        setResolved(true);
        scheduleUiUpdate(() => {
          callbacksRef.current.onRunComplete({
            id: callbacksRef.current.runId,
            roomName: DUNGEON_NAME,
            enemiesDefeated: moved.filter((enemy) => !enemy.alive).length,
            lootCollected: loot.length,
            outcome: "defeat",
            startedAt,
            endedAt: new Date().toISOString(),
            notes: "The fallback route collapsed before extraction. Refit and re-enter the vault.",
          });
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
      const now = Date.now();
      if (now - lastInputAtRef.current < 90) {
        return;
      }

      lastInputAtRef.current = now;
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
            scheduleUiUpdate(() => {
              callbacksRef.current.onLootCollected(collected.item);
              callbacksRef.current.onLog(createLog(`Looted ${collected.item.name}.`, "loot"));
            });
            setLoot((current) => current.filter((drop) => drop.id !== collected.id));
          }

          if (allEnemiesDown && sameTile(nextPlayer, portalTile)) {
            setResolved(true);
            scheduleUiUpdate(() => {
              callbacksRef.current.onRunComplete({
                id: callbacksRef.current.runId,
                roomName: DUNGEON_NAME,
                enemiesDefeated: enemies.filter((enemy) => !enemy.alive).length,
                lootCollected: loot.length,
                outcome: "victory",
                startedAt,
                endedAt: new Date().toISOString(),
                notes: "Fallback vault path cleared. The extraction gate is open.",
              });
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
          scheduleUiUpdate(() => {
            callbacksRef.current.onLog(
              createLog("Swing missed. Step closer to strike.", "neutral"),
            );
          });
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
                    id: createId(`${enemy.id}-loot`),
                    item: lootDrop,
                    tile: enemy.tile,
                  },
                ]);
              }

              scheduleUiUpdate(() => {
                callbacksRef.current.onLog(
                  createLog(
                    `Defeated ${ENEMY_THEME[enemy.kind].name}${lootDrop ? ` and dropped ${lootDrop.name}` : ""}.`,
                    "good",
                  ),
                );
              });

              return { ...enemy, health: 0, alive: false };
            });

            return moveEnemies(next, playerTile);
          });

          scheduleUiUpdate(() => {
            callbacksRef.current.onLog(
              createLog(
                `You hit ${ENEMY_THEME[target.kind].name} for ${hit.damage}${hit.crit ? " crit" : ""}.`,
                hit.crit ? "good" : "neutral",
              ),
            );
          });
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

  const playerSheetRoot = PLAYER_SHEETS[props.archetype];

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#050816]/85 shadow-[0_0_90px_rgba(86,229,255,0.08)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3">
        <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-amber-100">
          Safe Mode
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
              src={SCENE_TILE_SHEET}
              alt=""
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 opacity-18 mix-blend-screen"
              style={{
                width: stageWidth * 1.35,
                height: stageHeight * 1.35,
                imageRendering: "pixelated",
              }}
              draggable={false}
            />
            <img
              src={SCENE_OBJECT_SHEET}
              alt=""
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 opacity-14 mix-blend-screen"
              style={{
                width: stageWidth * 1.05,
                height: stageHeight * 1.05,
                imageRendering: "pixelated",
              }}
              draggable={false}
            />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.12),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(96,165,250,0.16),transparent_28%),linear-gradient(180deg,rgba(5,8,22,0.18),rgba(5,8,22,0.46))]" />

            {safeDungeon.walkableGrid.map((row, y) =>
              row.map((walkable, x) => (
                <div
                  key={`${x}-${y}`}
                  className="absolute"
                  style={{
                    left: x * TILE_SIZE,
                    top: y * TILE_SIZE,
                    width: TILE_SIZE,
                    height: TILE_SIZE,
                    background: walkable
                      ? "linear-gradient(180deg, rgba(145,156,132,0.26), rgba(79,93,72,0.18))"
                      : "linear-gradient(180deg, rgba(8,15,28,0.92), rgba(6,10,18,0.92))",
                    boxShadow: walkable
                      ? "inset 0 0 0 1px rgba(255,255,255,0.05), 0 0 18px rgba(163,230,53,0.05)"
                      : "inset 0 0 0 1px rgba(59,130,246,0.03)",
                  }}
                />
              )),
            )}

            {!allEnemiesDown ? null : (
              <div
                className="absolute flex items-center justify-center"
                style={{
                  left: portalTile.x * TILE_SIZE - 10,
                  top: portalTile.y * TILE_SIZE - 18,
                  width: TILE_SIZE + 20,
                  height: TILE_SIZE + 22,
                }}
              >
                <div className="absolute inset-0 rounded-full border border-amber-300/55 bg-amber-300/15 shadow-[0_0_40px_rgba(245,158,11,0.35)]" />
                <img
                  src={PORTAL_ICON}
                  alt="Extraction gate"
                  className="relative z-10 h-8 w-8 object-contain drop-shadow-[0_0_18px_rgba(250,204,21,0.4)]"
                  style={{ imageRendering: "pixelated" }}
                  draggable={false}
                />
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
                {isAssetIcon(resolveItemIcon(drop.item)) ? (
                  <img
                    src={resolveItemIcon(drop.item)}
                    alt={drop.item.name}
                    className="relative z-10 h-8 w-8 object-contain drop-shadow-[0_0_14px_rgba(250,204,21,0.4)]"
                    draggable={false}
                  />
                ) : (
                  <span className="relative z-10 text-2xl drop-shadow-[0_0_14px_rgba(250,204,21,0.4)]">
                    {resolveItemIcon(drop.item)}
                  </span>
                )}
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
                    <SpriteStrip
                      src={`${ENEMY_SHEETS[enemy.kind]}/Run.png`}
                      frameWidth={ENEMY_FRAME.width}
                      frameHeight={ENEMY_FRAME.height}
                      frameCount={7}
                      frameIndex={animationTick + enemy.tile.x + enemy.tile.y}
                      width={52}
                      height={52}
                      flipX={isFacingLeft(enemyDirections[enemy.id] ?? "south")}
                      className="relative z-10"
                    />
                  </div>
                  <div className="mt-1 rounded-full border border-rose-400/20 bg-black/35 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-rose-100">
                    {ENEMY_THEME[enemy.kind].name}
                  </div>
                </div>
              ))}

            {COMPANION_LAYOUT.map((companion, index) => (
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
                <SpriteStrip
                  src={`${companion.sheetRoot}/Idle.png`}
                  frameWidth={PLAYER_FRAME.width}
                  frameHeight={PLAYER_FRAME.height}
                  frameCount={6}
                  frameIndex={animationTick + index * 2}
                  width={48}
                  height={48}
                  flipX={isFacingLeft(playerDirection)}
                  className="relative z-10 opacity-90"
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
              <SpriteStrip
                src={`${playerSheetRoot}/Walk.png`}
                frameWidth={PLAYER_FRAME.width}
                frameHeight={PLAYER_FRAME.height}
                frameCount={8}
                frameIndex={animationTick}
                width={56}
                height={56}
                flipX={isFacingLeft(playerDirection)}
                className="relative z-10"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 bg-black/25 px-4 py-3 text-xs text-slate-300">
        {PLAYER_HERO_NAME} is live with the Shade Runner and Ember Scholar. Clear the room, grab the drops, and step through the extraction gate.
      </div>
    </div>
  );
}
