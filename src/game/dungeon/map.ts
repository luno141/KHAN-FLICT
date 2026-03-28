import type { EnemyType } from "@/src/game/types";

export type TileChunk = {
  x: number;
  y: number;
  width: number;
  height: number;
  gids: number[];
};

export type TileLayer = {
  name: string;
  chunks: TileChunk[];
};

export type CollisionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TilePoint = {
  x: number;
  y: number;
};

export type MapMetrics = {
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

export type EncounterLayout = {
  player: { x: number; y: number };
  portal: { x: number; y: number };
  enemies: Array<{ x: number; y: number; kind: EnemyType }>;
};

export type AuthoredDungeon = {
  metrics: MapMetrics;
  walkableGrid: boolean[][];
  encounterLayout: EncounterLayout;
};

type PlacementTarget = {
  targetX: number;
  targetY: number;
  minimumOrthogonalNeighbors: number;
  minimumNearbyWalkableTiles: number;
};

export const MAP_TILE_SIZE = 16;

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

const MIDGROUND_LAYERS = new Set([
  "Objects_under_elevated_space",
  "details3",
]);

export const TILESET_RANGES = [
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

export function isOverlayLayer(layerName: string) {
  return OVERLAY_LAYERS.has(layerName);
}

export function getLayerRenderBand(layerName: string) {
  if (MIDGROUND_LAYERS.has(layerName)) {
    return "midground" as const;
  }

  if (OVERLAY_LAYERS.has(layerName)) {
    return "foreground" as const;
  }

  return "background" as const;
}

export function getTilesetForGid(gid: number) {
  return TILESET_RANGES.find(
    (entry) => gid >= entry.firstGid && gid <= entry.lastGid,
  );
}

export function parseMapLayers(mapRaw: string | undefined) {
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

export function buildMapMetrics(
  layers: TileLayer[],
  sceneWidth: number,
  sceneHeight: number,
) {
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
    originX: Math.floor((sceneWidth - widthPx) / 2),
    originY: Math.max(8, Math.floor((sceneHeight - heightPx) / 2)),
  };
}

export function buildWalkableGrid(layers: TileLayer[], metrics: MapMetrics) {
  const grid = Array.from({ length: metrics.heightTiles }, () =>
    Array.from({ length: metrics.widthTiles }, () => false),
  );

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

export function mergeCollisionGrid(grid: boolean[][]) {
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

export function toWorldPoint(tile: TilePoint, metrics: MapMetrics) {
  return {
    x: metrics.originX + tile.x * MAP_TILE_SIZE + MAP_TILE_SIZE / 2,
    y: metrics.originY + tile.y * MAP_TILE_SIZE + MAP_TILE_SIZE / 2,
  };
}

function getLargestWalkableRegion(grid: boolean[][]) {
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

function findNearestWalkableTile(
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

function countOrthogonalWalkableNeighbors(
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

function countNearbyWalkableTiles(
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

function findBestPlacementTile(
  points: TilePoint[],
  grid: boolean[][],
  config: PlacementTarget,
) {
  const candidates = points
    .map((point) => ({
      point,
      orthogonalNeighbors: countOrthogonalWalkableNeighbors(grid, point),
      nearbyWalkableTiles: countNearbyWalkableTiles(grid, point, 1),
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

  return findNearestWalkableTile(
    points,
    config.targetX,
    config.targetY,
  );
}

export function resolveEncounterLayout(
  grid: boolean[][],
  metrics: MapMetrics,
): EncounterLayout {
  const width = grid[0]?.length ?? 0;
  const height = grid.length;
  const mainRegion = getLargestWalkableRegion(grid);

  const playerTile = findBestPlacementTile(mainRegion, grid, {
    targetX: Math.floor(width * 0.18),
    targetY: Math.floor(height * 0.84),
    minimumOrthogonalNeighbors: 3,
    minimumNearbyWalkableTiles: 6,
  });
  const portalTile = findBestPlacementTile(mainRegion, grid, {
    targetX: Math.floor(width * 0.82),
    targetY: Math.floor(height * 0.16),
    minimumOrthogonalNeighbors: 2,
    minimumNearbyWalkableTiles: 5,
  });
  const enemyTiles: Array<{ kind: EnemyType; tile: TilePoint }> = [
    {
      kind: "slime",
      tile: findBestPlacementTile(mainRegion, grid, {
        targetX: Math.floor(width * 0.24),
        targetY: Math.floor(height * 0.28),
        minimumOrthogonalNeighbors: 2,
        minimumNearbyWalkableTiles: 4,
      }),
    },
    {
      kind: "skeleton",
      tile: findBestPlacementTile(mainRegion, grid, {
        targetX: Math.floor(width * 0.72),
        targetY: Math.floor(height * 0.33),
        minimumOrthogonalNeighbors: 2,
        minimumNearbyWalkableTiles: 4,
      }),
    },
    {
      kind: "wisp",
      tile: findBestPlacementTile(mainRegion, grid, {
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
    player: toWorldPoint(playerTile, metrics),
    portal: toWorldPoint(portalTile, metrics),
    enemies: finalEnemyTiles.map((entry) => ({
      kind: entry.kind,
      ...toWorldPoint(entry.tile, metrics),
    })),
  };
}

export function buildSafeDungeon(sceneWidth: number, sceneHeight: number): AuthoredDungeon {
  const widthTiles = 38;
  const heightTiles = 25;
  const metrics: MapMetrics = {
    minX: 0,
    minY: 0,
    maxX: widthTiles - 1,
    maxY: heightTiles - 1,
    widthTiles,
    heightTiles,
    widthPx: widthTiles * MAP_TILE_SIZE,
    heightPx: heightTiles * MAP_TILE_SIZE,
    originX: Math.floor((sceneWidth - widthTiles * MAP_TILE_SIZE) / 2),
    originY: Math.max(18, Math.floor((sceneHeight - heightTiles * MAP_TILE_SIZE) / 2)),
  };

  const walkableGrid = Array.from({ length: heightTiles }, () =>
    Array.from({ length: widthTiles }, () => false),
  );

  const carveRoom = (fromX: number, fromY: number, toX: number, toY: number) => {
    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        if (y >= 0 && x >= 0 && y < heightTiles && x < widthTiles) {
          walkableGrid[y][x] = true;
        }
      }
    }
  };

  carveRoom(2, 16, 10, 22);
  carveRoom(9, 8, 12, 20);
  carveRoom(3, 3, 15, 10);
  carveRoom(13, 10, 23, 17);
  carveRoom(22, 6, 25, 18);
  carveRoom(24, 2, 35, 9);
  carveRoom(26, 16, 35, 22);
  carveRoom(18, 17, 27, 20);
  carveRoom(11, 12, 16, 14);

  const encounterLayout: EncounterLayout = {
    player: toWorldPoint({ x: 4, y: 19 }, metrics),
    portal: toWorldPoint({ x: 33, y: 4 }, metrics),
    enemies: [
      { kind: "slime", ...toWorldPoint({ x: 8, y: 7 }, metrics) },
      { kind: "skeleton", ...toWorldPoint({ x: 29, y: 7 }, metrics) },
      { kind: "wisp", ...toWorldPoint({ x: 30, y: 18 }, metrics) },
    ],
  };

  return {
    metrics,
    walkableGrid,
    encounterLayout,
  };
}
