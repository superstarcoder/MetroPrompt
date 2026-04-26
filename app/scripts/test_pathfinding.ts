// Smoke test for sim pathfinding (step 3).
// Run: cd app && npx tsx scripts/test_pathfinding.ts

import { initCity, placeProperty, placeNature, PROPERTY_DEFAULTS } from '../lib/all_types';
import type { Property } from '../lib/all_types';
import {
  buildWalkabilityGrid,
  findPath,
  nearestEntryTile,
  planPathToProperty,
} from '../lib/sim/pathfinding';

function assert(cond: unknown, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('OK:  ', msg);
}

// ------------------------------------------------------------
// 1. Empty city (all grass) — straight-line path
// ------------------------------------------------------------
{
  const city = initCity(20);
  const w = buildWalkabilityGrid(city);
  // Every cell walkable
  let allWalkable = true;
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (!w[y][x]) allWalkable = false;
  assert(allWalkable, 'empty city: all 400 cells walkable');

  const path = findPath({ x: 0, y: 0 }, { x: 5, y: 5 }, w);
  assert(path !== null, 'empty city: path (0,0) → (5,5) found');
  assert(path!.length === 11, `empty city: path length is 11 (Manhattan + 1 for inclusive endpoints), got ${path!.length}`);
  assert(path![0].x === 0 && path![0].y === 0, 'path starts at (0,0)');
  assert(path![10].x === 5 && path![10].y === 5, 'path ends at (5,5)');
}

// ------------------------------------------------------------
// 2. Trees block direct route → A* routes around
// ------------------------------------------------------------
{
  const city = initCity(10);
  // Vertical wall of trees at x=5, y=0..8 — leaves y=9 as the only gap
  for (let y = 0; y <= 8; y++) {
    placeNature(city, { name: 'tree', position: { x: 5, y }, image: '/assets/tree_v1_1_1.png' });
  }
  const w = buildWalkabilityGrid(city);
  assert(w[0][5] === false && w[8][5] === false, 'tree wall blocks (5, y) for y=0..8');
  assert(w[9][5] === true, 'tree wall has gap at (5, 9)');

  const path = findPath({ x: 0, y: 0 }, { x: 9, y: 0 }, w);
  assert(path !== null, 'around trees: path found');
  // Manhattan = 9. With detour through y=9, length should be 9 + 2*9 + 1 = 28
  assert(path!.length === 28, `path length 28 around tree wall, got ${path!.length}`);
  // No path cell should sit on the wall
  for (const p of path!) {
    if (p.x === 5 && p.y >= 0 && p.y <= 8) {
      console.error(`FAIL: path goes through wall at (${p.x},${p.y})`); process.exit(1);
    }
  }
  console.log('OK:   path avoids every wall cell');
}

// ------------------------------------------------------------
// 3. Unreachable destination
// ------------------------------------------------------------
{
  const city = initCity(10);
  // Box (3,3)–(5,5) sealed off by trees on every adjacent cell
  for (let x = 2; x <= 6; x++) {
    placeNature(city, { name: 'tree', position: { x, y: 2 }, image: '/assets/tree_v1_1_1.png' });
    placeNature(city, { name: 'tree', position: { x, y: 6 }, image: '/assets/tree_v1_1_1.png' });
  }
  for (let y = 3; y <= 5; y++) {
    placeNature(city, { name: 'tree', position: { x: 2, y }, image: '/assets/tree_v1_1_1.png' });
    placeNature(city, { name: 'tree', position: { x: 6, y }, image: '/assets/tree_v1_1_1.png' });
  }
  const w = buildWalkabilityGrid(city);
  const path = findPath({ x: 0, y: 0 }, { x: 4, y: 4 }, w);
  assert(path === null, 'sealed box: path returns null');
}

// ------------------------------------------------------------
// 4. nearestEntryTile for a property
// ------------------------------------------------------------
{
  const city = initCity(20);
  const house: Property = {
    ...PROPERTY_DEFAULTS.house,
    position: { x: 10, y: 10 },
    current_occupants: [],
  };
  placeProperty(city, house);
  const w = buildWalkabilityGrid(city);

  // House is 2x2 at (10,10) so footprint = (10..11, 10..11)
  // Walkable cells immediately adjacent: (9,10), (9,11), (12,10), (12,11), (10,9), (11,9), (10,12), (11,12)
  const entry = nearestEntryTile(house, w);
  assert(entry !== null, 'house entry tile found');
  const adj = entry!;
  const insideHouse = adj.x >= 10 && adj.x <= 11 && adj.y >= 10 && adj.y <= 11;
  assert(!insideHouse, 'entry tile is outside house footprint');
  // Adjacent (4-connected) to at least one house cell
  const isAdj = (
    (adj.x === 9 || adj.x === 12) && (adj.y === 10 || adj.y === 11)
  ) || (
    (adj.y === 9 || adj.y === 12) && (adj.x === 10 || adj.x === 11)
  );
  assert(isAdj, `entry tile (${adj.x},${adj.y}) is 4-adjacent to house footprint`);
}

// ------------------------------------------------------------
// 5. planPathToProperty handles citizen-inside-home
// ------------------------------------------------------------
{
  const city = initCity(20);
  const home: Property = {
    ...PROPERTY_DEFAULTS.house,
    position: { x: 2, y: 2 },
    current_occupants: [],
  };
  const target: Property = {
    ...PROPERTY_DEFAULTS.restaurant,
    position: { x: 12, y: 12 },
    current_occupants: [],
  };
  placeProperty(city, home);
  placeProperty(city, target);
  const w = buildWalkabilityGrid(city);

  // Citizen "inside" home — current_location is the home anchor (non-walkable)
  const path = planPathToProperty({ x: 2, y: 2 }, home, target, w);
  assert(path !== null, 'citizen-in-home → restaurant: path found');
  // First cell should be a walkable cell adjacent to the home
  const start = path![0];
  assert(w[start.y][start.x], `path starts at walkable cell (${start.x},${start.y})`);
  // Last cell should be adjacent to target footprint (12..13, 12..13)
  const end = path![path!.length - 1];
  const adjTarget = (
    (end.x === 11 || end.x === 14) && (end.y === 12 || end.y === 13)
  ) || (
    (end.y === 11 || end.y === 14) && (end.x === 12 || end.x === 13)
  );
  assert(adjTarget, `path ends 4-adjacent to target at (${end.x},${end.y})`);
}

console.log('\nAll pathfinding smoke tests passed.');
