export const TILE_W = 64;
export const TILE_H = 32;
export const GRID_SIZE = 50;

export function gridToScreen(gx: number, gy: number) {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  };
}
