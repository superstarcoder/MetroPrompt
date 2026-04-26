import { CODE_TO_TILE, TILE_META } from '@/lib/all_types';
import type { City, Position, Property } from '@/lib/all_types';

// ============================================================
// WALKABILITY
// A cell is walkable iff:
//   - the ground tile's `can_walk_through` is true (grass / pavement /
//     crosswalk / sidewalk yes; road / intersection no)
//   - AND no property covers it
//   - AND no nature item sits on it
// ============================================================

export function buildWalkabilityGrid(city: City): boolean[][] {
  const h = city.tile_grid.length;
  const w = city.tile_grid[0]?.length ?? 0;
  const grid: boolean[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const tileName = CODE_TO_TILE[city.tile_grid[y][x]];
      return tileName ? TILE_META[tileName].can_walk_through : false;
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

// ============================================================
// NEAREST ENTRY TILE
// 4-connected BFS outward from a property's footprint, returning the first
// walkable cell encountered. Used for two distinct purposes (same algorithm):
//   1. "Where does a citizen exit their home" (source side of a path)
//   2. "Where does a citizen arrive at a destination" (target side)
// ============================================================

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export function nearestEntryTile(
  property: Property,
  walkability: boolean[][],
): Position | null {
  const h = walkability.length;
  const w = walkability[0]?.length ?? 0;
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
    if (!insideProp(cur.x, cur.y) && walkability[cur.y][cur.x]) {
      return cur;
    }
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

// ============================================================
// A* PATHFINDING
// 4-connected grid, Manhattan heuristic. Both endpoints must be walkable
// (typically: nearestEntryTile of source property → nearestEntryTile of target).
// Returns the path inclusive of both endpoints, or null if unreachable.
// ============================================================

const manhattan = (a: Position, b: Position): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

type HeapNode = { key: number; x: number; y: number; f: number };

class MinHeap {
  private data: HeapNode[] = [];
  push(n: HeapNode) {
    this.data.push(n);
    this.bubbleUp(this.data.length - 1);
  }
  pop(): HeapNode | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }
  isEmpty() { return this.data.length === 0; }
  private bubbleUp(idx: number) {
    const node = this.data[idx];
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const parent = this.data[parentIdx];
      if (parent.f <= node.f) break;
      this.data[idx] = parent;
      idx = parentIdx;
    }
    this.data[idx] = node;
  }
  private sinkDown(idx: number) {
    const len = this.data.length;
    const node = this.data[idx];
    while (true) {
      const left = 2 * idx + 1;
      const right = left + 1;
      let smallest = idx;
      let smallestF = node.f;
      if (left < len && this.data[left].f < smallestF) {
        smallest = left;
        smallestF = this.data[left].f;
      }
      if (right < len && this.data[right].f < smallestF) {
        smallest = right;
      }
      if (smallest === idx) break;
      this.data[idx] = this.data[smallest];
      idx = smallest;
    }
    this.data[idx] = node;
  }
}

export function findPath(
  from: Position,
  to: Position,
  walkability: boolean[][],
): Position[] | null {
  const h = walkability.length;
  const w = walkability[0]?.length ?? 0;
  if (w === 0 || h === 0) return null;
  if (from.x === to.x && from.y === to.y) return [from];
  if (from.x < 0 || from.y < 0 || from.x >= w || from.y >= h) return null;
  if (to.x < 0 || to.y < 0 || to.x >= w || to.y >= h) return null;
  if (!walkability[from.y][from.x] || !walkability[to.y][to.x]) return null;

  const key = (x: number, y: number) => y * w + x;
  const decode = (k: number): Position => ({ x: k % w, y: Math.floor(k / w) });

  const open = new MinHeap();
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>();
  const closed = new Set<number>();

  const fromKey = key(from.x, from.y);
  const toKey = key(to.x, to.y);
  gScore.set(fromKey, 0);
  open.push({ key: fromKey, x: from.x, y: from.y, f: manhattan(from, to) });

  while (!open.isEmpty()) {
    const cur = open.pop()!;
    if (cur.key === toKey) {
      const path: Position[] = [];
      let k = cur.key;
      while (k !== fromKey) {
        path.push(decode(k));
        const prev = cameFrom.get(k);
        if (prev === undefined) return null;
        k = prev;
      }
      path.push(from);
      path.reverse();
      return path;
    }
    if (closed.has(cur.key)) continue;
    closed.add(cur.key);
    const curG = gScore.get(cur.key)!;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!walkability[ny][nx]) continue;
      const nKey = key(nx, ny);
      if (closed.has(nKey)) continue;
      const tentativeG = curG + 1;
      const existingG = gScore.get(nKey);
      if (existingG !== undefined && tentativeG >= existingG) continue;
      gScore.set(nKey, tentativeG);
      cameFrom.set(nKey, cur.key);
      open.push({ key: nKey, x: nx, y: ny, f: tentativeG + manhattan({ x: nx, y: ny }, to) });
    }
  }
  return null;
}

// ============================================================
// PLAN PATH (high-level convenience)
// Compute a walkable path from a citizen at `from` to a target property.
// Handles the case where `from` is non-walkable (citizen inside their home)
// by exiting through the home's nearest entry tile.
// Returns null if unreachable.
// ============================================================

export function planPathToProperty(
  from: Position,
  homeProperty: Property | null,
  target: Property,
  walkability: boolean[][],
): Position[] | null {
  const h = walkability.length;
  const w = walkability[0]?.length ?? 0;
  if (w === 0 || h === 0) return null;

  let source: Position;
  if (
    from.x >= 0 && from.x < w &&
    from.y >= 0 && from.y < h &&
    walkability[from.y][from.x]
  ) {
    source = from;
  } else if (homeProperty) {
    const exit = nearestEntryTile(homeProperty, walkability);
    if (!exit) return null;
    source = exit;
  } else {
    return null;
  }

  const targetEntry = nearestEntryTile(target, walkability);
  if (!targetEntry) return null;

  return findPath(source, targetEntry, walkability);
}
