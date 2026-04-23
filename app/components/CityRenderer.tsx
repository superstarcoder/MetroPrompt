import { useEffect, useRef, useState } from 'react';
import { TILE_RENDER, PROP_RENDER } from '@/lib/renderConfig';

const TILE_W = 64;
const TILE_H = 32;

function gridToScreen(gx: number, gy: number) {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  };
}

const TILE_TEXTURES: Record<string, string> = {
  grass:        '/assets/grass_1_1.png',
  road:         '/assets/road_1_1.png',
  sidewalk:     '/assets/sidewalk_1_1.png',
  pavement:     '/assets/pavement_1_1.png',
  crosswalk:    '/assets/crosswalk_1_1.png',
  intersection: '/assets/intersection_1_1.png',
};

const PROPERTY_TEXTURES: Record<string, { path: string; size: number }> = {
  park:          { path: '/assets/park_3_3.png',          size: 3 },
  hospital:      { path: '/assets/hospital_3_3.png',      size: 3 },
  school:        { path: '/assets/school_3_3.png',        size: 3 },
  grocery_store: { path: '/assets/grocery_store_3_3.png', size: 3 },
  fire_station:  { path: '/assets/fire_station_3_3.png',  size: 3 },
  police_station:{ path: '/assets/police_station_3_3.png',size: 3 },
  power_plant:   { path: '/assets/powerplant_3_3.png',    size: 3 },
  apartment:     { path: '/assets/apartment_2_2.png',     size: 2 },
  restaurant:    { path: '/assets/restaurant_2_2.png',    size: 2 },
  house_v1:      { path: '/assets/home_v1_1_1.png',       size: 1 },
  house_v2:      { path: '/assets/home_v2_2_2.png',       size: 2 },
};

// Hardcoded test scene
const GRID_SIZE = 50;
const ROAD_COLS = new Set([12, 13, 26, 27, 40, 41]);
const ROAD_ROWS = new Set([12, 13, 26, 27, 40, 41]);
const SIDEWALK_COLS = new Set([11, 14, 25, 28, 39, 42]);
const SIDEWALK_ROWS = new Set([11, 14, 25, 28, 39, 42]);

type TileCell = { type: 'tile'; name: string };
type PropCell = { type: 'prop'; name: string; size: number; originX: number; originY: number };
type Cell = TileCell | PropCell;

function buildTestGrid(): Cell[][] {
  return Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x): Cell => {
      const isRoadCol = ROAD_COLS.has(x);
      const isRoadRow = ROAD_ROWS.has(y);
      if (isRoadCol && isRoadRow)                    return { type: 'tile', name: 'intersection' };
      if (isRoadCol || isRoadRow)                    return { type: 'tile', name: 'road' };
      if (SIDEWALK_COLS.has(x) || SIDEWALK_ROWS.has(y)) return { type: 'tile', name: 'sidewalk' };
      return { type: 'tile', name: 'grass' };
    })
  );
}

// City layout — 4×4 blocks separated by 2-tile roads + sidewalks
// Blocks: col0=x[0..10], col1=x[15..24], col2=x[29..38], col3=x[43..49]
//          row0=y[0..10], row1=y[15..24], row2=y[29..38], row3=y[43..49]
const testProps: { name: string; gx: number; gy: number }[] = [
  // B(0,0) — Residential + Park
  { name: 'park',          gx: 0,  gy: 0  },
  { name: 'house_v2',      gx: 4,  gy: 0  },
  { name: 'house_v2',      gx: 7,  gy: 0  },
  { name: 'house_v2',      gx: 4,  gy: 3  },
  { name: 'house_v2',      gx: 7,  gy: 3  },
  { name: 'house_v2',      gx: 0,  gy: 4  },
  { name: 'restaurant',    gx: 4,  gy: 5  },
  { name: 'apartment',     gx: 0,  gy: 7  },
  { name: 'house_v2',      gx: 4,  gy: 7  },
  { name: 'house_v2',      gx: 7,  gy: 7  },

  // B(1,0) — Residential + School
  { name: 'school',        gx: 15, gy: 0  },
  { name: 'apartment',     gx: 19, gy: 0  },
  { name: 'house_v2',      gx: 22, gy: 0  },
  { name: 'house_v2',      gx: 15, gy: 4  },
  { name: 'house_v2',      gx: 18, gy: 4  },
  { name: 'house_v2',      gx: 21, gy: 4  },
  { name: 'house_v2',      gx: 15, gy: 7  },
  { name: 'restaurant',    gx: 18, gy: 7  },
  { name: 'house_v2',      gx: 22, gy: 7  },

  // B(2,0) — Residential + Grocery
  { name: 'grocery_store', gx: 29, gy: 0  },
  { name: 'apartment',     gx: 33, gy: 0  },
  { name: 'house_v2',      gx: 36, gy: 0  },
  { name: 'house_v2',      gx: 29, gy: 4  },
  { name: 'house_v2',      gx: 32, gy: 4  },
  { name: 'apartment',     gx: 36, gy: 4  },
  { name: 'house_v2',      gx: 29, gy: 7  },
  { name: 'house_v2',      gx: 32, gy: 7  },
  { name: 'house_v2',      gx: 36, gy: 7  },

  // B(3,0) — Residential
  { name: 'house_v2',      gx: 43, gy: 0  },
  { name: 'house_v2',      gx: 46, gy: 0  },
  { name: 'apartment',     gx: 43, gy: 3  },
  { name: 'house_v2',      gx: 46, gy: 3  },
  { name: 'house_v2',      gx: 43, gy: 6  },
  { name: 'house_v2',      gx: 46, gy: 6  },

  // B(0,1) — Hospital + Residential
  { name: 'hospital',      gx: 0,  gy: 15 },
  { name: 'house_v2',      gx: 4,  gy: 15 },
  { name: 'house_v2',      gx: 7,  gy: 15 },
  { name: 'house_v2',      gx: 4,  gy: 18 },
  { name: 'house_v2',      gx: 7,  gy: 18 },
  { name: 'house_v2',      gx: 0,  gy: 19 },
  { name: 'restaurant',    gx: 4,  gy: 20 },
  { name: 'apartment',     gx: 0,  gy: 22 },
  { name: 'house_v2',      gx: 4,  gy: 22 },
  { name: 'house_v2',      gx: 7,  gy: 22 },

  // B(1,1) — Civic center: fire + police + park + grocery
  { name: 'fire_station',  gx: 15, gy: 15 },
  { name: 'police_station',gx: 20, gy: 15 },
  { name: 'park',          gx: 15, gy: 20 },
  { name: 'grocery_store', gx: 20, gy: 20 },
  { name: 'house_v2',      gx: 15, gy: 23 },
  { name: 'house_v2',      gx: 18, gy: 23 },
  { name: 'apartment',     gx: 22, gy: 23 },

  // B(2,1) — Residential + Commercial
  { name: 'apartment',     gx: 29, gy: 15 },
  { name: 'restaurant',    gx: 32, gy: 15 },
  { name: 'apartment',     gx: 35, gy: 15 },
  { name: 'house_v2',      gx: 29, gy: 18 },
  { name: 'house_v2',      gx: 32, gy: 18 },
  { name: 'house_v2',      gx: 36, gy: 18 },
  { name: 'house_v2',      gx: 29, gy: 22 },
  { name: 'house_v2',      gx: 32, gy: 22 },
  { name: 'apartment',     gx: 35, gy: 22 },

  // B(3,1) — Residential
  { name: 'apartment',     gx: 43, gy: 15 },
  { name: 'house_v2',      gx: 46, gy: 15 },
  { name: 'house_v2',      gx: 43, gy: 18 },
  { name: 'house_v2',      gx: 46, gy: 18 },
  { name: 'house_v2',      gx: 43, gy: 22 },
  { name: 'restaurant',    gx: 46, gy: 22 },

  // B(0,2) — Residential + Park
  { name: 'house_v2',      gx: 0,  gy: 29 },
  { name: 'park',          gx: 4,  gy: 29 },
  { name: 'house_v2',      gx: 8,  gy: 29 },
  { name: 'house_v2',      gx: 0,  gy: 32 },
  { name: 'apartment',     gx: 4,  gy: 33 },
  { name: 'house_v2',      gx: 8,  gy: 32 },
  { name: 'house_v2',      gx: 0,  gy: 36 },
  { name: 'house_v2',      gx: 4,  gy: 36 },
  { name: 'house_v2',      gx: 8,  gy: 36 },

  // B(1,2) — Hospital + School
  { name: 'hospital',      gx: 15, gy: 29 },
  { name: 'school',        gx: 20, gy: 29 },
  { name: 'house_v2',      gx: 15, gy: 33 },
  { name: 'house_v2',      gx: 18, gy: 33 },
  { name: 'apartment',     gx: 21, gy: 33 },
  { name: 'house_v2',      gx: 15, gy: 36 },
  { name: 'house_v2',      gx: 19, gy: 36 },
  { name: 'house_v2',      gx: 22, gy: 36 },

  // B(2,2) — Commercial hub
  { name: 'grocery_store', gx: 29, gy: 29 },
  { name: 'restaurant',    gx: 33, gy: 29 },
  { name: 'apartment',     gx: 36, gy: 29 },
  { name: 'park',          gx: 29, gy: 33 },
  { name: 'house_v2',      gx: 33, gy: 32 },
  { name: 'house_v2',      gx: 36, gy: 32 },
  { name: 'house_v2',      gx: 33, gy: 36 },
  { name: 'apartment',     gx: 36, gy: 36 },

  // B(3,2) — Residential
  { name: 'house_v2',      gx: 43, gy: 29 },
  { name: 'house_v2',      gx: 46, gy: 29 },
  { name: 'apartment',     gx: 43, gy: 32 },
  { name: 'house_v2',      gx: 46, gy: 32 },
  { name: 'house_v2',      gx: 43, gy: 36 },
  { name: 'house_v2',      gx: 46, gy: 36 },

  // B(0,3) — Power plant + Residential
  { name: 'power_plant',   gx: 0,  gy: 43 },
  { name: 'house_v2',      gx: 4,  gy: 43 },
  { name: 'house_v2',      gx: 7,  gy: 43 },
  { name: 'house_v2',      gx: 0,  gy: 47 },
  { name: 'house_v2',      gx: 4,  gy: 47 },
  { name: 'house_v2',      gx: 7,  gy: 47 },

  // B(1,3) — School + Residential
  { name: 'school',        gx: 15, gy: 43 },
  { name: 'house_v2',      gx: 19, gy: 43 },
  { name: 'house_v2',      gx: 22, gy: 43 },
  { name: 'house_v2',      gx: 15, gy: 47 },
  { name: 'apartment',     gx: 19, gy: 47 },
  { name: 'house_v2',      gx: 22, gy: 47 },

  // B(2,3) — Fire station + Residential
  { name: 'fire_station',  gx: 29, gy: 43 },
  { name: 'house_v2',      gx: 33, gy: 43 },
  { name: 'house_v2',      gx: 36, gy: 43 },
  { name: 'house_v2',      gx: 29, gy: 47 },
  { name: 'house_v2',      gx: 33, gy: 47 },
  { name: 'apartment',     gx: 36, gy: 47 },

  // B(3,3) — Power plant + Residential
  { name: 'power_plant',   gx: 44, gy: 43 },
  { name: 'house_v2',      gx: 43, gy: 47 },
  { name: 'house_v2',      gx: 46, gy: 47 },
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

      // Load all textures
      const tileTex: Record<string, ReturnType<typeof Assets.load> extends Promise<infer T> ? T : never> = {};
      const propTex: typeof tileTex = {};

      await Promise.all([
        ...Object.entries(TILE_TEXTURES).map(async ([k, p]) => { tileTex[k] = await Assets.load(p); }),
        ...Object.entries(PROPERTY_TEXTURES).map(async ([k, v]) => { propTex[k] = await Assets.load(v.path); }),
      ]);

      if (destroyed) { app.destroy(true); return; }

      // World container — all sprites go here, we pan/zoom this
      const world = new Container();
      app.stage.addChild(world);

      // Start camera centered on the middle of the grid
      const { x: cx, y: cy } = gridToScreen(GRID_SIZE / 2, GRID_SIZE / 2);
      world.x = app.screen.width / 2 - cx;
      world.y = app.screen.height / 2 - cy;

      const grid = buildTestGrid();

      // --- Tile layer ---
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const cell = grid[gy][gx];
          if (cell.type !== 'tile') continue;
          const tex = tileTex[cell.name];
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

      // --- Property layer (rendered after tiles so they appear on top) ---
      const sortedProps = [...testProps].sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
      for (const { name, gx, gy } of sortedProps) {
        const meta = PROPERTY_TEXTURES[name];
        const tex = propTex[name];
        if (!meta || !tex) continue;

        const { x, y } = gridToScreen(gx, gy);
        const cfg = PROP_RENDER[name] ?? { offsetX: 0, offsetY: 0, scale: 1 };
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5, 0);
        sprite.width = meta.size * TILE_W * cfg.scale;
        sprite.scale.y = sprite.scale.x;
        sprite.x = x + cfg.offsetX;
        sprite.y = y - (meta.size - 1) * TILE_H + cfg.offsetY;
        world.addChild(sprite);
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

        // Zoom toward mouse position
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
