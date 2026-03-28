"use client";

import { useEffect, useRef } from "react";
import { DUNGEON_NAME, ENEMY_THEME } from "@/src/game/content";
import {
  calculateDamage,
  createId,
  createLog,
  rarityColor,
} from "@/src/game/helpers";
import type {
  Archetype,
  CombatLogEntry,
  DungeonRunSummary,
  EnemyType,
  InventoryItem,
  LootRollContext,
  StatBlock,
} from "@/src/game/types";

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

type TileChunk = {
  x: number;
  y: number;
  width: number;
  height: number;
  gids: number[];
};

type TileLayer = {
  name: string;
  chunks: TileChunk[];
};

type CollisionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TilePoint = {
  x: number;
  y: number;
};

type MapMetrics = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  widthTiles: number;
  heightTiles: number;
  widthPx: number;
  heightPx: number;
  originX: number;
  originY: number;
};

type EncounterLayout = {
  player: { x: number; y: number };
  portal: { x: number; y: number };
  enemies: Array<{ x: number; y: number; kind: EnemyType }>;
};

type PlacementTarget = {
  targetX: number;
  targetY: number;
  minimumOrthogonalNeighbors: number;
  minimumNearbyWalkableTiles: number;
};

type DungeonEnemy = {
  id: string;
  kind: EnemyType;
  packKey: string;
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
};

const SCENE_WIDTH = 960;
const SCENE_HEIGHT = 576;
const MAP_TILE_SIZE = 16;

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

const COLLISION_LAYERS = new Set([
  "elevated_space",
  "elevated_space2",
  "water",
  "water_detailization",
  "water_coasts",
]);

const WALKABLE_LAYERS = new Set([
  "ground",
  "darker_surface1",
  "darker_surface2",
  "bridge",
  "bricks",
  "bricks2",
  "bricks3",
  "stairs",
]);

/**
 * Layers rendered ABOVE the player sprite (depth 25) for pseudo-3D depth.
 * The character walks "behind" these objects.
 */
const OVERLAY_LAYERS = new Set([
  "Objects",
  "Objects2",
  "Objects3",
  "Objects4",
  "Objects5",
  "Objects_under_elevated_space",
  "elevated_space",
  "elevated_space2",
]);

/** All layers considered for map bounding-box calculation. */
const MAP_BOUND_LAYERS = new Set([
  "water",
  "water_detailization",
  "water_coasts",
  "ground",
  "darker_surface1",
  "darker_surface2",
  "bridge",
  "bricks",
  "bricks2",
  "bricks3",
  "stairs",
  "elevated_space",
  "elevated_space2",
  "Objects_under_elevated_space",
  "Objects",
  "Objects2",
  "Objects3",
  "Objects4",
  "Objects5",
  "details1",
  "detail2",
  "details3",
]);

const TILESET_RANGES = [
  { firstGid: 1, lastGid: 2262, textureKey: "tiles-ground" },
  { firstGid: 2263, lastGid: 5148, textureKey: "tiles-water-v2" },
  { firstGid: 5149, lastGid: 8034, textureKey: "tiles-water-v1" },
  { firstGid: 8035, lastGid: 9437, textureKey: "tiles-water-coasts" },
  { firstGid: 9438, lastGid: 13037, textureKey: "tiles-objects" },
  { firstGid: 13038, lastGid: 14753, textureKey: "tiles-objects-animated-1" },
  { firstGid: 14754, lastGid: 16469, textureKey: "tiles-objects-animated-2" },
  { firstGid: 16470, lastGid: 18185, textureKey: "tiles-objects-animated-3" },
  { firstGid: 18186, lastGid: 18745, textureKey: "tiles-details" },
  { firstGid: 18746, lastGid: 19305, textureKey: "tiles-details" },
] as const;

const PLAYER_SHEET_CONFIG = { frameWidth: 96, frameHeight: 96 };
const ENEMY_SHEET_CONFIG = { frameWidth: 128, frameHeight: 128 };

export function PhaserDungeon(props: PhaserDungeonProps) {
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

    void import("phaser").then((phaserModule) => {
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
          this.cameras.main.setBackgroundColor(palette.bg);
          this.buildTextures(palette);
          this.createAnimations();
          const mapLayers = this.parseMapLayers();
          this.mapMetrics = this.buildMapMetrics(mapLayers);
          this.walkableGrid = this.buildWalkableGrid(mapLayers, this.mapMetrics);
          this.physics.world.setBounds(
            this.mapMetrics.originX,
            this.mapMetrics.originY,
            this.mapMetrics.widthPx,
            this.mapMetrics.heightPx,
          );
          this.buildArenaFrame(palette, this.mapMetrics);
          this.renderDungeonMap(mapLayers, this.mapMetrics);
          this.blockers = this.buildCollisionBodies(this.walkableGrid, this.mapMetrics);
          const encounterLayout = this.resolveEncounterLayout(
            this.walkableGrid,
            this.mapMetrics,
          );

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
          playerBody?.setDrag(1100, 1100);
          playerBody?.setMaxVelocity(
            74 + callbacksRef.current.stats.speed * 3,
            74 + callbacksRef.current.stats.speed * 3,
          );
          this.player.anims.play(`${playerPack}-idle`, true);
          this.physics.add.collider(this.player, this.blockers);
          this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
          this.cameras.main.setZoom(1.02);

          // Locked gate frame — visible from the start but dimmed
          this.portal = this.physics.add.sprite(
            encounterLayout.portal.x,
            encounterLayout.portal.y,
            "relic-portal-locked",
          );
          this.portal.setDepth(15).setAlpha(0.7);
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
          portalLabel.setOrigin(0.5).setDepth(22);
          // Store the label so we can update it when unlocked
          this.portal.setData("label", portalLabel);

          this.enemyBodies = this.spawnEnemies(encounterLayout.enemies);
          this.enemyBodies.forEach((enemy) => {
            const enemyBody = this.getDynamicBody(enemy.sprite);
            enemyBody?.setSize(18, 16);
            enemyBody?.setOffset(55, 88);
            enemyBody?.setMaxVelocity(
              44 + enemy.speed * 4,
              44 + enemy.speed * 4,
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
            return;
          }

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
        }

        update(time: number) {
          this.syncShadows();

          if (this.runResolved) {
            this.getDynamicBody(this.player)?.setAcceleration(0, 0);
            this.player.setVelocity(0, 0);
            return;
          }

          const moveAcceleration = 760 + callbacksRef.current.stats.speed * 28;
          const velocity = new Phaser.Math.Vector2(0, 0);

          if (this.cursors.left.isDown) velocity.x -= 1;
          if (this.cursors.right.isDown) velocity.x += 1;
          if (this.cursors.up.isDown) velocity.y -= 1;
          if (this.cursors.down.isDown) velocity.y += 1;

          velocity.normalize();
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

            if (time >= enemy.animLockUntil) {
              if (enemyBody && enemyBody.speed > 6) {
                if (enemy.sprite.anims.currentAnim?.key !== `${enemy.packKey}-run`) {
                  enemy.sprite.anims.play(`${enemy.packKey}-run`, true);
                }
              } else if (
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

        private buildMapMetrics(layers: TileLayer[]) {
          let minX = Number.POSITIVE_INFINITY;
          let minY = Number.POSITIVE_INFINITY;
          let maxX = Number.NEGATIVE_INFINITY;
          let maxY = Number.NEGATIVE_INFINITY;

          layers
            .filter((layer) => MAP_BOUND_LAYERS.has(layer.name))
            .forEach((layer) => {
              layer.chunks.forEach((chunk) => {
                chunk.gids.forEach((gid, index) => {
                  if (!gid) {
                    return;
                  }

                  const tileX = chunk.x + (index % chunk.width);
                  const tileY = chunk.y + Math.floor(index / chunk.width);
                  minX = Math.min(minX, tileX);
                  minY = Math.min(minY, tileY);
                  maxX = Math.max(maxX, tileX);
                  maxY = Math.max(maxY, tileY);
                });
              });
            });

          if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
            minX = 0;
            minY = 0;
            maxX = 37;
            maxY = 24;
          }

          const widthTiles = maxX - minX + 1;
          const heightTiles = maxY - minY + 1;
          const widthPx = widthTiles * MAP_TILE_SIZE;
          const heightPx = heightTiles * MAP_TILE_SIZE;

          return {
            minX,
            minY,
            maxX,
            maxY,
            widthTiles,
            heightTiles,
            widthPx,
            heightPx,
            originX: Math.floor((SCENE_WIDTH - widthPx) / 2),
            originY: Math.max(8, Math.floor((SCENE_HEIGHT - heightPx) / 2)),
          };
        }

        private buildWalkableGrid(layers: TileLayer[], metrics: MapMetrics) {
          const grid = Array.from({ length: metrics.heightTiles }, () =>
            Array.from({ length: metrics.widthTiles }, () => false),
          );

          // Pass 1: mark walkable floors
          // Pass 2: mark collision layers as impassable (overrides walkable)
          for (const layer of layers) {
            const isWalkable = WALKABLE_LAYERS.has(layer.name);
            const isBlocked = COLLISION_LAYERS.has(layer.name);

            if (!isWalkable && !isBlocked) {
              continue;
            }

            for (const chunk of layer.chunks) {
              chunk.gids.forEach((gid, index) => {
                if (!gid) {
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

                if (isWalkable) {
                  grid[localY][localX] = true;
                }
                if (isBlocked) {
                  grid[localY][localX] = false;
                }
              });
            }
          }

          return grid;
        }

        private getLargestWalkableRegion(grid: boolean[][]) {
          const visited = Array.from({ length: grid.length }, () =>
            Array.from({ length: grid[0]?.length ?? 0 }, () => false),
          );
          let largest: TilePoint[] = [];

          for (let y = 0; y < grid.length; y += 1) {
            for (let x = 0; x < (grid[0]?.length ?? 0); x += 1) {
              if (!grid[y][x] || visited[y][x]) {
                continue;
              }

              const stack: TilePoint[] = [{ x, y }];
              const region: TilePoint[] = [];
              visited[y][x] = true;

              while (stack.length > 0) {
                const current = stack.pop()!;
                region.push(current);

                for (const [dx, dy] of [
                  [1, 0],
                  [-1, 0],
                  [0, 1],
                  [0, -1],
                ] as const) {
                  const nextX = current.x + dx;
                  const nextY = current.y + dy;

                  if (
                    nextX < 0 ||
                    nextY < 0 ||
                    nextY >= grid.length ||
                    nextX >= (grid[0]?.length ?? 0) ||
                    !grid[nextY][nextX] ||
                    visited[nextY][nextX]
                  ) {
                    continue;
                  }

                  visited[nextY][nextX] = true;
                  stack.push({ x: nextX, y: nextY });
                }
              }

              if (region.length > largest.length) {
                largest = region;
              }
            }
          }

          return largest;
        }

        private renderDungeonMap(layers: TileLayer[], metrics: MapMetrics) {
          // Base layer (depth 3) — floor, water, bricks, details — BELOW the player
          const baseTex = this.add
            .renderTexture(metrics.originX, metrics.originY, metrics.widthPx, metrics.heightPx)
            .setOrigin(0)
            .setDepth(3);
          baseTex.fill(0x0a1322, 1);

          // Object overlay (depth 25) — temples, trees, walls — ABOVE the player
          const overlayTex = this.add
            .renderTexture(metrics.originX, metrics.originY, metrics.widthPx, metrics.heightPx)
            .setOrigin(0)
            .setDepth(25);

          for (const layer of layers) {
            const isOverlay = OVERLAY_LAYERS.has(layer.name);
            const target = isOverlay ? overlayTex : baseTex;

            for (const chunk of layer.chunks) {
              chunk.gids.forEach((gid, index) => {
                if (!gid) {
                  return;
                }

                const tileset = TILESET_RANGES.find(
                  (entry) => gid >= entry.firstGid && gid <= entry.lastGid,
                );
                if (!tileset) {
                  return;
                }

                const frame = gid - tileset.firstGid;
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

                target.drawFrame(
                  tileset.textureKey,
                  frame,
                  localX * MAP_TILE_SIZE,
                  localY * MAP_TILE_SIZE,
                );
              });
            }
          }

          const frame = this.add.graphics();
          frame.lineStyle(2, 0xcbd5e1, 0.08);
          frame.strokeRoundedRect(
            metrics.originX,
            metrics.originY,
            metrics.widthPx,
            metrics.heightPx,
            18,
          );
          frame.setDepth(4);
        }

        private buildCollisionBodies(grid: boolean[][], metrics: MapMetrics) {
          const blockers = this.physics.add.staticGroup();
          this.mergeCollisionGrid(grid).forEach((rect) => {
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

        private mergeCollisionGrid(grid: boolean[][]) {
          const visited = Array.from({ length: grid.length }, () =>
            Array.from({ length: grid[0]?.length ?? 0 }, () => false),
          );
          const rectangles: CollisionRect[] = [];

          for (let y = 0; y < grid.length; y += 1) {
            for (let x = 0; x < (grid[0]?.length ?? 0); x += 1) {
              if (grid[y][x] || visited[y][x]) {
                continue;
              }

              let width = 1;
              while (
                x + width < (grid[0]?.length ?? 0) &&
                !grid[y][x + width] &&
                !visited[y][x + width]
              ) {
                width += 1;
              }

              let height = 1;
              let canGrow = true;
              while (y + height < grid.length && canGrow) {
                for (let offsetX = 0; offsetX < width; offsetX += 1) {
                  if (grid[y + height][x + offsetX] || visited[y + height][x + offsetX]) {
                    canGrow = false;
                    break;
                  }
                }
                if (canGrow) {
                  height += 1;
                }
              }

              for (let fillY = y; fillY < y + height; fillY += 1) {
                for (let fillX = x; fillX < x + width; fillX += 1) {
                  visited[fillY][fillX] = true;
                }
              }

              rectangles.push({ x, y, width, height });
            }
          }

          return rectangles;
        }

        private parseMapLayers() {
          const mapRaw = this.cache.text.get("relic-rush-tmx") as string | undefined;
          if (!mapRaw) {
            return [] as TileLayer[];
          }

          const parser = new DOMParser();
          const documentRoot = parser.parseFromString(mapRaw, "application/xml");

          return Array.from(documentRoot.getElementsByTagName("layer")).map((layer) => {
            const dataNode = layer.getElementsByTagName("data")[0];
            const chunkNodes = Array.from(layer.getElementsByTagName("chunk"));

            const chunks =
              chunkNodes.length > 0
                ? chunkNodes.map((chunk) => ({
                    x: Number.parseInt(chunk.getAttribute("x") ?? "0", 10),
                    y: Number.parseInt(chunk.getAttribute("y") ?? "0", 10),
                    width: Number.parseInt(chunk.getAttribute("width") ?? "0", 10),
                    height: Number.parseInt(chunk.getAttribute("height") ?? "0", 10),
                    gids: (chunk.textContent ?? "")
                      .split(",")
                      .map((value) => Number.parseInt(value.trim(), 10))
                      .filter((value) => Number.isFinite(value)),
                  }))
                : [
                    {
                      x: 0,
                      y: 0,
                      width: Number.parseInt(layer.getAttribute("width") ?? "0", 10),
                      height: Number.parseInt(layer.getAttribute("height") ?? "0", 10),
                      gids: (dataNode?.textContent ?? "")
                        .split(",")
                        .map((value) => Number.parseInt(value.trim(), 10))
                        .filter((value) => Number.isFinite(value)),
                    },
                  ];

            return {
              name: layer.getAttribute("name") ?? "layer",
              chunks,
            };
          });
        }

        private toWorldPoint(tile: TilePoint, metrics: MapMetrics) {
          return {
            x: metrics.originX + tile.x * MAP_TILE_SIZE + MAP_TILE_SIZE / 2,
            y: metrics.originY + tile.y * MAP_TILE_SIZE + MAP_TILE_SIZE / 2,
          };
        }

        private findNearestWalkableTile(
          points: TilePoint[],
          targetX: number,
          targetY: number,
        ) {
          let best: TilePoint | null = null;
          let bestDistance = Number.POSITIVE_INFINITY;

          for (const point of points) {
            const distance = Math.abs(point.x - targetX) + Math.abs(point.y - targetY);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = point;
            }
          }

          return best ?? { x: Math.max(0, targetX), y: Math.max(0, targetY) };
        }

        private countOrthogonalWalkableNeighbors(
          grid: boolean[][],
          point: TilePoint,
        ) {
          let count = 0;

          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const nextX = point.x + dx;
            const nextY = point.y + dy;

            if (
              nextX >= 0 &&
              nextY >= 0 &&
              nextY < grid.length &&
              nextX < (grid[0]?.length ?? 0) &&
              grid[nextY][nextX]
            ) {
              count += 1;
            }
          }

          return count;
        }

        private countNearbyWalkableTiles(
          grid: boolean[][],
          point: TilePoint,
          radius: number,
        ) {
          let count = 0;

          for (let y = point.y - radius; y <= point.y + radius; y += 1) {
            for (let x = point.x - radius; x <= point.x + radius; x += 1) {
              if (
                x >= 0 &&
                y >= 0 &&
                y < grid.length &&
                x < (grid[0]?.length ?? 0) &&
                grid[y][x]
              ) {
                count += 1;
              }
            }
          }

          return count;
        }

        private findBestPlacementTile(
          points: TilePoint[],
          grid: boolean[][],
          config: PlacementTarget,
        ) {
          const candidates = points
            .map((point) => ({
              point,
              orthogonalNeighbors: this.countOrthogonalWalkableNeighbors(grid, point),
              nearbyWalkableTiles: this.countNearbyWalkableTiles(grid, point, 1),
            }))
            .filter(
              (candidate) =>
                candidate.orthogonalNeighbors >= config.minimumOrthogonalNeighbors &&
                candidate.nearbyWalkableTiles >= config.minimumNearbyWalkableTiles,
            )
            .sort((left, right) => {
              const leftDistance =
                Math.abs(left.point.x - config.targetX) +
                Math.abs(left.point.y - config.targetY);
              const rightDistance =
                Math.abs(right.point.x - config.targetX) +
                Math.abs(right.point.y - config.targetY);

              if (leftDistance !== rightDistance) {
                return leftDistance - rightDistance;
              }

              if (left.nearbyWalkableTiles !== right.nearbyWalkableTiles) {
                return right.nearbyWalkableTiles - left.nearbyWalkableTiles;
              }

              return right.orthogonalNeighbors - left.orthogonalNeighbors;
            });

          if (candidates.length > 0) {
            return candidates[0].point;
          }

          return this.findNearestWalkableTile(
            points,
            config.targetX,
            config.targetY,
          );
        }

        private resolveEncounterLayout(grid: boolean[][], metrics: MapMetrics) {
          const width = grid[0]?.length ?? 0;
          const height = grid.length;
          const mainRegion = this.getLargestWalkableRegion(grid);

          const playerTile = this.findBestPlacementTile(mainRegion, grid, {
            targetX: Math.floor(width * 0.18),
            targetY: Math.floor(height * 0.84),
            minimumOrthogonalNeighbors: 3,
            minimumNearbyWalkableTiles: 6,
          });
          const portalTile = this.findBestPlacementTile(mainRegion, grid, {
            targetX: Math.floor(width * 0.82),
            targetY: Math.floor(height * 0.16),
            minimumOrthogonalNeighbors: 2,
            minimumNearbyWalkableTiles: 5,
          });
          const enemyTiles: Array<{ kind: EnemyType; tile: TilePoint }> = [
            {
              kind: "slime",
              tile: this.findBestPlacementTile(mainRegion, grid, {
                targetX: Math.floor(width * 0.24),
                targetY: Math.floor(height * 0.28),
                minimumOrthogonalNeighbors: 2,
                minimumNearbyWalkableTiles: 4,
              }),
            },
            {
              kind: "skeleton",
              tile: this.findBestPlacementTile(mainRegion, grid, {
                targetX: Math.floor(width * 0.72),
                targetY: Math.floor(height * 0.33),
                minimumOrthogonalNeighbors: 2,
                minimumNearbyWalkableTiles: 4,
              }),
            },
            {
              kind: "wisp",
              tile: this.findBestPlacementTile(mainRegion, grid, {
                targetX: Math.floor(width * 0.78),
                targetY: Math.floor(height * 0.76),
                minimumOrthogonalNeighbors: 2,
                minimumNearbyWalkableTiles: 4,
              }),
            },
          ];

          const filteredEnemyTiles = enemyTiles.filter((entry) => {
            const distanceToPlayer =
              Math.abs(entry.tile.x - playerTile.x) + Math.abs(entry.tile.y - playerTile.y);
            const distanceToPortal =
              Math.abs(entry.tile.x - portalTile.x) + Math.abs(entry.tile.y - portalTile.y);

            return distanceToPlayer >= 4 && distanceToPortal >= 4;
          });

          const finalEnemyTiles =
            filteredEnemyTiles.length > 0 ? filteredEnemyTiles : enemyTiles;

          return {
            player: this.toWorldPoint(playerTile, metrics),
            portal: this.toWorldPoint(portalTile, metrics),
            enemies: finalEnemyTiles.map((entry) => ({
              kind: entry.kind,
              ...this.toWorldPoint(entry.tile, metrics),
            })),
          };
        }

        private spawnEnemies(formations: Array<{ x: number; y: number; kind: EnemyType }>) {
          return formations.map((entry) => {
            const packKey = ENEMY_PACK[entry.kind];
            const shadow = this.add
              .ellipse(entry.x, entry.y + 22, 30, 12, palette.shadow, 0.38)
              .setDepth(16);
            const sprite = this.physics.add.sprite(entry.x, entry.y, `${packKey}-idle`);
            sprite.setDepth(18).setScale(0.4).setBounce(0.08);
            sprite.anims.play(`${packKey}-idle`, true);

            const label = this.add.text(entry.x - 32, entry.y - 34, ENEMY_THEME[entry.kind].name, {
              color: "#e2e8f0",
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
            });
            label.setDepth(22);
            const healthBar = this.add.graphics().setDepth(23);

            const maxHealth = ENEMY_THEME[entry.kind].health;

            const enemy: DungeonEnemy = {
              id: createId("enemy"),
              kind: entry.kind,
              packKey,
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
            };

            this.updateEnemyHealthBar(enemy);

            return enemy;
          });
        }

        private syncShadows() {
          this.playerShadow.setPosition(this.player.x, this.player.y + 21);

          this.enemyBodies.forEach((enemy) => {
            enemy.shadow.setPosition(enemy.sprite.x, enemy.sprite.y + 20);
            enemy.label.setPosition(enemy.sprite.x - 32, enemy.sprite.y - 34);
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
          enemy.healthBar.fillRoundedRect(barX, barY, 44, 7, 3);
          enemy.healthBar.fillStyle(fillColor, 1);
          enemy.healthBar.fillRoundedRect(barX + 1, barY + 1, 42 * ratio, 5, 2);
          enemy.healthBar.lineStyle(1, 0xffffff, 0.08);
          enemy.healthBar.strokeRoundedRect(barX, barY, 44, 7, 3);
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
          nearest.enemy.sprite.anims.play(`${nearest.enemy.packKey}-hurt`, true);
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
          enemy.sprite.anims.play(`${enemy.packKey}-attack`, true);

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
          enemy.sprite.anims.play(`${enemy.packKey}-dead`, true);
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
    });

    return () => {
      disposed = true;
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
      <div ref={containerRef} className="aspect-[5/3] w-full min-h-[420px]" />
    </div>
  );
}
