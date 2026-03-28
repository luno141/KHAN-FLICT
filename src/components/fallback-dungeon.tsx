"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DUNGEON_NAME, ENEMY_THEME, PLAYER_HERO_NAME } from "@/src/game/content";
import { calculateDamage, createLog } from "@/src/game/helpers";
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

const TILE_SIZE = 22;

export function FallbackDungeon(props: FallbackDungeonProps) {
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const safeDungeon = useMemo(() => buildSafeDungeon(960, 576), []);
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

  useEffect(() => {
    setPlayerTile({
      x: Math.floor((safeDungeon.encounterLayout.player.x - safeDungeon.metrics.originX) / 16),
      y: Math.floor((safeDungeon.encounterLayout.player.y - safeDungeon.metrics.originY) / 16),
    });
    setEnemies(initialEnemies);
    setLoot([]);
    setHealth(props.stats.health);
    setResolved(false);
    callbacksRef.current.onHealthChange(props.stats.health);
    callbacksRef.current.onLog(
      createLog("Fallback dungeon engaged. Move with WASD and strike with Space.", "neutral"),
    );
  }, [initialEnemies, props.runId, props.stats.health, safeDungeon]);

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

    const moved = currentEnemies.map((enemy) => {
      if (!enemy.alive) {
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
        return enemy;
      }

      return {
        ...enemy,
        tile: nextTile,
      };
    });

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

      <div className="overflow-auto px-4 pb-4 pt-14">
        <div
          className="relative mx-auto rounded-[1.5rem] border border-white/10 bg-[#08101d]"
          style={{
            width: safeDungeon.metrics.widthTiles * TILE_SIZE,
            height: safeDungeon.metrics.heightTiles * TILE_SIZE,
          }}
        >
          {safeDungeon.walkableGrid.map((row, y) =>
            row.map((walkable, x) => (
              <div
                key={`${x}-${y}`}
                className={`absolute ${
                  walkable ? "bg-stone-500/90" : "bg-slate-950"
                }`}
                style={{
                  left: x * TILE_SIZE,
                  top: y * TILE_SIZE,
                  width: TILE_SIZE,
                  height: TILE_SIZE,
                  boxShadow: walkable ? "inset 0 0 0 1px rgba(255,255,255,0.05)" : "inset 0 0 0 1px rgba(20,30,50,0.4)",
                }}
              />
            )),
          )}

          {!allEnemiesDown ? null : (
            <div
              className="absolute flex items-center justify-center rounded-md border border-amber-300/50 bg-amber-300/20 text-xs text-amber-100"
              style={{
                left: portalTile.x * TILE_SIZE,
                top: portalTile.y * TILE_SIZE,
                width: TILE_SIZE,
                height: TILE_SIZE,
              }}
            >
              EXIT
            </div>
          )}

          {loot.map((drop) => (
            <div
              key={drop.id}
              className="absolute flex items-center justify-center text-sm"
              style={{
                left: drop.tile.x * TILE_SIZE,
                top: drop.tile.y * TILE_SIZE,
                width: TILE_SIZE,
                height: TILE_SIZE,
              }}
            >
              ✦
            </div>
          ))}

          {enemies
            .filter((enemy) => enemy.alive)
            .map((enemy) => (
              <div
                key={enemy.id}
                className="absolute flex flex-col items-center justify-center"
                style={{
                  left: enemy.tile.x * TILE_SIZE - 4,
                  top: enemy.tile.y * TILE_SIZE - 18,
                  width: TILE_SIZE + 8,
                  height: TILE_SIZE + 20,
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
                <div className="flex h-8 w-8 items-center justify-center rounded-md border border-rose-400/40 bg-rose-400/15 text-[10px] text-rose-100">
                  {enemy.kind === "slime" ? "CP" : enemy.kind === "skeleton" ? "SK" : "WS"}
                </div>
              </div>
            ))}

          <div
            className="absolute flex items-center justify-center rounded-md border border-cyan-300/50 bg-cyan-300/20 text-[10px] font-semibold text-cyan-50"
            style={{
              left: playerTile.x * TILE_SIZE,
              top: playerTile.y * TILE_SIZE,
              width: TILE_SIZE,
              height: TILE_SIZE,
            }}
          >
            SRK
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 bg-black/25 px-4 py-3 text-xs text-slate-300">
        {PLAYER_HERO_NAME} is in the live dungeon. Clear the three enemies, collect drops, then walk onto the exit tile.
      </div>
    </div>
  );
}
