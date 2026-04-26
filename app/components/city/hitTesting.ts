import type { City, Nature, Position, Property } from '@/lib/all_types';
import { GRID_SIZE, TILE_H, TILE_W } from './constants';

export type SelectedEntity =
  | { kind: 'property'; data: Property }
  | { kind: 'nature'; data: Nature };

// Live state of an in-progress drag (move-existing or palette drop-new).
// Mutated by pointer handlers in useCityScene + onPalettePointerDown; read by
// the painter loop to tint the in-flight sprite green/red.
export type EntityDragState = {
  sel: SelectedEntity;
  originalPos: Position;
  valid: boolean;
  // True for palette-spawned entities. On invalid drop the entity is removed
  // from the city instead of being snapped back to originalPos.
  isNew: boolean;
};

// Inverse of gridToScreen. Converts a screen-space point (relative to the canvas
// element) into a grid cell, accounting for world pan/zoom. Returns null if outside
// the GRID_SIZE × GRID_SIZE bounds.
export function screenToGrid(
  screenX: number,
  screenY: number,
  worldX: number,
  worldY: number,
  worldScale: number,
): { gx: number; gy: number } | null {
  const wx = (screenX - worldX) / worldScale;
  const wy = (screenY - worldY) / worldScale;
  // Diamond center is at gridToScreen(gx,gy) + (0, TILE_H/2). Solve for gx,gy.
  const cy = wy - TILE_H / 2;
  const fgx = cy / TILE_H + wx / TILE_W;
  const fgy = cy / TILE_H - wx / TILE_W;
  const gx = Math.round(fgx);
  const gy = Math.round(fgy);
  if (gx < 0 || gy < 0 || gx >= GRID_SIZE || gy >= GRID_SIZE) return null;
  return { gx, gy };
}

// Returns the entity occupying (gx, gy), or null. Nature is checked first because
// it can't legally overlap properties at placement time, but if data did get out
// of sync we'd still prefer the smaller selectable target.
export function entityAt(city: City, gx: number, gy: number): SelectedEntity | null {
  for (const n of city.all_nature) {
    if (n.position.x === gx && n.position.y === gy) return { kind: 'nature', data: n };
  }
  for (const p of city.all_properties) {
    const dx = gx - p.position.x;
    const dy = gy - p.position.y;
    if (dx >= 0 && dx < p.width && dy >= 0 && dy < p.height) return { kind: 'property', data: p };
  }
  return null;
}

// Validates moving `entity` to `newPos`. In-bounds + no overlap with other entities.
// (Does NOT enforce grass-only — editing should be permissive; users can drop on roads.)
export function isPlacementValid(city: City, sel: SelectedEntity, newPos: Position): boolean {
  if (sel.kind === 'property') {
    const p = sel.data;
    if (newPos.x < 0 || newPos.y < 0) return false;
    if (newPos.x + p.width > GRID_SIZE || newPos.y + p.height > GRID_SIZE) return false;
    for (const other of city.all_properties) {
      if (other === p) continue;
      const xOverlap =
        newPos.x < other.position.x + other.width &&
        newPos.x + p.width > other.position.x;
      const yOverlap =
        newPos.y < other.position.y + other.height &&
        newPos.y + p.height > other.position.y;
      if (xOverlap && yOverlap) return false;
    }
    for (const n of city.all_nature) {
      const dx = n.position.x - newPos.x;
      const dy = n.position.y - newPos.y;
      if (dx >= 0 && dx < p.width && dy >= 0 && dy < p.height) return false;
    }
    return true;
  } else {
    if (newPos.x < 0 || newPos.y < 0 || newPos.x >= GRID_SIZE || newPos.y >= GRID_SIZE) return false;
    for (const other of city.all_nature) {
      if (other === sel.data) continue;
      if (other.position.x === newPos.x && other.position.y === newPos.y) return false;
    }
    for (const p of city.all_properties) {
      const dx = newPos.x - p.position.x;
      const dy = newPos.y - p.position.y;
      if (dx >= 0 && dx < p.width && dy >= 0 && dy < p.height) return false;
    }
    return true;
  }
}
