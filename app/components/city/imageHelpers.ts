import {
  PROPERTY_DEFAULTS,
  HOUSE_IMAGES,
  APARTMENT_IMAGES,
  OFFICE_IMAGES,
  RESTAURANT_IMAGES,
  TREE_IMAGES,
  FLOWER_PATCH_IMAGES,
  BUSH_IMAGES,
  TILE_META,
  CITIZEN_IMAGES,
} from '@/lib/all_types';
import type { PropertyName, NatureName, Position } from '@/lib/all_types';

// Derives the PROP_RENDER / TILE_RENDER key from an image path.
// '/assets/apartment_v1_3_3.png' → 'apartment_v1'; '/assets/tree_v3_1_1.png' → 'tree_v3'.
export function renderKey(imagePath: string): string {
  const filename = imagePath.split('/').pop()!.replace('.png', '');
  return filename.replace(/_\d+_\d+$/, '');
}

// Client picks variants at placement time. Purely cosmetic — server's city uses
// PROPERTY_DEFAULTS images; the client mixes it up for visual variety.
export function pickPropertyImage(name: PropertyName): string {
  if (name === 'house')      return HOUSE_IMAGES[Math.floor(Math.random() * HOUSE_IMAGES.length)];
  if (name === 'apartment')  return APARTMENT_IMAGES[Math.floor(Math.random() * APARTMENT_IMAGES.length)];
  if (name === 'office')     return OFFICE_IMAGES[Math.floor(Math.random() * OFFICE_IMAGES.length)];
  if (name === 'restaurant') return RESTAURANT_IMAGES[Math.floor(Math.random() * RESTAURANT_IMAGES.length)];
  return PROPERTY_DEFAULTS[name].image;
}

export function pickNatureImage(name: NatureName): string {
  const arr =
    name === 'tree'         ? TREE_IMAGES :
    name === 'flower_patch' ? FLOWER_PATCH_IMAGES :
                              BUSH_IMAGES;
  return arr[Math.floor(Math.random() * arr.length)];
}

// Preload every image the Mayor might need, so `tool_applied` events render immediately.
export const ALL_TILE_IMAGES = [...new Set(Object.values(TILE_META).map(m => m.image))];
export const ALL_PROP_IMAGES = [...new Set([
  ...Object.values(PROPERTY_DEFAULTS).map(d => d.image),
  ...HOUSE_IMAGES,
  ...APARTMENT_IMAGES,
  ...OFFICE_IMAGES,
  ...RESTAURANT_IMAGES,
])];
export const ALL_NATURE_IMAGES = [...new Set([
  ...TREE_IMAGES,
  ...FLOWER_PATCH_IMAGES,
  ...BUSH_IMAGES,
])];
export const ALL_CITIZEN_IMAGES = [...new Set(CITIZEN_IMAGES)];

// Map a one-step grid delta (next - current) to the matching walking sprite.
// Iso projection: +x → SE, -x → NW, +y → SW, -y → NE.
// Returns the idle/front sprite when no movement (dx === dy === 0).
export type CitizenDirection = 'idle' | 'NE' | 'NW' | 'SE' | 'SW';

export function citizenDirection(from: Position, to: Position): CitizenDirection {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 'idle';
  // Prefer the larger axis when the step isn't pure-cardinal (shouldn't happen in
  // 4-connected pathfinding but defensive).
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'SE' : 'NW';
  return dy > 0 ? 'SW' : 'NE';
}
