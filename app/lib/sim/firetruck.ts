import { CODE_TO_TILE, TILE_META } from '@/lib/all_types';
import type { City, Person, Position, Property, TileName } from '@/lib/all_types';
import { findPath } from './pathfinding';

// ============================================================
// DRIVABILITY GRID
// Mirrors buildWalkabilityGrid but uses can_drive_through. Roads,
// intersections, and crosswalks are drivable; everything else is not.
// Properties + nature still block.
// ============================================================

export function buildDrivabilityGrid(city: City): boolean[][] {
  const h = city.tile_grid.length;
  const w = city.tile_grid[0]?.length ?? 0;
  const grid: boolean[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const name = CODE_TO_TILE[city.tile_grid[y][x]];
      return name ? TILE_META[name].can_drive_through : false;
    }),
  );
  for (const p of city.all_properties) {
    for (let dy = 0; dy < p.height; dy++) {
      for (let dx = 0; dx < p.width; dx++) {
        const x = p.position.x + dx;
        const y = p.position.y + dy;
        if (y >= 0 && y < h && x >= 0 && x < w) grid[y][x] = false;
      }
    }
  }
  for (const n of city.all_nature) {
    const { x, y } = n.position;
    if (y >= 0 && y < h && x >= 0 && x < w) grid[y][x] = false;
  }
  return grid;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

// BFS outward from the property's footprint to the first drivable cell.
// Used both for picking the truck's spawn cell at a fire station and the
// truck's arrival cell at the burning building.
export function nearestRoadTile(
  property: Property,
  drivability: boolean[][],
): Position | null {
  const h = drivability.length;
  const w = drivability[0]?.length ?? 0;
  if (w === 0 || h === 0) return null;

  const { x: px, y: py } = property.position;
  const pw = property.width;
  const ph = property.height;
  const insideProp = (x: number, y: number) =>
    x >= px && x < px + pw && y >= py && y < py + ph;

  const visited: boolean[][] = Array.from({ length: h }, () => new Array(w).fill(false));
  const queue: Position[] = [];
  for (let dy = 0; dy < ph; dy++) {
    for (let dx = 0; dx < pw; dx++) {
      const x = px + dx, y = py + dy;
      if (y >= 0 && y < h && x >= 0 && x < w) {
        visited[y][x] = true;
        queue.push({ x, y });
      }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (!insideProp(cur.x, cur.y) && drivability[cur.y][cur.x]) return cur;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (visited[ny][nx]) continue;
      visited[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

// Picks the fire station whose road-network distance to the target is
// shortest. Manhattan would be cheaper but a station across an unreachable
// river shouldn't win; we A* each candidate (typically 1–3 stations) and
// return the winner along with both endpoint road tiles + the path.
export function findNearestFireStation(
  target: Property,
  city: City,
  drivability: boolean[][],
): { station: Property; path: Position[]; targetRoad: Position; stationRoad: Position } | null {
  const stations = city.all_properties.filter(p => p.name === 'fire_station');
  if (stations.length === 0) return null;
  const targetRoad = nearestRoadTile(target, drivability);
  if (!targetRoad) return null;

  let best: { station: Property; path: Position[]; targetRoad: Position; stationRoad: Position } | null = null;
  for (const s of stations) {
    const stationRoad = nearestRoadTile(s, drivability);
    if (!stationRoad) continue;
    const path = findPath(stationRoad, targetRoad, drivability);
    if (!path) continue;
    if (!best || path.length < best.path.length) {
      best = { station: s, path, targetRoad, stationRoad };
    }
  }
  return best;
}

// ============================================================
// CITIZEN YIELDING
// The truck must give citizens the right of way at crosswalks and
// intersections. It yields if any citizen is currently *on* the cell it's
// about to enter, or is one cell away and walking toward it.
// ============================================================

const YIELD_TILES: ReadonlySet<TileName> = new Set(['crosswalk', 'road_intersection']);

export function isYieldTile(pos: Position, city: City): boolean {
  const code = city.tile_grid[pos.y]?.[pos.x];
  const name = code ? CODE_TO_TILE[code] : null;
  return !!name && YIELD_TILES.has(name);
}

// Returns true if the truck must stop *before* entering `nextTile`.
// Only enforces yielding at crosswalks/intersections — open road has no
// pedestrian conflict.
//
// `lerpProgress` is [0..1] of the way through the current sim tick. We need
// it because citizens advance multiple cells per logical tick (prev → cur is
// up to WALK_CELLS_PER_TICK apart), but their visual position is interpolated
// across the full tick interval. Without progress, a citizen mid-crosswalk
// has `current_location` already past it — and the truck would advance
// while the sprite is still visually inside the crossing.
export function shouldYieldForCitizens(
  nextTile: Position,
  citizens: Person[],
  city: City,
  lerpProgress: number,
): boolean {
  if (!isYieldTile(nextTile, city)) return false;
  for (const c of citizens) {
    if (c.inside_property) continue;

    const prev = c.prev_location ?? c.current_location;
    const cur = c.current_location;
    const visX = Math.round(prev.x + (cur.x - prev.x) * lerpProgress);
    const visY = Math.round(prev.y + (cur.y - prev.y) * lerpProgress);

    // (1) Citizen is visually standing on the tile right now.
    if (visX === nextTile.x && visY === nextTile.y) return true;

    // (2) Citizen is logically traversing the tile this tick (the Manhattan
    //     path from prev → cur passes through it) AND their visual lerp
    //     hasn't yet rolled past the tile. The +1 cell buffer keeps us
    //     yielding for a beat after they cross — better safe than mowed down.
    const distPrevCur = Math.abs(prev.x - cur.x) + Math.abs(prev.y - cur.y);
    if (distPrevCur > 0) {
      const distPrevTile = Math.abs(prev.x - nextTile.x) + Math.abs(prev.y - nextTile.y);
      const distTileCur = Math.abs(nextTile.x - cur.x) + Math.abs(nextTile.y - cur.y);
      if (distPrevTile + distTileCur === distPrevCur) {
        const visualTraveled = lerpProgress * distPrevCur;
        if (visualTraveled < distPrevTile + 1) return true;
      }
    }

    // (3) Citizen is one cell away (visually) and the next logical step
    //     puts them on the tile.
    const dist = Math.abs(visX - nextTile.x) + Math.abs(visY - nextTile.y);
    if (dist === 1 && c.current_path.length > 0) {
      const step = c.current_path[0];
      if (step.x === nextTile.x && step.y === nextTile.y) return true;
    }
  }
  return false;
}
