'use client';

import { useEffect, useRef, useState } from 'react';
import { TILE_RENDER, PROP_RENDER } from '@/lib/renderConfig';
import {
  TREE_IMAGES,
  TILE_META,
  TILE_CODES,
  CODE_TO_TILE,
  asciiToCity,
  placeNature,
  getPropertyAt,
} from '@/lib/all_types';
import type { Property, Nature } from '@/lib/all_types';

const TILE_W = 64;
const TILE_H = 32;
const GRID_SIZE = 50;

function gridToScreen(gx: number, gy: number) {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  };
}

// Derives the PROP_RENDER / TILE_RENDER key from an image path.
// '/assets/apartment_v1_3_3.png' → 'apartment_v1'
// '/assets/tree_v3_1_1.png'      → 'tree_v3'
function renderKey(imagePath: string): string {
  const filename = imagePath.split('/').pop()!.replace('.png', '');
  return filename.replace(/_\d+_\d+$/, '');
}

// 50×50 test scene, defined as ASCII. Blocks separated by 2-wide roads ('==')
// flanked by sidewalks ('_'). Building chars stamp across the full footprint.
// Legend (mirrors ASCII_LEGEND in all_types.tsx):
//   . grass    _ sidewalk   = road   + intersection
//   D house(2x2)  A apartment(3x3)  O office(3x3)  R restaurant(2x2)
//   P park       S school          G grocery      H hospital
//   F fire_station  C police_station  E power_plant
//   M shopping_mall Z theme_park
const CITY_ASCII_old = [
  'DD........._==_SSS.AAADD._==_GGG.AAADD._==_DD.DD..',
  'DD........._==_SSS.AAADD._==_GGG.AAADD._==_DD.DD..',
  '..........._==_SSS.AAA..._==_GGG.AAA..._==_.......',
  '..........._==_.........._==_.........._==_AAADD..',
  '..........._==_DD.DD.DD.._==_DD.DD..AAA_==_AAADD..',
  '....RR....._==_DD.DD.DD.._==_DD.DD..AAA_==_AAA....',
  '....RR....._==_.........._==_.......AAA_==_DD.DD..',
  'AAA........_==_DD.RR..DD._==_DD.DD..DD._==_DD.DD..',
  'AAA........_==_DD.RR..DD._==_DD.DD..DD._==_.......',
  'AAA........_==_.........._==_.........._==_.......',
  '..........._==_.........._==_.........._==_.......',
  '____________==____________==____________==________',
  '============++============++============++========',
  '============++============++============++========',
  '____________==____________==____________==________',
  'HHH.DD.DD.._==_FFF..CCC.._==_AAARR.AAA._==_AAADD..',
  'HHH.DD.DD.._==_FFF..CCC.._==_AAARR.AAA._==_AAADD..',
  'HHH........_==_FFF..CCC.._==_AAA...AAA._==_AAA....',
  '....DD.DD.._==_.........._==_DD.DD..DD._==_DD.DD..',
  'DD..DD.DD.._==_.........._==_DD.DD..DD._==_DD.DD..',
  'DD..RR....._==_PPP..GGG.._==_.........._==_.......',
  '....RR....._==_PPP..GGG.._==_.........._==_.......',
  'AAA.DD.DD.._==_PPP..GGG.._==_DD.DD.AAA._==_DD.RR..',
  'AAA.DD.DD.._==_DD.DD..AAA_==_DD.DD.AAA._==_DD.RR..',
  'AAA........_==_DD.DD..AAA_==_......AAA._==_.......',
  '____________==________AAA_==____________==________',
  '============++============++============++========',
  '============++============++============++========',
  '____________==____________==____________==________',
  'DD..PPP.DD._==_HHH..SSS.._==_OOO.OOOAAA_==_DD.DD..',
  'DD..PPP.DD._==_HHH..SSS.._==_OOO.OOOAAA_==_DD.DD..',
  '....PPP...._==_HHH..SSS.._==_OOO.OOOAAA_==_.......',
  'DD......DD._==_.........._==_....DD.DD._==_AAADD..',
  'DD..AAA.DD._==_DD.DD.AAA._==_PPP.DD.DD._==_AAADD..',
  '....AAA...._==_DD.DD.AAA._==_PPP......._==_AAA....',
  '....AAA...._==_......AAA._==_PPP......._==_.......',
  'DD..DD..DD._==_DD..DD.DD._==_....DD.AAA_==_DD.DD..',
  'DD..DD..DD._==_DD..DD.DD._==_....DD.AAA_==_DD.DD..',
  '..........._==_.........._==_.......AAA_==_.......',
  '____________==____________==____________==________',
  '============++============++============++========',
  '============++============++============++========',
  '____________==____________==____________==________',
  'EEE.DD.DD.._==_SSS.DD.DD._==_FFF.DD.DD._==_.EEE...',
  'EEE.DD.DD.._==_SSS.DD.DD._==_FFF.DD.DD._==_.EEE...',
  'EEE........_==_SSS......._==_FFF......._==_.EEE...',
  '..........._==_.........._==_.........._==_.......',
  'DD..DD.DD.._==_DD..AAADD._==_DD..DD.AAA_==_DD.DD..',
  'DD..DD.DD.._==_DD..AAADD._==_DD..DD.AAA_==_DD.DD..',
  '..........._==_....AAA..._==_.......AAA_==_.......',
].join('\n');

const CITY_ASCII = `EEE.f..t.b..___================___.f..t....f..b..
EEE..f...f..___================___t..f..b....f..t
EEE.t..b...f______________________________f..t.b.
.tf..b..f.t.___________RR_________________.b.f..t
..f.b..t.f..___________RR_________________f.t.b.f
DD.DD.DD.DD_____=================____DD.DD.DD.DD.
DD.DD.DD.DD_____=================____DD.DD.DD.DD.
f.t..b..f.t........................t.b.f..t.b.f..
DD.AAA.DD..x____=================____DD.AAA.DD..f
DD.AAA.DD.f_____=================____DD.AAA.DD.t.
f..AAA..b.t.___________RR_______________AAA.b.t..
.t.f..b.f...___________RR_________________.f.t.b.
_________________________________________________
======================++=========================
======================++=========================
_________________________________________________
b.f..t.f.b..______________________________t.f.b..
DD.DD.AAA.._____=================_____DD.DD.DD.b.
DD.DD.AAA.._____=================_____DD.DD.DD.f.
f.b.t.AAA...x____===============____x.t.b.f..t..b
.t.f..b..f..______________________________f.b.t.f
...PPP.tfb._____===============_____.PPP.f.b.t.f.
t.fPPPb.ft._____FFF.HHH.CCC.===_____bPPPt.f.b..ft
..bPPP.tf...____FFF.HHH.CCC.===_____fPPPb..t.f.b.
f.t.b..f.t..____FFF.HHH.CCC.===_____.t.f..b.t.f..
DD.DD.b.f.t.____===============_____.f.b.t.f.DD..
DD.DD..bf...____===============_____.b.t.f.b.DD..
.t.f.b..f.t.____SSS.GGG.OOO.===_____..t.f.b.f..t.
..b.ft.b.f..____SSS.GGG.OOO.===_____t.DD.DD.DD.b.
AAA.DD.f.b..____SSS.GGG.OOO.===_____f.DD.DD.DD.f.
AAA.DD.t.f..____===============_____b.t.f.b.t.f..
AAA..f.b.t.._____RR_________________.....f.b.t..f
f.b.t.f..b.._____RR________________.f...t.b.f..tb
_________________________________________________
======================++=========================
======================++=========================
_________________________________________________
f.b.t.f.b.t.______________________________b.t.f.b
DD.DD.AAA.f._____================_____DD.DD.DD.t.
DD.DD.AAA.t._____================_____DD.DD.DD.f.
.f.b..AAA..x____================____x..b.t.f.b..f
t.f..b.f..t.______________________________t.f..bt
..fMMM.b.ft.___________RR_________________.PPP.f.
.tbMMMf.b.t.___________RR_________________tPPPb..
f.tMMMb.t.f.___________RR_________________fPPP.tb
.b.f.t.f..b.___________RR_________________b.f.t.f
DD.DD.bft...___________RR_________________DD.DD..
DD.DD..f.b.t___________RR_________________DD.DD.f
.t.f..b.t.f.___________RR_________________.t.f.b.
AAA.DD.DD.tf___________RR_________________AAA.DD.
AAA.DD.DD.bt___________RR_________________AAA.DD.
AAA..t.b.f..___________RR_________________AAA.f.b`

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

      // ---- Build the city straight from ASCII ----
      const city = asciiToCity(CITY_ASCII, { variantStrategy: 'random' });

      // // Nature — sprinkle on grass cells that aren't under a property footprint
      // for (let gy = 0; gy < GRID_SIZE; gy++) {
      //   for (let gx = 0; gx < GRID_SIZE; gx++) {
      //     if (city.tile_grid[gy][gx] !== TILE_CODES.grass) continue;
      //     if (getPropertyAt(city, { x: gx, y: gy })) continue;
      //     const r = Math.random();
      //     if (r < 0.04) {
      //       placeNature(city, { name: 'tree', position: { x: gx, y: gy }, image: TREE_IMAGES[Math.floor(Math.random() * TREE_IMAGES.length)] });
      //     } else if (r < 0.08) {
      //       placeNature(city, { name: 'flower_patch', position: { x: gx, y: gy }, image: '/assets/flower_patch_v1_1_1.png' });
      //     } else if (r < 0.10) {
      //       placeNature(city, { name: 'bush', position: { x: gx, y: gy }, image: '/assets/bush_v1_1_1.png' });
      //     }
      //   }
      // }

      // ---- Load textures ----
      const tileTex: Record<string, any> = {};
      const propTex: Record<string, any> = {};
      const natureTex: Record<string, any> = {};

      const uniqueTilePaths = [...new Set(Object.values(TILE_META).map(m => m.image))];
      const uniquePropImages = [...new Set(city.all_properties.map(p => p.image))];
      const uniqueNaturePaths = [...new Set(city.all_nature.map(n => n.image))];

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

      // --- Pass 1: tiles (ground layer) ---
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const code = city.tile_grid[gy][gx];
          const tileName = CODE_TO_TILE[code];
          if (!tileName) continue;
          const meta = TILE_META[tileName];
          const tex = tileTex[meta.image];
          if (!tex) continue;
          const { x, y } = gridToScreen(gx, gy);
          const cfg = TILE_RENDER[tileName] ?? { offsetX: 0, offsetY: 0, scale: 1 };
          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5, 0);
          sprite.scale.set((TILE_W / (tex as any).width) * cfg.scale);
          sprite.x = x + cfg.offsetX;
          sprite.y = y + cfg.offsetY;
          world.addChild(sprite);
        }
      }

      // --- Pass 2: nature + properties, painter-sorted by (x + y) of anchor ---
      type Drawable = { kind: 'nature'; data: Nature } | { kind: 'property'; data: Property };
      const drawables: Drawable[] = [
        ...city.all_nature.map<Drawable>(n => ({ kind: 'nature', data: n })),
        ...city.all_properties.map<Drawable>(p => ({ kind: 'property', data: p })),
      ];
      drawables.sort((a, b) =>
        (a.data.position.x + a.data.position.y) - (b.data.position.x + b.data.position.y)
      );

      for (const d of drawables) {
        if (d.kind === 'nature') {
          const n = d.data;
          const tex = natureTex[n.image];
          if (!tex) continue;
          const { x, y } = gridToScreen(n.position.x, n.position.y);
          const cfg = TILE_RENDER[renderKey(n.image)] ?? { offsetX: 0, offsetY: 0, scale: 1 };
          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5, 0);
          sprite.scale.set((TILE_W / (tex as any).width) * cfg.scale);
          sprite.x = x + cfg.offsetX;
          sprite.y = y + cfg.offsetY;
          world.addChild(sprite);
        } else {
          const p = d.data;
          const tex = propTex[p.image];
          if (!tex) continue;
          const { x, y } = gridToScreen(p.position.x, p.position.y);
          const cfg = PROP_RENDER[renderKey(p.image)] ?? { offsetX: 0, offsetY: 0, scale: 1 };
          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5, 0);
          sprite.width = p.width * TILE_W * cfg.scale;
          sprite.scale.y = sprite.scale.x;
          sprite.x = x + cfg.offsetX;
          sprite.y = y - (p.width - 1) * TILE_H + cfg.offsetY;
          world.addChild(sprite);
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
