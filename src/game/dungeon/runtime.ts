export type Direction8 =
  | "north"
  | "north-east"
  | "east"
  | "south-east"
  | "south"
  | "south-west"
  | "west"
  | "north-west";

export function getDirectionFromVector(
  x: number,
  y: number,
  fallback: Direction8 = "south",
): Direction8 {
  if (Math.abs(x) < 0.001 && Math.abs(y) < 0.001) {
    return fallback;
  }

  const angle = Math.atan2(y, x);
  const octant = Math.round((angle / (Math.PI / 4))) % 8;
  const normalized = (octant + 8) % 8;

  switch (normalized) {
    case 0:
      return "east";
    case 1:
      return "south-east";
    case 2:
      return "south";
    case 3:
      return "south-west";
    case 4:
      return "west";
    case 5:
      return "north-west";
    case 6:
      return "north";
    case 7:
      return "north-east";
    default:
      return fallback;
  }
}

export function getActorDepth(y: number, base = 10) {
  return base + y * 0.1;
}

export function getShadowDepth(y: number, base = 8) {
  return base + y * 0.1;
}
