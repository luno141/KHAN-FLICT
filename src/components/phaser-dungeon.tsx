"use client";

import { useEffect, useRef, useState } from "react";
import { FallbackDungeon } from "@/src/components/fallback-dungeon";
import { DUNGEON_NAME, ENEMY_THEME } from "@/src/game/content";
import {
  calculateDamage,
  createId,
  createLog,
  rarityColor,
} from "@/src/game/helpers";
import {
  buildMapMetrics,
  buildSafeDungeon,
  buildWalkableGrid,
  getLayerRenderBand,
  getTilesetForGid,
  MAP_TILE_SIZE,
  mergeCollisionGrid,
  parseMapLayers,
  resolveEncounterLayout,
  type TileLayer,
  type MapMetrics,
} from "@/src/game/dungeon/map";
import {
  getActorDepth,
  getDirectionFromVector,
  getShadowDepth,
  type Direction8,
} from "@/src/game/dungeon/runtime";
import type {
  Archetype,
  CombatLogEntry,
  DungeonRunSummary,
  EnemyType,
  InventoryItem,
  LootRollContext,
  StatBlock,
} from "@/src/game/types";
import { getUiErrorMessage } from "@/src/lib/ui-error";

type PhaserDungeonProps = {
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

type SceneCallbacks = PhaserDungeonProps;

type DungeonEnemy = {
  id: string;
  kind: EnemyType;
  packKey: string;
  renderMode: "sheet" | "directional-static" | "directional-walk";
  sprite: Phaser.Physics.Arcade.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  healthBar: Phaser.GameObjects.Graphics;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  nextSwingAt: number;
  animLockUntil: number;
  alive: boolean;
  facing: Direction8;
};

type CompanionSlot = "left" | "right";

type DungeonCompanion = {
  id: string;
  name: string;
  packKey: string;
  slot: CompanionSlot;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
};

const SCENE_WIDTH = 960;
const SCENE_HEIGHT = 576;

const PLAYER_PACK: Record<Archetype, string> = {
  Warrior: "warrior-1",
  Rogue: "warrior-2",
  Mage: "warrior-3",
};

const ENEMY_PACK: Record<EnemyType, string> = {
  slime: "green-slime",
  skeleton: "blue-slime",
  wisp: "red-slime",
};

const DIRECTIONAL_ENEMY_PACK: Partial<Record<
  EnemyType,
  {
    key: string;
    mode: "directional-static" | "directional-walk";
    scale: number;
    label: string;
  }
>> = {};

const DIRECTION_ORDER: Direction8[] = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
];

const COMPANION_CAST = [
  {
    id: "shade-runner",
    name: "Shade Runner",
    packKey: PLAYER_PACK.Rogue,
    slot: "left",
  },
  {
    id: "ember-scholar",
    name: "Ember Scholar",
    packKey: PLAYER_PACK.Mage,
    slot: "right",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  packKey: string;
  slot: CompanionSlot;
}>;

const PLAYER_SHEET_CONFIG = { frameWidth: 96, frameHeight: 96 };
const ENEMY_SHEET_CONFIG = { frameWidth: 128, frameHeight: 128 };

export function PhaserDungeon(props: PhaserDungeonProps) {
  return <ExperimentalPhaserDungeon {...props} />;
}

function ExperimentalPhaserDungeon(props: PhaserDungeonProps) {
  const [useSafeMode, setUseSafeMode] = useState(false);
  const [sceneBootState, setSceneBootState] = useState<"booting" | "ready" | "error">("booting");
  const [sceneError, setSceneError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<{
    destroy: (removeCanvas: boolean, noReturn?: boolean) => void;
  } | null>(null);
  const callbacksRef = useRef<SceneCallbacks>(props);

  useEffect(() => {
    callbacksRef.current = props;
  }, [props]);

  useEffect(() => {
    if (!containerRef.current || !props.active) {
      return;
    }

    let disposed = false;
    let bootTimer: ReturnType<typeof setTimeout> | null = null;
    setSceneBootState("booting");
    setSceneError(null);
    setUseSafeMode(false);

    bootTimer = setTimeout(() => {
      if (!disposed) {
        setSceneError("Primary scene boot timed out. Switching to safe dungeon mode.");
        setSceneBootState("error");
        setUseSafeMode(true);
      }
    }, 1800);

    void import("phaser")
      .then((phaserModule) => {
        if (disposed || !containerRef.current) {
          return;
        }

        const Phaser = phaserModule.default;
        const palette = {
          bg: 0x040814,
          floor: 0x0c1324,
          frame: 0x223250,
          portal: 0xfacc15,
          portalGlow: 0xfde68a,
          drop: 0xf472b6,
          shadow: 0x030712,
        };

        class DungeonScene extends Phaser.Scene {
        private player!: Phaser.Physics.Arcade.Sprite;
        private playerShadow!: Phaser.GameObjects.Ellipse;
        private squadFollowers: DungeonCompanion[] = [];
        private portal!: Phaser.Physics.Arcade.Sprite;
        private cursors!: {
          left: Phaser.Input.Keyboard.Key;
          right: Phaser.Input.Keyboard.Key;
          up: Phaser.Input.Keyboard.Key;
          down: Phaser.Input.Keyboard.Key;
        };
        private attackKey!: Phaser.Input.Keyboard.Key;
        private enemyBodies: DungeonEnemy[] = [];
        private lootGroup!: Phaser.Physics.Arcade.Group;
        private currentHealth = callbacksRef.current.stats.health;
        private enemiesDefeated = 0;
        private lootCollected = 0;
        private attackCooldownUntil = 0;
        private playerAnimLockUntil = 0;
        private startedAt = new Date().toISOString();
        private runResolved = false;
        private blockers!: Phaser.Physics.Arcade.StaticGroup;
        private mapMetrics!: MapMetrics;
        private walkableGrid!: boolean[][];
        private lastHeading = new Phaser.Math.Vector2(1, 0);

        private getDynamicBody(sprite: Phaser.Physics.Arcade.Sprite) {
          return sprite.body as Phaser.Physics.Arcade.Body | null;
        }

        preload() {
          this.load.text("relic-rush-tmx", "/assets/relic-rush/tiles/Undead_land.tmx");
          this.load.spritesheet(
            "tiles-ground",
            "/assets/relic-rush/tiles/Ground_rocks.png",
            { frameWidth: MAP_TILE_SIZE, frameHeight: MAP_TILE_SIZE },
          );
          this.load.spritesheet(
            "tiles-water-v2",
            "/assets/relic-rush/tiles/water_detilazation_v2.png",
            { frameWidth: MAP_TILE_SIZE, frameHeight: MAP_TILE_SIZE },
          );
          this.load.spritesheet(
            "tiles-water-v1",
            "/assets/relic-rush/tiles/water_detilazation.png",
            { frameWidth: MAP_TILE_SIZE, frameHeight: MAP_TILE_SIZE },
          );
          this.load.spritesheet(
            "tiles-water-coasts",
            "/assets/relic-rush/tiles/water_coasts.png",
            { frameWidth: MAP_TILE_SIZE, frameHeight: MAP_TILE_SIZE },
          );
          this.load.spritesheet(
            "tiles-objects",
            "/assets/relic-rush/tiles/Objects.png",
            { frameWidth: MAP_TILE_SIZE, frameHeight: MAP_TILE_SIZE },
          );
          this.load.spritesheet(
            "tiles-objects-animated-1",
            "/assets/relic-rush/tiles/Objects_animated.png",
            { frameWidth: MAP_TILE_SIZE, frameHeight: MAP_TILE_SIZE },
          );
          this.load.spritesheet(
            "tiles-objects-animated-2",
            "/assets/relic-rush/tiles/Objects_animated2.png",
            { frameWidth: MAP_TILE_SIZE, frameHeight: MAP_TILE_SIZE },
          );
          this.load.spritesheet(
            "tiles-objects-animated-3",
            "/assets/relic-rush/tiles/Objects_animated3.png",
            { frameWidth: MAP_TILE_SIZE, frameHeight: MAP_TILE_SIZE },
          );
          this.load.spritesheet(
            "tiles-details",
            "/assets/relic-rush/tiles/details.png",
            { frameWidth: MAP_TILE_SIZE, frameHeight: MAP_TILE_SIZE },
          );

          for (const packKey of Object.values(PLAYER_PACK)) {
            this.load.spritesheet(
              `${packKey}-idle`,
              `/assets/relic-rush/characters/${packKey}/Idle.png`,
              PLAYER_SHEET_CONFIG,
            );
            this.load.spritesheet(
              `${packKey}-walk`,
              `/assets/relic-rush/characters/${packKey}/Walk.png`,
              PLAYER_SHEET_CONFIG,
            );
            this.load.spritesheet(
              `${packKey}-attack`,
              `/assets/relic-rush/characters/${packKey}/Attack_1.png`,
              PLAYER_SHEET_CONFIG,
            );
            this.load.spritesheet(
              `${packKey}-hurt`,
              `/assets/relic-rush/characters/${packKey}/Hurt.png`,
              PLAYER_SHEET_CONFIG,
            );
            this.load.spritesheet(
              `${packKey}-dead`,
              `/assets/relic-rush/characters/${packKey}/Dead.png`,
              PLAYER_SHEET_CONFIG,
            );
          }

          for (const packKey of Object.values(ENEMY_PACK)) {
            this.load.spritesheet(
              `${packKey}-idle`,
              `/assets/relic-rush/enemies/${packKey}/Idle.png`,
              ENEMY_SHEET_CONFIG,
            );
            this.load.spritesheet(
              `${packKey}-run`,
              `/assets/relic-rush/enemies/${packKey}/Run.png`,
              ENEMY_SHEET_CONFIG,
            );
            this.load.spritesheet(
              `${packKey}-attack`,
              `/assets/relic-rush/enemies/${packKey}/Attack_1.png`,
              ENEMY_SHEET_CONFIG,
            );
            this.load.spritesheet(
              `${packKey}-hurt`,
              `/assets/relic-rush/enemies/${packKey}/Hurt.png`,
              ENEMY_SHEET_CONFIG,
            );
            this.load.spritesheet(
              `${packKey}-dead`,
              `/assets/relic-rush/enemies/${packKey}/Dead.png`,
              ENEMY_SHEET_CONFIG,
            );
          }
        }

        create() {
          try {
            this.cameras.main.setBackgroundColor(palette.bg);
            this.buildTextures(palette);
            this.createAnimations();
            const fallbackDungeon = buildSafeDungeon(SCENE_WIDTH, SCENE_HEIGHT);
            const mapRaw = this.cache.text.get("relic-rush-tmx") as string | undefined;
            const parsedLayers = parseMapLayers(mapRaw);
            const authoredLayers = parsedLayers.filter((layer) =>
              layer.chunks.some((chunk) => chunk.gids.some((gid) => gid > 0)),
            );
            const authoredMetrics =
              authoredLayers.length > 0
                ? buildMapMetrics(authoredLayers, SCENE_WIDTH, SCENE_HEIGHT)
                : fallbackDungeon.metrics;
            const authoredWalkableGrid =
              authoredLayers.length > 0
                ? buildWalkableGrid(authoredLayers, authoredMetrics)
                : fallbackDungeon.walkableGrid;
            const hasWalkableTiles = authoredWalkableGrid.some((row) =>
              row.some(Boolean),
            );

            this.mapMetrics = hasWalkableTiles ? authoredMetrics : fallbackDungeon.metrics;
            this.walkableGrid = hasWalkableTiles
              ? authoredWalkableGrid
              : fallbackDungeon.walkableGrid;
            this.physics.world.setBounds(
              this.mapMetrics.originX,
              this.mapMetrics.originY,
              this.mapMetrics.widthPx,
              this.mapMetrics.heightPx,
            );
            this.renderSceneBackdrop();
            this.buildArenaFrame(palette, this.mapMetrics);
            if (hasWalkableTiles && authoredLayers.length > 0) {
              this.renderAuthoredDungeonMap(authoredLayers, this.mapMetrics);
            } else {
              this.renderSafeDungeonMap(this.walkableGrid, this.mapMetrics);
            }
            this.blockers = this.buildCollisionBodies(this.walkableGrid, this.mapMetrics);
            const encounterLayout =
              hasWalkableTiles && authoredLayers.length > 0
                ? resolveEncounterLayout(this.walkableGrid, this.mapMetrics)
                : fallbackDungeon.encounterLayout;

            const playerPack = PLAYER_PACK[callbacksRef.current.archetype];
            this.playerShadow = this.add
              .ellipse(0, 0, 28, 12, palette.shadow, 0.42)
              .setDepth(17);
            this.player = this.physics.add.sprite(
              encounterLayout.player.x,
              encounterLayout.player.y,
              `${playerPack}-idle`,
            );
            this.player
              .setCollideWorldBounds(true)
              .setDepth(20)
              .setScale(0.58);
            const playerBody = this.getDynamicBody(this.player);
            playerBody?.setSize(14, 16);
            playerBody?.setOffset(41, 74);
            playerBody?.setDrag(1400, 1400);
            playerBody?.setMaxVelocity(
              70 + callbacksRef.current.stats.speed * 2.5,
              70 + callbacksRef.current.stats.speed * 2.5,
            );
            this.player.anims.play(`${playerPack}-idle`, true);
            this.lastHeading.set(1, 0);
            this.physics.add.collider(this.player, this.blockers);
            this.cameras.main.stopFollow();
            this.cameras.main.setScroll(0, 0);
            this.cameras.main.centerOn(SCENE_WIDTH / 2, SCENE_HEIGHT / 2);
            this.cameras.main.setZoom(1.02);
            this.cameras.main.roundPixels = true;
            this.squadFollowers = this.spawnCompanions(
              encounterLayout.player.x,
              encounterLayout.player.y,
            );

            // Locked gate frame — visible from the start but dimmed
            this.portal = this.physics.add.sprite(
              encounterLayout.portal.x,
              encounterLayout.portal.y,
              "relic-portal-locked",
            );
            this.portal.setDepth(getActorDepth(encounterLayout.portal.y, 14)).setAlpha(0.7);
            if (this.getDynamicBody(this.portal)) {
              this.getDynamicBody(this.portal)!.enable = false;
            }

          // "EXIT" label above the portal
            const portalLabel = this.add.text(
              encounterLayout.portal.x,
              encounterLayout.portal.y - 40,
              "🔒 EXIT",
              {
                color: "#94a3b8",
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
              },
            );
            portalLabel.setOrigin(0.5).setDepth(getActorDepth(encounterLayout.portal.y, 21));
            this.portal.setData("label", portalLabel);

            this.enemyBodies = this.spawnEnemies(encounterLayout.enemies);
            this.enemyBodies.forEach((enemy) => {
              const enemyBody = this.getDynamicBody(enemy.sprite);
              if (enemy.renderMode === "sheet") {
                enemyBody?.setSize(18, 16);
                enemyBody?.setOffset(55, 88);
              } else {
                enemyBody?.setSize(18, 16);
                enemyBody?.setOffset(15, 22);
              }
              enemyBody?.setMaxVelocity(
                38 + enemy.speed * 3.5,
                38 + enemy.speed * 3.5,
              );
              this.physics.add.collider(enemy.sprite, this.blockers);
              this.physics.add.collider(enemy.sprite, this.player);
            });

            this.lootGroup = this.physics.add.group({
              immovable: true,
              allowGravity: false,
            });

            this.physics.add.overlap(this.player, this.lootGroup, (_, drop) => {
              const lootDrop = drop as Phaser.Physics.Arcade.Sprite;
              const loot = lootDrop.getData("loot") as InventoryItem | null;

              if (!loot) {
                lootDrop.destroy();
                return;
              }

              callbacksRef.current.onLootCollected(loot);
              callbacksRef.current.onLog(createLog(`Looted ${loot.name}.`, "loot"));
              this.lootCollected += 1;
              lootDrop.destroy();
            });

            this.physics.add.overlap(this.player, this.portal, () => {
              if (!this.runResolved && this.portal.visible) {
                this.finishRun("victory", "You breached the relic vault.");
              }
            });

            const keyboard = this.input.keyboard;
            if (!keyboard) {
              throw new Error("Keyboard input could not be initialised.");
            }

            keyboard.addCapture([
              Phaser.Input.Keyboard.KeyCodes.W,
              Phaser.Input.Keyboard.KeyCodes.A,
              Phaser.Input.Keyboard.KeyCodes.S,
              Phaser.Input.Keyboard.KeyCodes.D,
              Phaser.Input.Keyboard.KeyCodes.SPACE,
            ]);
            this.cursors = keyboard.addKeys({
              left: Phaser.Input.Keyboard.KeyCodes.A,
              right: Phaser.Input.Keyboard.KeyCodes.D,
              up: Phaser.Input.Keyboard.KeyCodes.W,
              down: Phaser.Input.Keyboard.KeyCodes.S,
            }) as typeof this.cursors;
            this.attackKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

            callbacksRef.current.onHealthChange(this.currentHealth);
            callbacksRef.current.onLog(
              createLog("Expedition started. Press space to attack.", "neutral"),
            );
            if (bootTimer) {
              clearTimeout(bootTimer);
            }
            setSceneBootState("ready");
          } catch (error) {
            const message = getUiErrorMessage(
              error,
              "Dungeon scene failed to start.",
            );
            setSceneError(message);
            setSceneBootState("error");
            setUseSafeMode(true);
            callbacksRef.current.onLog(createLog(message, "bad"));
          }
        }

        update(time: number) {
          if (this.runResolved) {
            this.getDynamicBody(this.player)?.setAcceleration(0, 0);
            this.player.setVelocity(0, 0);
            this.updateCompanions(new Phaser.Math.Vector2(0, 0));
            this.syncShadows();
            return;
          }

          const moveAcceleration = 760 + callbacksRef.current.stats.speed * 28;
          const velocity = new Phaser.Math.Vector2(0, 0);

          if (this.cursors.left.isDown) velocity.x -= 1;
          if (this.cursors.right.isDown) velocity.x += 1;
          if (this.cursors.up.isDown) velocity.y -= 1;
          if (this.cursors.down.isDown) velocity.y += 1;

          velocity.normalize();
          if (velocity.lengthSq() > 0) {
            this.lastHeading.copy(velocity);
          }
          this.getDynamicBody(this.player)?.setAcceleration(
            velocity.x * moveAcceleration,
            velocity.y * moveAcceleration,
          );

          if (
            Phaser.Input.Keyboard.JustDown(this.attackKey) &&
            time >= this.attackCooldownUntil
          ) {
            this.attackCooldownUntil = time + 450;
            this.playPlayerAnimation("attack", time, 280);
            this.playerAttack();
          }

          if (velocity.x !== 0) {
            this.player.setFlipX(velocity.x < 0);
          }

          this.player.setDepth(getActorDepth(this.player.y, 18));

          if (time >= this.playerAnimLockUntil) {
            const playerPack = PLAYER_PACK[callbacksRef.current.archetype];
            if (velocity.lengthSq() > 0) {
              if (this.player.anims.currentAnim?.key !== `${playerPack}-walk`) {
                this.player.anims.play(`${playerPack}-walk`, true);
              }
            } else if (this.player.anims.currentAnim?.key !== `${playerPack}-idle`) {
              this.player.anims.play(`${playerPack}-idle`, true);
            }
          }

          this.updateCompanions(velocity);

          this.enemyBodies.forEach((enemy) => {
            if (!enemy.alive) {
              enemy.sprite.setVelocity(0, 0);
              return;
            }

            const distance = Phaser.Math.Distance.Between(
              enemy.sprite.x,
              enemy.sprite.y,
              this.player.x,
              this.player.y,
            );

            if (distance < 224) {
              this.physics.moveToObject(
                enemy.sprite,
                this.player,
                20 + enemy.speed * 5,
              );
            } else {
              enemy.sprite.setVelocity(0, 0);
            }

            const enemyBody = this.getDynamicBody(enemy.sprite);

            if (enemyBody?.velocity.x) {
              enemy.sprite.setFlipX(enemyBody.velocity.x < 0);
            }

            if (enemy.renderMode !== "sheet") {
              enemy.facing = getDirectionFromVector(
                enemyBody?.velocity.x ?? 0,
                enemyBody?.velocity.y ?? 0,
                enemy.facing,
              );
              this.updateDirectionalEnemyAppearance(enemy, enemyBody?.speed ?? 0);
            }

            enemy.sprite.setDepth(getActorDepth(enemy.sprite.y, 17));

            if (time >= enemy.animLockUntil) {
              if (enemy.renderMode === "sheet" && enemyBody && enemyBody.speed > 6) {
                if (enemy.sprite.anims.currentAnim?.key !== `${enemy.packKey}-run`) {
                  enemy.sprite.anims.play(`${enemy.packKey}-run`, true);
                }
              } else if (
                enemy.renderMode === "sheet" &&
                enemy.sprite.anims.currentAnim?.key !== `${enemy.packKey}-idle`
              ) {
                enemy.sprite.anims.play(`${enemy.packKey}-idle`, true);
              }
            }

            if (distance < 44 && time >= enemy.nextSwingAt) {
              enemy.nextSwingAt = time + 950;
              this.enemyAttack(enemy, time);
            }
          });

          this.syncShadows();
        }

        private buildArenaFrame(paletteValues: typeof palette, metrics: MapMetrics) {
          const background = this.add.graphics();
          background.fillGradientStyle(
            paletteValues.floor,
            0x101728,
            0x050917,
            paletteValues.bg,
            1,
            1,
            1,
            1,
          );
          background.fillRoundedRect(
            metrics.originX - 28,
            metrics.originY - 24,
            metrics.widthPx + 56,
            metrics.heightPx + 48,
            26,
          );
          background.lineStyle(3, paletteValues.frame, 0.95);
          background.strokeRoundedRect(
            metrics.originX - 28,
            metrics.originY - 24,
            metrics.widthPx + 56,
            metrics.heightPx + 48,
            26,
          );

          const mist = this.add.graphics();
          mist.fillStyle(0x56e5ff, 0.04);
          mist.fillEllipse(metrics.originX + 86, metrics.originY + 72, 180, 90);
          mist.fillStyle(0xb4ff47, 0.04);
          mist.fillEllipse(
            metrics.originX + metrics.widthPx - 96,
            metrics.originY + metrics.heightPx - 74,
            160,
            88,
          );

          const label = this.add.text(metrics.originX + 12, metrics.originY + 10, DUNGEON_NAME, {
            color: "#dbeafe",
            fontFamily: "var(--font-display)",
            fontSize: "18px",
          });
          label.setDepth(30);

          const hint = this.add.text(
            metrics.originX + 12,
            metrics.originY + 34,
            "Clear the room and step through the vault gate.",
            {
              color: "#93a2c9",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
            },
          );
          hint.setDepth(30);
        }

        private renderSceneBackdrop() {
          const haze = this.add.graphics().setDepth(0);
          haze.fillGradientStyle(0x08111f, 0x10192c, 0x040814, 0x040814, 1, 1, 1, 1);
          haze.fillRect(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
          haze.fillStyle(0x22c55e, 0.05);
          haze.fillEllipse(160, 96, 240, 140);
          haze.fillStyle(0x60a5fa, 0.05);
          haze.fillEllipse(SCENE_WIDTH - 180, SCENE_HEIGHT - 110, 260, 160);
        }

        private buildTextures(paletteValues: typeof palette) {
          if (!this.textures.exists("relic-portal")) {
            const painter = this.add.graphics();

            // Exit portal — glowing archway gate
            const portalW = 52;
            const portalH = 60;
            // Outer glow ring
            painter.fillStyle(paletteValues.portalGlow, 0.18);
            painter.fillEllipse(portalW / 2, portalH / 2, portalW + 8, portalH + 8);
            // Inner ellipse
            painter.fillStyle(paletteValues.portal, 0.85);
            painter.fillEllipse(portalW / 2, portalH / 2, portalW - 8, portalH - 8);
            // Centre bright core
            painter.fillStyle(0xfefce8, 0.7);
            painter.fillEllipse(portalW / 2, portalH / 2, 18, 22);
            // Gate frame
            painter.lineStyle(3, paletteValues.portalGlow, 0.92);
            painter.strokeEllipse(portalW / 2, portalH / 2, portalW - 4, portalH - 4);
            painter.generateTexture("relic-portal", portalW, portalH);
            painter.clear();

            // Locked gate placeholder (dimmed)
            painter.fillStyle(0x334155, 0.5);
            painter.fillEllipse(portalW / 2, portalH / 2, portalW - 8, portalH - 8);
            painter.lineStyle(2, 0x475569, 0.6);
            painter.strokeEllipse(portalW / 2, portalH / 2, portalW - 4, portalH - 4);
            painter.generateTexture("relic-portal-locked", portalW, portalH);
            painter.clear();

            painter.fillStyle(paletteValues.drop, 1);
            painter.fillCircle(14, 14, 10);
            painter.lineStyle(2, 0xfdf2f8, 0.9);
            painter.strokeCircle(14, 14, 10);
            painter.generateTexture("relic-drop", 28, 28);
            painter.clear();

            painter.fillStyle(0xffffff, 1);
            painter.fillRect(0, 0, 16, 16);
            painter.generateTexture("relic-collision", 16, 16);
            painter.destroy();
          }
        }

        private createAnimations() {
          for (const packKey of Object.values(PLAYER_PACK)) {
            this.ensureAnimation(`${packKey}-idle`, `${packKey}-idle`, 0, 5, 7, -1);
            this.ensureAnimation(`${packKey}-walk`, `${packKey}-walk`, 0, 7, 10, -1);
            this.ensureAnimation(`${packKey}-attack`, `${packKey}-attack`, 0, 3, 12, 0);
            this.ensureAnimation(`${packKey}-hurt`, `${packKey}-hurt`, 0, 1, 12, 0);
            this.ensureAnimation(`${packKey}-dead`, `${packKey}-dead`, 0, 3, 8, 0);
          }

          for (const packKey of Object.values(ENEMY_PACK)) {
            this.ensureAnimation(`${packKey}-idle`, `${packKey}-idle`, 0, 7, 8, -1);
            this.ensureAnimation(`${packKey}-run`, `${packKey}-run`, 0, 6, 10, -1);
            this.ensureAnimation(`${packKey}-attack`, `${packKey}-attack`, 0, 3, 12, 0);
            this.ensureAnimation(`${packKey}-hurt`, `${packKey}-hurt`, 0, 5, 14, 0);
            this.ensureAnimation(`${packKey}-dead`, `${packKey}-dead`, 0, 2, 8, 0);
          }
        }

        private ensureAnimation(
          key: string,
          textureKey: string,
          start: number,
          end: number,
          frameRate: number,
          repeat: number,
        ) {
          if (this.anims.exists(key)) {
            return;
          }

          const texture = this.textures.get(textureKey);
          const availableFrames = texture
            .getFrameNames()
            .filter((frameName) => frameName !== "__BASE")
            .length;
          const safeEnd = Math.min(end, Math.max(start, availableFrames - 1));

          this.anims.create({
            key,
            frames: this.anims.generateFrameNumbers(textureKey, {
              start,
              end: safeEnd,
            }),
            frameRate,
            repeat,
          });
        }

        private ensureImageSequenceAnimation(
          key: string,
          frames: Array<{ key: string }>,
          frameRate: number,
          repeat: number,
        ) {
          if (this.anims.exists(key)) {
            return;
          }

          this.anims.create({
            key,
            frames,
            frameRate,
            repeat,
          });
        }

        private renderAuthoredDungeonMap(layers: TileLayer[], metrics: MapMetrics) {
          const plate = this.add.graphics().setDepth(2);
          plate.fillStyle(0x08101d, 1);
          plate.fillRoundedRect(metrics.originX, metrics.originY, metrics.widthPx, metrics.heightPx, 18);

          for (const layer of layers) {
            const renderBand = getLayerRenderBand(layer.name);
            const depthBase =
              renderBand === "background" ? 4 : renderBand === "midground" ? 14 : 26;

            for (const chunk of layer.chunks) {
              chunk.gids.forEach((gid, index) => {
                if (!gid) {
                  return;
                }

                const tileset = getTilesetForGid(gid);
                if (!tileset) {
                  return;
                }

                const tileX = chunk.x + (index % chunk.width);
                const tileY = chunk.y + Math.floor(index / chunk.width);
                const localX = tileX - metrics.minX;
                const localY = tileY - metrics.minY;

                if (
                  localX < 0 ||
                  localY < 0 ||
                  localX >= metrics.widthTiles ||
                  localY >= metrics.heightTiles
                ) {
                  return;
                }

                this.add
                  .image(
                    metrics.originX + localX * MAP_TILE_SIZE + MAP_TILE_SIZE / 2,
                    metrics.originY + localY * MAP_TILE_SIZE + MAP_TILE_SIZE / 2,
                    tileset.textureKey,
                    gid - tileset.firstGid,
                  )
                  .setDepth(depthBase + localY * 0.02);
              });
            }
          }

          const border = this.add.graphics().setDepth(28.5);
          border.lineStyle(2, 0xcbd5e1, 0.08);
          border.strokeRoundedRect(metrics.originX, metrics.originY, metrics.widthPx, metrics.heightPx, 18);
        }

        private renderSafeDungeonMap(grid: boolean[][], metrics: MapMetrics) {
          const terrain = this.add.graphics().setDepth(3);
          const cliffEdges = this.add.graphics().setDepth(13);
          const decor = this.add.graphics().setDepth(14);

          terrain.fillStyle(0x0b1322, 1);
          terrain.fillRoundedRect(metrics.originX, metrics.originY, metrics.widthPx, metrics.heightPx, 18);

          for (let y = 0; y < grid.length; y += 1) {
            for (let x = 0; x < (grid[0]?.length ?? 0); x += 1) {
              const tileX = metrics.originX + x * MAP_TILE_SIZE;
              const tileY = metrics.originY + y * MAP_TILE_SIZE;
              const walkable = grid[y][x];

              if (walkable) {
                const tint = (x + y) % 3 === 0 ? 0x858d83 : (x + y) % 3 === 1 ? 0x949b91 : 0x767d74;
                terrain.fillStyle(tint, 1);
                terrain.fillRect(tileX, tileY, MAP_TILE_SIZE, MAP_TILE_SIZE);
                terrain.fillStyle(0xcfc8b2, 0.08);
                terrain.fillRect(tileX + 1, tileY + 1, MAP_TILE_SIZE - 2, MAP_TILE_SIZE - 2);
              } else {
                terrain.fillStyle(0x060b14, 1);
                terrain.fillRect(tileX, tileY, MAP_TILE_SIZE, MAP_TILE_SIZE);
                terrain.fillStyle(0x141c2e, 0.72);
                terrain.fillRect(tileX + 1, tileY + 1, MAP_TILE_SIZE - 2, MAP_TILE_SIZE - 2);

                const hasWalkableNeighbor =
                  (grid[y - 1]?.[x] ?? false) ||
                  (grid[y + 1]?.[x] ?? false) ||
                  (grid[y]?.[x - 1] ?? false) ||
                  (grid[y]?.[x + 1] ?? false);

                if (hasWalkableNeighbor) {
                  cliffEdges.fillStyle(0x1f2937, 0.95);
                  cliffEdges.fillRoundedRect(tileX, tileY, MAP_TILE_SIZE, MAP_TILE_SIZE, 3);
                  cliffEdges.lineStyle(1, 0x475569, 0.45);
                  cliffEdges.strokeRoundedRect(tileX, tileY, MAP_TILE_SIZE, MAP_TILE_SIZE, 3);
                }
              }
            }
          }

          decor.fillStyle(0x96f2d7, 0.26);
          decor.fillCircle(metrics.originX + 104, metrics.originY + 106, 10);
          decor.fillCircle(metrics.originX + metrics.widthPx - 120, metrics.originY + metrics.heightPx - 120, 10);
          decor.fillStyle(0xfca5a5, 0.18);
          decor.fillCircle(metrics.originX + metrics.widthPx - 180, metrics.originY + 86, 8);
          decor.fillCircle(metrics.originX + 174, metrics.originY + metrics.heightPx - 80, 7);

          const frame = this.add.graphics().setDepth(4);
          frame.lineStyle(2, 0xcbd5e1, 0.08);
          frame.strokeRoundedRect(metrics.originX, metrics.originY, metrics.widthPx, metrics.heightPx, 18);
        }

        private buildCollisionBodies(grid: boolean[][], metrics: MapMetrics) {
          const blockers = this.physics.add.staticGroup();
          mergeCollisionGrid(grid).forEach((rect) => {
            const blocker = blockers.create(
              metrics.originX + rect.x * MAP_TILE_SIZE + (rect.width * MAP_TILE_SIZE) / 2,
              metrics.originY + rect.y * MAP_TILE_SIZE + (rect.height * MAP_TILE_SIZE) / 2,
              "relic-collision",
            );
            blocker.setVisible(false);
            blocker.setDisplaySize(
              rect.width * MAP_TILE_SIZE,
              rect.height * MAP_TILE_SIZE,
            );
            blocker.refreshBody();
          });

          return blockers;
        }

        private spawnEnemies(formations: Array<{ x: number; y: number; kind: EnemyType }>) {
          return formations.map((entry) => {
            const directionalPack = DIRECTIONAL_ENEMY_PACK[entry.kind];
            const packKey = directionalPack?.key ?? ENEMY_PACK[entry.kind];
            const renderMode = directionalPack?.mode ?? "sheet";
            const shadow = this.add
              .ellipse(entry.x, entry.y + 22, 30, 12, palette.shadow, 0.38)
              .setDepth(16);
            const initialTexture =
              renderMode === "sheet" ? `${packKey}-idle` : `${packKey}-idle-south`;
            const sprite = this.physics.add.sprite(entry.x, entry.y, initialTexture);
            sprite
              .setDepth(getActorDepth(entry.y, 17))
              .setScale(directionalPack?.scale ?? 0.4)
              .setBounce(0.08);
            if (renderMode === "sheet") {
              sprite.anims.play(`${packKey}-idle`, true);
            }

            const label = this.add.text(
              entry.x,
              entry.y - 34,
              directionalPack?.label ?? ENEMY_THEME[entry.kind].name,
              {
                color: "#e2e8f0",
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
              },
            );
            label.setOrigin(0.5).setDepth(getActorDepth(entry.y, 22));
            const healthBar = this.add.graphics().setDepth(23);

            const maxHealth = ENEMY_THEME[entry.kind].health;

            const enemy: DungeonEnemy = {
              id: createId("enemy"),
              kind: entry.kind,
              packKey,
              renderMode,
              sprite,
              shadow,
              label,
              healthBar,
              health: maxHealth,
              maxHealth,
              attack: ENEMY_THEME[entry.kind].attack,
              defense: ENEMY_THEME[entry.kind].defense,
              speed: ENEMY_THEME[entry.kind].speed,
              nextSwingAt: 0,
              animLockUntil: 0,
              alive: true,
              facing: "south",
            };

            this.updateEnemyHealthBar(enemy);

            return enemy;
          });
        }

        private spawnCompanions(playerX: number, playerY: number) {
          return COMPANION_CAST.map((member, index) => {
            const shadow = this.add
              .ellipse(playerX, playerY + 20, 26, 10, palette.shadow, 0.34)
              .setDepth(16.5);
            const sprite = this.add
              .sprite(
                playerX - 24 - index * 8,
                playerY + 10 + index * 10,
                `${member.packKey}-idle`,
              )
              .setDepth(getActorDepth(playerY + 10 + index * 10, 18))
              .setScale(0.56)
              .setAlpha(0.96);
            sprite.anims.play(`${member.packKey}-idle`, true);

            const label = this.add.text(playerX, playerY - 34, member.name, {
              color: "#cbd5e1",
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
            });
            label.setOrigin(0.5).setDepth(21.5).setAlpha(0.88);

            return {
              id: member.id,
              name: member.name,
              packKey: member.packKey,
              slot: member.slot,
              sprite,
              shadow,
              label,
            };
          });
        }

        private updateCompanions(velocity: Phaser.Math.Vector2) {
          if (this.squadFollowers.length === 0) {
            return;
          }

          const heading = this.lastHeading.clone().normalize();
          const moving = velocity.lengthSq() > 0;
          const trailDistance = moving ? 26 : 20;
          const flankDistance = 18;
          const side = new Phaser.Math.Vector2(-heading.y, heading.x);

          this.squadFollowers.forEach((companion) => {
            const lane = companion.slot === "left" ? -1 : 1;
            const targetX =
              this.player.x - heading.x * trailDistance + side.x * flankDistance * lane;
            const targetY =
              this.player.y - heading.y * trailDistance + side.y * flankDistance * lane + 4;
            companion.sprite.setPosition(
              Phaser.Math.Linear(companion.sprite.x, targetX, moving ? 0.12 : 0.1),
              Phaser.Math.Linear(companion.sprite.y, targetY, moving ? 0.12 : 0.1),
            );
            companion.sprite.setDepth(getActorDepth(companion.sprite.y, 18));
            companion.sprite.setFlipX(this.player.flipX);

            const nextAnimation = moving
              ? `${companion.packKey}-walk`
              : `${companion.packKey}-idle`;
            if (companion.sprite.anims.currentAnim?.key !== nextAnimation) {
              companion.sprite.anims.play(nextAnimation, true);
            }
          });
        }

        private syncShadows() {
          this.playerShadow.setPosition(this.player.x, this.player.y + 21);
          this.playerShadow.setDepth(getShadowDepth(this.player.y, 16));
          this.squadFollowers.forEach((companion) => {
            companion.shadow.setPosition(companion.sprite.x, companion.sprite.y + 19);
            companion.shadow.setDepth(getShadowDepth(companion.sprite.y, 16));
            companion.label.setPosition(companion.sprite.x, companion.sprite.y - 34);
            companion.label.setDepth(getActorDepth(companion.sprite.y, 21));
          });

          this.enemyBodies.forEach((enemy) => {
            enemy.shadow.setPosition(enemy.sprite.x, enemy.sprite.y + 20);
            enemy.shadow.setDepth(getShadowDepth(enemy.sprite.y, 15));
            enemy.label.setPosition(enemy.sprite.x, enemy.sprite.y - 34);
            enemy.label.setDepth(getActorDepth(enemy.sprite.y, 21));
            this.updateEnemyHealthBar(enemy);
          });
        }

        private updateEnemyHealthBar(enemy: DungeonEnemy) {
          enemy.healthBar.clear();

          if (!enemy.alive) {
            return;
          }

          const barX = enemy.sprite.x - 22;
          const barY = enemy.sprite.y - 24;
          const ratio = Phaser.Math.Clamp(enemy.health / enemy.maxHealth, 0, 1);
          const fillColor =
            ratio > 0.55 ? 0x4ade80 : ratio > 0.25 ? 0xfacc15 : 0xf87171;

          enemy.healthBar.fillStyle(0x020617, 0.82);
          enemy.healthBar.setDepth(getActorDepth(enemy.sprite.y, 22));
          enemy.healthBar.fillRoundedRect(barX, barY, 44, 7, 3);
          enemy.healthBar.fillStyle(fillColor, 1);
          enemy.healthBar.fillRoundedRect(barX + 1, barY + 1, 42 * ratio, 5, 2);
          enemy.healthBar.lineStyle(1, 0xffffff, 0.08);
          enemy.healthBar.strokeRoundedRect(barX, barY, 44, 7, 3);
        }

        private updateDirectionalEnemyAppearance(enemy: DungeonEnemy, speed: number) {
          if (enemy.renderMode === "directional-walk") {
            const animationKey =
              speed > 6 ? `${enemy.packKey}-walk-${enemy.facing}` : null;

            if (animationKey && this.anims.exists(animationKey)) {
              if (enemy.sprite.anims.currentAnim?.key !== animationKey) {
                enemy.sprite.anims.play(animationKey, true);
              }
            } else {
              enemy.sprite.anims.stop();
              enemy.sprite.setTexture(`${enemy.packKey}-idle-${enemy.facing}`);
            }
            return;
          }

          enemy.sprite.anims.stop();
          enemy.sprite.setTexture(`${enemy.packKey}-idle-${enemy.facing}`);
        }

        private nudgeDirectionalEnemy(enemy: DungeonEnemy, tint: number) {
          if (enemy.renderMode === "sheet") {
            return;
          }

          enemy.sprite.setTint(tint);
          this.tweens.add({
            targets: enemy.sprite,
            y: enemy.sprite.y - 3,
            duration: 70,
            yoyo: true,
            onComplete: () => enemy.sprite.clearTint(),
          });
        }

        private spawnDamageText(x: number, y: number, text: string, color: string) {
          const damageText = this.add.text(x, y, text, {
            color,
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            stroke: "#020617",
            strokeThickness: 3,
          });
          damageText.setOrigin(0.5).setDepth(28);

          this.tweens.add({
            targets: damageText,
            y: y - 24,
            alpha: 0,
            duration: 520,
            ease: "Cubic.easeOut",
            onComplete: () => damageText.destroy(),
          });
        }

        private playPlayerAnimation(kind: "attack" | "hurt" | "dead", time: number, duration: number) {
          const playerPack = PLAYER_PACK[callbacksRef.current.archetype];
          this.playerAnimLockUntil = Math.max(this.playerAnimLockUntil, time + duration);
          this.player.anims.play(`${playerPack}-${kind}`, true);
        }

        private playerAttack() {
          const livingEnemies = this.enemyBodies.filter((enemy) => enemy.alive);
          if (livingEnemies.length === 0) {
            callbacksRef.current.onLog(
              createLog("No enemies remain. The vault gate hums open.", "good"),
            );
            return;
          }

          const nearest = livingEnemies
            .map((enemy) => ({
              enemy,
              distance: Phaser.Math.Distance.Between(
                enemy.sprite.x,
                enemy.sprite.y,
                this.player.x,
                this.player.y,
              ),
            }))
            .sort((left, right) => left.distance - right.distance)[0];

          if (!nearest || nearest.distance > 76) {
            callbacksRef.current.onLog(
              createLog("Swing missed. Step closer to strike.", "neutral"),
            );
            return;
          }

          const hit = calculateDamage(
            {
              attack: callbacksRef.current.stats.attack,
              critChance: callbacksRef.current.stats.critChance,
            },
            { defense: nearest.enemy.defense },
          );

          nearest.enemy.health -= hit.damage;
          nearest.enemy.animLockUntil = this.time.now + 240;
          if (nearest.enemy.renderMode === "sheet") {
            nearest.enemy.sprite.anims.play(`${nearest.enemy.packKey}-hurt`, true);
          } else {
            this.nudgeDirectionalEnemy(nearest.enemy, 0xfca5a5);
          }
          this.spawnDamageText(
            nearest.enemy.sprite.x,
            nearest.enemy.sprite.y - 42,
            `${hit.damage}${hit.crit ? "!" : ""}`,
            hit.crit ? "#fde047" : "#f8fafc",
          );
          this.updateEnemyHealthBar(nearest.enemy);

          callbacksRef.current.onLog(
            createLog(
              `You hit ${ENEMY_THEME[nearest.enemy.kind].name} for ${hit.damage}${
                hit.crit ? " crit" : ""
              }.`,
              hit.crit ? "good" : "neutral",
            ),
          );

          if (nearest.enemy.health <= 0) {
            this.killEnemy(nearest.enemy);
          }
        }

        private enemyAttack(enemy: DungeonEnemy, time: number) {
          enemy.animLockUntil = time + 260;
          if (enemy.renderMode === "sheet") {
            enemy.sprite.anims.play(`${enemy.packKey}-attack`, true);
          } else {
            this.nudgeDirectionalEnemy(enemy, 0xfcd34d);
          }

          const hit = calculateDamage(
            {
              attack: enemy.attack,
              critChance: enemy.kind === "wisp" ? 0.16 : 0.06,
            },
            { defense: callbacksRef.current.stats.defense },
          );

          this.currentHealth = Math.max(0, this.currentHealth - hit.damage);
          callbacksRef.current.onHealthChange(this.currentHealth);
          this.playPlayerAnimation("hurt", time, 240);
          this.spawnDamageText(
            this.player.x,
            this.player.y - 48,
            `${hit.damage}${hit.crit ? "!" : ""}`,
            hit.crit ? "#fb7185" : "#fecdd3",
          );
          callbacksRef.current.onLog(
            createLog(
              `${ENEMY_THEME[enemy.kind].name} hits you for ${hit.damage}${
                hit.crit ? " crit" : ""
              }.`,
              "bad",
            ),
          );

          this.cameras.main.shake(120, 0.004);

          if (this.currentHealth <= 0) {
            this.finishRun("defeat", "The catacomb claims another greedy hand.");
          }
        }

        private killEnemy(enemy: DungeonEnemy) {
          enemy.alive = false;
          enemy.animLockUntil = this.time.now + 500;
          enemy.sprite.setVelocity(0, 0);
          this.getDynamicBody(enemy.sprite)?.stop();
          if (this.getDynamicBody(enemy.sprite)) {
            this.getDynamicBody(enemy.sprite)!.enable = false;
          }
          if (enemy.renderMode === "sheet") {
            enemy.sprite.anims.play(`${enemy.packKey}-dead`, true);
          } else {
            enemy.sprite.anims.stop();
            enemy.sprite.setTint(0x1f2937);
            this.tweens.add({
              targets: enemy.sprite,
              angle: enemy.sprite.angle + 10,
              alpha: 0.42,
              y: enemy.sprite.y + 8,
              duration: 380,
              ease: "Quad.easeOut",
            });
          }
          enemy.label.destroy();
          enemy.healthBar.destroy();
          this.enemiesDefeated += 1;

          callbacksRef.current.onLog(
            createLog(`Defeated ${ENEMY_THEME[enemy.kind].name}.`, "good"),
          );

          const loot = callbacksRef.current.resolveLoot({
            enemyType: enemy.kind,
            luck: callbacksRef.current.stats.luck,
          });

          if (loot) {
            const drop = this.lootGroup.create(enemy.sprite.x, enemy.sprite.y + 8, "relic-drop");
            drop.setData("loot", loot);
            drop.setDepth(21);
            drop.setTint(
              Phaser.Display.Color.HexStringToColor(rarityColor(loot.rarity)).color,
            );
            this.tweens.add({
              targets: drop,
              y: drop.y - 10,
              duration: 420,
              yoyo: true,
              repeat: -1,
            });
          }

          this.time.delayedCall(520, () => {
            enemy.shadow.setVisible(false);
            enemy.sprite.setAlpha(0.42);
          });

          if (this.enemyBodies.every((entry) => !entry.alive)) {
            // Swap locked texture for the glowing portal
            this.portal.setTexture("relic-portal");
            this.portal.setAlpha(1);
            if (this.getDynamicBody(this.portal)) {
              this.getDynamicBody(this.portal)!.enable = true;
            }

            // Update the label
            const portalLabel = this.portal.getData("label") as Phaser.GameObjects.Text | null;
            if (portalLabel) {
              portalLabel.setText("✦ EXIT");
              portalLabel.setColor("#fde68a");
            }

            callbacksRef.current.onLog(
              createLog("The vault gate opens! Step into the portal to escape.", "good"),
            );

            // Pulsing glow animation
            this.tweens.add({
              targets: this.portal,
              scale: { from: 1, to: 1.22 },
              alpha: { from: 1, to: 0.82 },
              duration: 800,
              yoyo: true,
              repeat: -1,
              ease: "Sine.easeInOut",
            });
          }
        }

        private finishRun(outcome: DungeonRunSummary["outcome"], notes: string) {
          if (this.runResolved) {
            return;
          }

          this.runResolved = true;

          if (outcome === "defeat") {
            this.playPlayerAnimation("dead", this.time.now, 420);
          } else {
            this.player.setTint(0xfacc15);
          }

          callbacksRef.current.onRunComplete({
            id: callbacksRef.current.runId,
            roomName: DUNGEON_NAME,
            enemiesDefeated: this.enemiesDefeated,
            lootCollected: this.lootCollected,
            outcome,
            startedAt: this.startedAt,
            endedAt: new Date().toISOString(),
            notes,
          });
        }
      }

        gameRef.current?.destroy(true);
        gameRef.current = new Phaser.Game({
          type: Phaser.AUTO,
          width: SCENE_WIDTH,
          height: SCENE_HEIGHT,
          parent: containerRef.current,
          backgroundColor: "#050816",
          pixelArt: true,
          antialias: false,
          physics: {
            default: "arcade",
            arcade: {
              gravity: { y: 0, x: 0 },
              debug: false,
            },
          },
          scene: DungeonScene,
        });
      })
      .catch((error) => {
        const message = getUiErrorMessage(error, "Phaser failed to load.");
        setSceneError(message);
        setSceneBootState("error");
        setUseSafeMode(true);
      });

    return () => {
      disposed = true;
      if (bootTimer) {
        clearTimeout(bootTimer);
      }
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [
    props.active,
    props.archetype,
    props.runId,
    props.stats.attack,
    props.stats.critChance,
    props.stats.defense,
    props.stats.health,
    props.stats.luck,
    props.stats.speed,
  ]);

  if (useSafeMode) {
    return <FallbackDungeon {...props} />;
  }

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#050816]/80 shadow-[0_0_90px_rgba(86,229,255,0.08)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3">
        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-200">
          Asset Dungeon
        </span>
        <span className="rounded-full border border-lime-400/20 bg-lime-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-lime-200">
          WASD + Space
        </span>
      </div>
      {sceneBootState !== "ready" ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#050816]/70">
          <div className="rounded-3xl border border-white/10 bg-black/40 px-5 py-4 text-center text-sm text-slate-200 backdrop-blur">
            {sceneBootState === "booting"
              ? "Booting the dungeon scene..."
              : `Scene failed: ${sceneError ?? "unknown error"}`}
          </div>
        </div>
      ) : null}
      <div ref={containerRef} className="aspect-[5/3] w-full min-h-[420px]" />
    </div>
  );
}
