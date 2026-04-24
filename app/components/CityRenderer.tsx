'use client';

import { useEffect, useRef, useState } from 'react';
import { TILE_RENDER, PROP_RENDER } from '@/lib/renderConfig';
import { PROPERTY_DEFAULTS, HOUSE_IMAGES, APARTMENT_IMAGES, OFFICE_IMAGES, TREE_IMAGES } from '@/lib/all_types';
import type { Property, PropertyName, Nature } from '@/lib/all_types';

const TILE_W = 64;
const TILE_H = 32;

function gridToScreen(gx: number, gy: number) {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  };
}

// Derives the PROP_RENDER / TILE_RENDER key from an image path.
// '/assets/apartment_v1_3_3.png' → 'apartment_v1'
// '/assets/tree_v3_1_1.png'      → 'tree_v3'
// '/assets/home_v2_2_2.png'      → 'home_v2'
function renderKey(imagePath: string): string {
  const filename = imagePath.split('/').pop()!.replace('.png', '');
  return filename.replace(/_\d+_\d+$/, '');
}

const TILE_TEXTURES: Record<string, string> = {
  grass:        '/assets/grass_1_1.png',
  road:         '/assets/road_1_1.png',
  sidewalk:     '/assets/sidewalk_1_1.png',
  pavement:     '/assets/pavement_1_1.png',
  crosswalk:    '/assets/crosswalk_1_1.png',
  intersection: '/assets/intersection_1_1.png',
};

// Hardcoded test scene
const GRID_SIZE = 50;
const ROAD_COLS = new Set([12, 13, 26, 27, 40, 41]);
const ROAD_ROWS = new Set([12, 13, 26, 27, 40, 41]);
const SIDEWALK_COLS = new Set([11, 14, 25, 28, 39, 42]);
const SIDEWALK_ROWS = new Set([11, 14, 25, 28, 39, 42]);

type Cell = { type: 'tile'; name: string };

function buildTestGrid(): Cell[][] {
  return Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x): Cell => {
      const isRoadCol = ROAD_COLS.has(x);
      const isRoadRow = ROAD_ROWS.has(y);
      if (isRoadCol && isRoadRow)                        return { type: 'tile', name: 'intersection' };
      if (isRoadCol || isRoadRow)                        return { type: 'tile', name: 'road' };
      if (SIDEWALK_COLS.has(x) || SIDEWALK_ROWS.has(y)) return { type: 'tile', name: 'sidewalk' };
      return { type: 'tile', name: 'grass' };
    })
  );
}

// ---- Property construction helpers ----

const bldg = (name: PropertyName, x: number, y: number): Property => ({
  ...PROPERTY_DEFAULTS[name],
  position: { x, y },
  current_occupants: [],
});

const apt = (v: 1 | 2, x: number, y: number): Property => ({
  ...PROPERTY_DEFAULTS.apartment,
  position: { x, y },
  current_occupants: [],
  image: APARTMENT_IMAGES[v - 1],
});

const house = (x: number, y: number): Property => ({
  ...PROPERTY_DEFAULTS.house,
  position: { x, y },
  current_occupants: [],
  image: HOUSE_IMAGES[1], // home_v2 (2×2)
});

const office = (v: 1 | 2 | 3, x: number, y: number): Property => ({
  ...PROPERTY_DEFAULTS.office,
  position: { x, y },
  current_occupants: [],
  image: OFFICE_IMAGES[v - 1],
});

// City layout — 4×4 blocks separated by 2-tile roads + sidewalks
// Blocks: col0=x[0..10], col1=x[15..24], col2=x[29..38], col3=x[43..49]
//          row0=y[0..10], row1=y[15..24], row2=y[29..38], row3=y[43..49]
const testProps: Property[] = [
  // B(0,0) — Residential + Park
  bldg('shopping_mall', 0, 0),
  // office(3,           0,  0),
  // office(1,           4,  0),
  // office(3,           8,  0),
  // house(           7,  3),
  bldg('restaurant', 4,  5),
  apt(1,           0,  7),

  // B(1,0) — Residential + School
  bldg('school',     15, 0),
  apt(2,           19, 0),
  house(           22, 0),
  house(           15, 4),
  house(           18, 4),
  house(           21, 4),
  house(           15, 7),
  bldg('restaurant', 18, 7),
  house(           22, 7),

  // B(2,0) — Residential + Grocery
  bldg('grocery_store', 29, 0),
  apt(1,           33, 0),
  house(           36, 0),
  house(           29, 4),
  house(           32, 4),
  apt(2,           36, 4),
  house(           29, 7),
  house(           32, 7),
  house(           36, 7),

  // B(3,0) — Residential
  house(           43, 0),
  house(           46, 0),
  apt(1,           43, 3),
  house(           46, 3),
  house(           43, 6),
  house(           46, 6),

  // B(0,1) — Hospital + Residential
  bldg('hospital',   0, 15),
  house(            4, 15),
  house(            7, 15),
  house(            4, 18),
  house(            7, 18),
  house(            0, 19),
  bldg('restaurant', 4, 20),
  apt(2,            0, 22),
  house(            4, 22),
  house(            7, 22),

  // B(1,1) — Civic center: fire + police + park + grocery
  bldg('fire_station',  15, 15),
  bldg('police_station',20, 15),
  bldg('park',          15, 20),
  bldg('grocery_store', 20, 20),
  house(               15, 23),
  house(               18, 23),
  apt(1,               22, 23),

  // B(2,1) — Residential + Commercial
  apt(2,           29, 15),
  bldg('restaurant', 32, 15),
  apt(1,           35, 15),
  office(1,        29, 19),
  house(           29, 18),
  house(           32, 18),
  house(           36, 18),
  house(           29, 22),
  house(           32, 22),
  apt(2,           35, 22),

  // B(3,1) — Residential
  apt(1,           43, 15),
  house(           46, 15),
  house(           43, 18),
  house(           46, 18),
  house(           43, 22),
  bldg('restaurant', 46, 22),

  // B(0,2) — Residential + Park
  house(            0, 29),
  bldg('park',       4, 29),
  house(            8, 29),
  house(            0, 32),
  apt(2,            4, 33),
  house(            8, 32),
  house(            0, 36),
  house(            4, 36),
  house(            8, 36),

  // B(1,2) — Hospital + School
  bldg('hospital',  15, 29),
  bldg('school',    20, 29),
  house(            15, 33),
  house(            18, 33),
  apt(1,            21, 33),
  house(            15, 36),
  house(            19, 36),
  house(            22, 36),

  // B(2,2) — Commercial hub
  office(2,        29, 29),
  office(3,        33, 29),
  apt(2,           36, 29),
  bldg('park',      29, 33),
  house(           33, 32),
  house(           36, 32),
  house(           33, 36),
  apt(1,           36, 36),

  // B(3,2) — Residential
  house(           43, 29),
  house(           46, 29),
  apt(2,           43, 32),
  house(           46, 32),
  house(           43, 36),
  house(           46, 36),

  // B(0,3) — Power plant + Residential
  bldg('power_plant', 0, 43),
  house(            4, 43),
  house(            7, 43),
  house(            0, 47),
  house(            4, 47),
  house(            7, 47),

  // B(1,3) — School + Residential
  bldg('school',    15, 43),
  house(            19, 43),
  house(            22, 43),
  house(            15, 47),
  apt(1,            19, 47),
  house(            22, 47),

  // B(2,3) — Fire station + Residential
  bldg('fire_station', 29, 43),
  house(            33, 43),
  house(            36, 43),
  house(            29, 47),
  house(            33, 47),
  apt(2,            36, 47),

  // B(3,3) — Power plant + Residential
  bldg('power_plant', 44, 43),
  house(            43, 47),
  house(            46, 47),
];

export default function CityRenderer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gridLinesRef = useRef<any>(null);
  const [showGrid, setShowGrid] = useState(true);

  useEffect(() => {
    if (gridLinesRef.current) gridLinesRef.current.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    let destroyed = false;

    async function init() {
      const { Application, Assets, Sprite, Container, Graphics, TextureStyle } = await import('pixi.js');
      TextureStyle.defaultOptions.scaleMode = 'nearest';

      const app = new Application();
      await app.init({
        resizeTo: mount,
        background: 0x2d4a1e,
        antialias: false,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (destroyed) { app.destroy(true); return; }
      mount.appendChild(app.canvas as HTMLCanvasElement);

      // Build grid and nature inside init() so Math.random is always client-side
      const grid = buildTestGrid();

      const occupied: boolean[][] = Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(false));
      for (const prop of testProps) {
        for (let dy = 0; dy < prop.height; dy++) {
          for (let dx = 0; dx < prop.width; dx++) {
            const cx = prop.position.x + dx;
            const cy = prop.position.y + dy;
            if (cx >= 0 && cx < GRID_SIZE && cy >= 0 && cy < GRID_SIZE) occupied[cy][cx] = true;
          }
        }
      }

      const testNature: Nature[] = [];
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          if (grid[gy][gx].name !== 'grass') continue;
          if (occupied[gy][gx]) continue;
          const r = Math.random();
          if (r < 0.04) {
            testNature.push({ name: 'tree', position: { x: gx, y: gy }, image: TREE_IMAGES[Math.floor(Math.random() * TREE_IMAGES.length)] });
          } else if (r < 0.08) {
            testNature.push({ name: 'flower_patch', position: { x: gx, y: gy }, image: '/assets/flower_patch_v1_1_1.png' });
          } else if (r < 0.10) {
            testNature.push({ name: 'bush', position: { x: gx, y: gy }, image: '/assets/bush_v1_1_1.png' });
          }
        }
      }

      // Cell-indexed lookups for the nested render loop below
      const natureByCell: Record<string, Nature> = {};
      for (const nat of testNature) {
        natureByCell[`${nat.position.x},${nat.position.y}`] = nat;
      }
      const propByAnchor: Record<string, Property> = {};
      for (const prop of testProps) {
        propByAnchor[`${prop.position.x},${prop.position.y}`] = prop;
      }

      // Load all textures
      const tileTex: Record<string, any> = {};
      const propTex: Record<string, any> = {};
      const natureTex: Record<string, any> = {};

      const uniqueTilePaths = [...new Set(Object.values(TILE_TEXTURES))];
      const uniquePropImages = [...new Set(testProps.map(p => p.image))];
      const uniqueNaturePaths = [...new Set(testNature.map(n => n.image))];

      await Promise.all([
        ...uniqueTilePaths.map(async (p) => { tileTex[p] = await Assets.load(p); }),
        ...uniquePropImages.map(async (path) => { propTex[path] = await Assets.load(path); }),
        ...uniqueNaturePaths.map(async (path) => { natureTex[path] = await Assets.load(path); }),
      ]);

      if (destroyed) { app.destroy(true); return; }

      // World container — all sprites go here, we pan/zoom this
      const world = new Container();
      app.stage.addChild(world);

      // Start camera centered on the middle of the grid
      const { x: cx, y: cy } = gridToScreen(GRID_SIZE / 2, GRID_SIZE / 2);
      world.x = app.screen.width / 2 - cx;
      world.y = app.screen.height / 2 - cy;

      // --- Pass 1: all tiles — ground layer, rendered before anything else ---
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const cell = grid[gy][gx];
          const texPath = TILE_TEXTURES[cell.name];
          if (!texPath) continue;
          const tex = tileTex[texPath];
          if (!tex) continue;
          const { x, y } = gridToScreen(gx, gy);
          const cfg = TILE_RENDER[cell.name] ?? { offsetX: 0, offsetY: 0, scale: 1 };
          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5, 0);
          sprite.scale.set((TILE_W / (tex as any).width) * cfg.scale);
          sprite.x = x + cfg.offsetX;
          sprite.y = y + cfg.offsetY;
          world.addChild(sprite);
        }
      }

      // --- Pass 2: properties + nature, rendered in nested (y, x) order ---
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const key = `${gx},${gy}`;

          const nat = natureByCell[key];
          if (nat) {
            const tex = natureTex[nat.image];
            if (tex) {
              const { x, y } = gridToScreen(gx, gy);
              const cfg = TILE_RENDER[renderKey(nat.image)] ?? { offsetX: 0, offsetY: 0, scale: 1 };
              const sprite = new Sprite(tex);
              sprite.anchor.set(0.5, 0);
              sprite.scale.set((TILE_W / (tex as any).width) * cfg.scale);
              sprite.x = x + cfg.offsetX;
              sprite.y = y + cfg.offsetY;
              world.addChild(sprite);
            }
          }

          const prop = propByAnchor[key];
          if (prop) {
            const tex = propTex[prop.image];
            if (tex) {
              const { x, y } = gridToScreen(gx, gy);
              const cfg = PROP_RENDER[renderKey(prop.image)] ?? { offsetX: 0, offsetY: 0, scale: 1 };
              const sprite = new Sprite(tex);
              sprite.anchor.set(0.5, 0);
              sprite.width = prop.width * TILE_W * cfg.scale;
              sprite.scale.y = sprite.scale.x;
              sprite.x = x + cfg.offsetX;
              sprite.y = y - (prop.width - 1) * TILE_H + cfg.offsetY;
              world.addChild(sprite);
            }
          }
        }
      }

      // --- Grid overlay ---
      const gridLines = new Graphics();
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const { x, y } = gridToScreen(gx, gy);
          gridLines
            .moveTo(x,               y)
            .lineTo(x + TILE_W / 2,  y + TILE_H / 2)
            .lineTo(x,               y + TILE_H)
            .lineTo(x - TILE_W / 2,  y + TILE_H / 2)
            .closePath();
        }
      }
      gridLines.stroke({ color: 0xff3333, width: 1, alpha: 0.8 });
      gridLines.visible = showGrid;
      gridLinesRef.current = gridLines;
      world.addChild(gridLines);

      // --- Pan ---
      let isDragging = false;
      let lastX = 0, lastY = 0;

      mount.addEventListener('pointerdown', (e) => {
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        mount.style.cursor = 'grabbing';
      });
      mount.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        world.x += e.clientX - lastX;
        world.y += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
      });
      const stopDrag = () => { isDragging = false; mount.style.cursor = 'grab'; };
      mount.addEventListener('pointerup', stopDrag);
      mount.addEventListener('pointerleave', stopDrag);
      mount.style.cursor = 'grab';

      // --- Zoom (zoom toward cursor) ---
      mount.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.max(0.2, Math.min(5, world.scale.x * factor));

        const mouseX = e.clientX;
        const mouseY = e.clientY;
        const worldX = (mouseX - world.x) / world.scale.x;
        const worldY = (mouseY - world.y) / world.scale.y;
        world.scale.set(newScale);
        world.x = mouseX - worldX * newScale;
        world.y = mouseY - worldY * newScale;
      }, { passive: false });
    }

    init();

    return () => {
      destroyed = true;
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full" />
      <button
        onClick={() => setShowGrid(g => !g)}
        className="absolute top-4 right-4 px-3 py-1.5 rounded text-sm font-mono bg-black/60 text-white border border-white/20 hover:bg-black/80 transition-colors"
      >
        {showGrid ? 'hide grid' : 'show grid'}
      </button>
    </div>
  );
}
