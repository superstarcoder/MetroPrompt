'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { CODE_TO_TILE, TILE_META } from '@/lib/all_types';
import type { City, Nature, Person, Property } from '@/lib/all_types';
import { CITIZEN_RENDER, FIRE_TRUCK_RENDER, PROP_RENDER, TILE_RENDER } from '@/lib/renderConfig';
import { SIMULATION } from '@/lib/sim/constants';
import { GRID_SIZE, TILE_H, TILE_W, gridToScreen } from './constants';
import {
  ALL_NATURE_IMAGES,
  ALL_PROP_IMAGES,
  ALL_TILE_IMAGES,
  FIRE_TRUCK_IMAGES,
  citizenDirection,
  renderKey,
} from './imageHelpers';
import type { TruckDirection } from './imageHelpers';
import type { FireTruck } from './useSimulation';
import {
  CITIZEN_IMAGE_FRONT,
  CITIZEN_FRAME_COUNT,
  CITIZEN_FRAMES_NE,
  CITIZEN_FRAMES_NW,
  CITIZEN_FRAMES_SE,
  CITIZEN_FRAMES_SW,
} from '@/lib/all_types';
import type { CitizenDirection } from './imageHelpers';
import { entityAt, isPlacementValid, screenToGrid } from './hitTesting';
import type { EntityDragState, SelectedEntity } from './hitTesting';

type Args = {
  mountRef: RefObject<HTMLDivElement | null>;
  cityRef: RefObject<City>;
  deleteBtnRef: RefObject<HTMLButtonElement | null>;
  showGrid: boolean;
  // Editor refs (owned by parent so palette drop / delete button can mutate them too).
  editableRef: RefObject<boolean>;
  hoveredEntityRef: RefObject<SelectedEntity | null>;
  selectedEntityRef: RefObject<SelectedEntity | null>;
  entityDragRef: RefObject<EntityDragState | null>;
  onCityChangeRef: RefObject<((city: City) => void) | undefined>;
  setSelectedEntity: (e: SelectedEntity | null) => void;
  // Sim/citizens
  selectedCitizenRef: RefObject<Person | null>;
  setSelectedCitizen: (p: Person | null) => void;
  tickStartedAtRef: RefObject<number>;
  // Fire truck — read-only for the renderer; useSimulation owns mutation.
  activeFireTruckRef: RefObject<FireTruck | null>;
};

type Result = {
  scheduleRender: () => void;
  // Exposed so palette drag can read world.x/y/scale for screen↔grid math.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worldRef: RefObject<any>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTex = any;

// Maps a walking direction to its 6-frame PNG sequence (split from the
// original GIFs for native Pixi support).
const CITIZEN_FRAMES_BY_DIR: Record<Exclude<CitizenDirection, 'idle'>, string[]> = {
  NE: CITIZEN_FRAMES_NE,
  NW: CITIZEN_FRAMES_NW,
  SE: CITIZEN_FRAMES_SE,
  SW: CITIZEN_FRAMES_SW,
};

// Walking-cycle frame duration in ms. ~125ms gives ~8 frames/sec, a natural
// step pace. All same-direction citizens animate in sync — derived from
// `Date.now()` rather than per-citizen state.
const CITIZEN_FRAME_DURATION_MS = 125;

// Owns the Pixi.js scene: app/world/layers, texture preload, the painter loop
// (`scheduleRender`), pan/zoom, edit-mode hover/click/drag pointer plumbing,
// the floating delete-button anchor, AND citizen rendering (painter-sorted with
// properties + nature so depth-based occlusion works).
//
// Citizens use a canvas-snapshot trick for GIF animation: hidden DOM <img>
// elements animate the source GIFs natively, an offscreen canvas redraws the
// current frame each Pixi tick via drawImage, and Pixi sources its texture
// from the canvas. Five textures total (one per direction + idle PNG).
export function useCityScene({
  mountRef,
  cityRef,
  deleteBtnRef,
  showGrid,
  editableRef,
  hoveredEntityRef,
  selectedEntityRef,
  entityDragRef,
  onCityChangeRef,
  setSelectedEntity,
  selectedCitizenRef,
  setSelectedCitizen,
  tickStartedAtRef,
  activeFireTruckRef,
}: Args): Result {
  const pixiModRef = useRef<AnyTex>(null);
  const worldRef = useRef<AnyTex>(null);
  const spritesLayerRef = useRef<AnyTex>(null);
  const highlightLayerRef = useRef<AnyTex>(null);
  const appRef = useRef<AnyTex>(null);
  const tileTexRef = useRef<Record<string, AnyTex>>({});
  const propTexRef = useRef<Record<string, AnyTex>>({});
  const natureTexRef = useRef<Record<string, AnyTex>>({});
  // Citizen textures. `idle` is the static front PNG. Each walking direction
  // is an array of 6 frame textures cycled by global Date.now()-derived index.
  const citizenIdleTexRef = useRef<AnyTex>(null);
  const citizenFrameTexRef = useRef<Record<Exclude<CitizenDirection, 'idle'>, AnyTex[]>>({
    NE: [], NW: [], SE: [], SW: [],
  });
  // Fire truck textures, one per direction. Preloaded alongside the rest.
  const fireTruckTexRef = useRef<Record<TruckDirection, AnyTex>>({
    NE: null, NW: null, SE: null, SW: null,
  });
  // Bounding boxes of rendered citizen sprites in screen coords, captured each
  // doRender. Used by the mount-level pointerdown handler to detect citizen
  // clicks before falling through to the panning gesture.
  const citizenHitsRef = useRef<Array<{ citizen: Person; left: number; top: number; right: number; bottom: number }>>([]);
  const texturesReadyRef = useRef(false);
  const rafHandleRef = useRef<number | null>(null);
  const gridLinesRef = useRef<AnyTex>(null);

  const doRender = useCallback(() => {
    const mod = pixiModRef.current;
    const spritesLayer = spritesLayerRef.current;
    const highlightLayer = highlightLayerRef.current;
    const world = worldRef.current;
    if (!mod || !spritesLayer || !world || !texturesReadyRef.current) return;
    const { Sprite } = mod;
    const city = cityRef.current;
    const tileTex = tileTexRef.current;
    const propTex = propTexRef.current;
    const natureTex = natureTexRef.current;
    const citizenIdleTex = citizenIdleTexRef.current;
    const citizenFrameTex = citizenFrameTexRef.current;
    // Global walking-cycle frame index — all same-direction citizens use the
    // same frame each render, so the loop stays cheap.
    const animFrame = Math.floor(Date.now() / CITIZEN_FRAME_DURATION_MS) % CITIZEN_FRAME_COUNT;
    const drag = entityDragRef.current;
    const dragEntity = drag?.sel.data ?? null;
    const hovered = hoveredEntityRef.current;
    const selected = selectedEntityRef.current;
    const selectedCitizen = selectedCitizenRef.current;

    // Lerp progress for citizen movement.
    const tickStarted = tickStartedAtRef.current;
    const elapsed = tickStarted > 0 ? Date.now() - tickStarted : Number.POSITIVE_INFINITY;
    const progress = Math.max(0, Math.min(1, elapsed / SIMULATION.tick_interval_ms));

    spritesLayer.removeChildren();
    if (highlightLayer) highlightLayer.removeChildren();
    citizenHitsRef.current.length = 0;

    const addHighlightCopy = (srcSprite: AnyTex, tex: AnyTex, color: number, alpha: number) => {
      if (!highlightLayer) return;
      const copy = new Sprite(tex);
      copy.anchor.copyFrom(srcSprite.anchor);
      copy.scale.copyFrom(srcSprite.scale);
      copy.x = srcSprite.x;
      copy.y = srcSprite.y;
      copy.tint = color;
      copy.alpha = alpha;
      copy.blendMode = 'screen';
      highlightLayer.addChild(copy);
    };

    const highlightFor = (entity: Property | Nature): { color: number; alpha: number } | null => {
      if (drag) return null;
      if (selected && selected.data === entity) return { color: 0xffff00, alpha: 0.55 };
      if (hovered && hovered.data === entity && hovered.data !== selected?.data) {
        return { color: 0xffffff, alpha: 0.4 };
      }
      return null;
    };

    // Pass 1 — tiles (ground layer; always behind everything else).
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
        sprite.scale.set((TILE_W / tex.width) * cfg.scale);
        sprite.x = x + cfg.offsetX;
        sprite.y = y + cfg.offsetY;
        spritesLayer.addChild(sprite);
      }
    }

    // Pass 2 — nature, properties, citizens, and the fire truck, painter-sorted
    // by depth (x+y of anchor / lerped position).
    type Drawable =
      | { kind: 'nature'; data: Nature; depth: number }
      | { kind: 'property'; data: Property; depth: number }
      | { kind: 'citizen'; data: Person; depth: number; gx: number; gy: number; direction: CitizenDirection }
      | { kind: 'fire_truck'; depth: number; gx: number; gy: number; direction: TruckDirection };

    const drawables: Drawable[] = [];
    for (const n of city.all_nature) {
      drawables.push({ kind: 'nature', data: n, depth: n.position.x + n.position.y });
    }
    for (const p of city.all_properties) {
      // Use the depth of the NE-most cell on the building's back (anchor) row
      // rather than the anchor itself. Citizens on any row passing through
      // the footprint then draw BEFORE the building, fixing the case where
      // citizens at e.g. (anchor_x+2, anchor_y-1) were tying / beating the
      // anchor depth and rendering on top of a building they should be behind.
      drawables.push({
        kind: 'property',
        data: p,
        depth: p.position.x + p.position.y + Math.max(p.width - 1, p.height - 1),
      });
    }
    for (const c of city.all_citizens) {
      // Citizens inside a property are not visible from the city — they
      // reappear at the entry tile when their stay expires.
      if (c.inside_property) continue;
      const isSelected = c === selectedCitizen;
      const prev = c.prev_location ?? c.current_location;
      const cur = c.current_location;
      let gx: number;
      let gy: number;
      let direction: CitizenDirection;
      if (isSelected && c.visual_position) {
        // Frozen at the mid-lerp position captured when the user clicked.
        gx = c.visual_position.x;
        gy = c.visual_position.y;
        direction = 'idle';
      } else if (isSelected) {
        gx = cur.x;
        gy = cur.y;
        direction = 'idle';
      } else {
        // Segment-by-segment lerp through `tick_path`. Citizens advance up
        // to WALK_CELLS_PER_TICK cells per logical tick, so a single
        // straight prev → cur lerp would cut corners (turning the path
        // diagonal at sidewalk/crosswalk transitions). We split the
        // [0..1] tick progress evenly across the cells walked this tick
        // and lerp within whichever segment we're currently in.
        const tp = c.tick_path;
        if (tp && tp.length > 0) {
          const segCount = tp.length;
          const segIdx = Math.min(segCount - 1, Math.floor(progress * segCount));
          const segT = progress * segCount - segIdx;
          let segStart = segIdx === 0 ? prev : tp[segIdx - 1];
          const segEnd = tp[segIdx];
          // Defensive: if seg 0's start (prev_location) is more than one cell
          // from tp[0], the citizen would otherwise slide diagonally across
          // multiple cells. Snap segStart to segEnd so they appear at tp[0]
          // for the duration of seg 0 instead of cutting across the grid.
          if (segIdx === 0 && Math.abs(segStart.x - segEnd.x) + Math.abs(segStart.y - segEnd.y) > 1) {
            segStart = segEnd;
          }
          gx = segStart.x + (segEnd.x - segStart.x) * segT;
          gy = segStart.y + (segEnd.y - segStart.y) * segT;
          direction = citizenDirection(segStart, segEnd);
        } else {
          // No movement this tick (idle or just spawned). Stand still.
          gx = cur.x;
          gy = cur.y;
          direction = 'idle';
        }
      }
      drawables.push({ kind: 'citizen', data: c, depth: gx + gy, gx, gy, direction });
    }

    // Fire truck (single, optional). Drawn at its lerped sub-tile position.
    const truck = activeFireTruckRef.current;
    if (truck) {
      const tgx = truck.visualPosition.x;
      const tgy = truck.visualPosition.y;
      drawables.push({
        kind: 'fire_truck',
        depth: tgx + tgy,
        gx: tgx,
        gy: tgy,
        direction: truck.direction,
      });
    }

    drawables.sort((a, b) => a.depth - b.depth);

    for (const d of drawables) {
      if (d.kind === 'property') {
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
        if (dragEntity === p) {
          sprite.tint = drag!.valid ? 0x88ff88 : 0xff8888;
          sprite.alpha = 0.85;
        }
        spritesLayer.addChild(sprite);
        const hl = highlightFor(p);
        if (hl) addHighlightCopy(sprite, tex, hl.color, hl.alpha);
      } else if (d.kind === 'nature') {
        const n = d.data;
        const tex = natureTex[n.image];
        if (!tex) continue;
        const { x, y } = gridToScreen(n.position.x, n.position.y);
        const cfg = TILE_RENDER[renderKey(n.image)] ?? { offsetX: 0, offsetY: 0, scale: 1 };
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5, 0);
        sprite.scale.set((TILE_W / tex.width) * cfg.scale);
        sprite.x = x + cfg.offsetX;
        sprite.y = y + cfg.offsetY;
        if (dragEntity === n) {
          sprite.tint = drag!.valid ? 0x88ff88 : 0xff8888;
          sprite.alpha = 0.85;
        }
        spritesLayer.addChild(sprite);
        const hl = highlightFor(n);
        if (hl) addHighlightCopy(sprite, tex, hl.color, hl.alpha);
      } else if (d.kind === 'fire_truck') {
        const tex = fireTruckTexRef.current[d.direction];
        if (!tex) continue;
        const { x, y } = gridToScreen(d.gx, d.gy);
        const cfg = FIRE_TRUCK_RENDER;
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5, 0);
        sprite.scale.set((TILE_W / tex.width) * cfg.scale);
        sprite.x = x + cfg.offsetX;
        sprite.y = y + cfg.offsetY;
        spritesLayer.addChild(sprite);
      } else if (d.kind === 'citizen') {
        const c = d.data;
        const tex = d.direction === 'idle'
          ? citizenIdleTex
          : (citizenFrameTex[d.direction]?.[animFrame] ?? citizenIdleTex);
        if (!tex) continue;
        const { x, y } = gridToScreen(d.gx, d.gy);
        const cfg = CITIZEN_RENDER.man_front;
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5, 0);
        sprite.scale.set((TILE_W / tex.width) * cfg.scale);
        sprite.x = x + cfg.offsetX;
        sprite.y = y + cfg.offsetY;
        spritesLayer.addChild(sprite);
        // Highlight the selected citizen with a yellow wash.
        if (c === selectedCitizen) {
          addHighlightCopy(sprite, tex, 0xffd700, 0.6);
        }
        // Capture screen-space bbox for the mount-level click handler. The
        // sprite is in world coords; transform to screen.
        const ws = world.scale.x;
        const screenX = sprite.x * ws + world.x;
        const screenY = sprite.y * ws + world.y;
        const screenW = sprite.width * ws;
        const screenH = sprite.height * ws;
        citizenHitsRef.current.push({
          citizen: c,
          left:   screenX - screenW / 2,
          top:    screenY,
          right:  screenX + screenW / 2,
          bottom: screenY + screenH,
        });
      }
    }
  }, [cityRef, entityDragRef, hoveredEntityRef, selectedEntityRef, selectedCitizenRef, tickStartedAtRef, activeFireTruckRef]);

  const scheduleRender = useCallback(() => {
    if (rafHandleRef.current != null) return;
    rafHandleRef.current = requestAnimationFrame(() => {
      rafHandleRef.current = null;
      doRender();
    });
  }, [doRender]);

  // Toggle the persistent grid overlay without rebuilding the scene.
  useEffect(() => {
    if (gridLinesRef.current) gridLinesRef.current.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    let destroyed = false;
    const cleanupFns: Array<() => void> = [];

    async function init() {
      const pixi = await import('pixi.js');
      pixiModRef.current = pixi;
      const { Application, Assets, Container, Graphics, TextureStyle } = pixi;
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
      appRef.current = app;

      // Citizen textures: idle PNG + 6-frame PNG sequences per walking direction.
      // All loaded through Assets.load alongside the rest of the static pool.
      const loadCitizenFrames = async (dir: Exclude<CitizenDirection, 'idle'>) => {
        const paths = CITIZEN_FRAMES_BY_DIR[dir];
        const textures = await Promise.all(paths.map(p => Assets.load(p)));
        citizenFrameTexRef.current[dir] = textures;
      };

      const loadFireTruck = async (dir: TruckDirection) => {
        fireTruckTexRef.current[dir] = await Assets.load(FIRE_TRUCK_IMAGES[dir]);
      };

      await Promise.all([
        ...ALL_TILE_IMAGES.map(async p => { tileTexRef.current[p] = await Assets.load(p); }),
        ...ALL_PROP_IMAGES.map(async p => { propTexRef.current[p] = await Assets.load(p); }),
        ...ALL_NATURE_IMAGES.map(async p => { natureTexRef.current[p] = await Assets.load(p); }),
        (async () => { citizenIdleTexRef.current = await Assets.load(CITIZEN_IMAGE_FRONT); })(),
        loadCitizenFrames('NE'),
        loadCitizenFrames('NW'),
        loadCitizenFrames('SE'),
        loadCitizenFrames('SW'),
        loadFireTruck('NE'),
        loadFireTruck('NW'),
        loadFireTruck('SE'),
        loadFireTruck('SW'),
      ]);
      if (destroyed) { app.destroy(true); return; }
      texturesReadyRef.current = true;

      const world = new Container();
      const spritesLayer = new Container();
      world.addChild(spritesLayer);
      app.stage.addChild(world);
      worldRef.current = world;
      spritesLayerRef.current = spritesLayer;

      const { x: cx, y: cy } = gridToScreen(GRID_SIZE / 2, GRID_SIZE / 2);
      world.x = app.screen.width / 2 - cx;
      world.y = app.screen.height / 2 - cy;

      const gridLines = new Graphics();
      for (let gy = 0; gy < GRID_SIZE; gy++) {
        for (let gx = 0; gx < GRID_SIZE; gx++) {
          const { x, y } = gridToScreen(gx, gy);
          gridLines
            .moveTo(x, y)
            .lineTo(x + TILE_W / 2, y + TILE_H / 2)
            .lineTo(x, y + TILE_H)
            .lineTo(x - TILE_W / 2, y + TILE_H / 2)
            .closePath();
        }
      }
      gridLines.stroke({ color: 0xff3333, width: 1, alpha: 0.8 });
      gridLines.visible = showGrid;
      gridLinesRef.current = gridLines;
      world.addChild(gridLines);

      const highlightLayer = new Container();
      world.addChild(highlightLayer);
      highlightLayerRef.current = highlightLayer;

      doRender();

      // Pointer state.
      let panning = false;
      let entityDragging = false;
      let pointerStartX = 0, pointerStartY = 0;
      let panLastX = 0, panLastY = 0;
      let pointerDownDidHitEntity = false;
      let pointerDownDidHitCitizen: Person | null = null;
      let pointerMoved = false;
      const CLICK_PIXEL_THRESHOLD = 4;

      const hitTestCitizen = (sx: number, sy: number): Person | null => {
        // Citizens are drawn in painter order (low depth → high depth). Iterate
        // in reverse to return the visually top-most hit.
        const hits = citizenHitsRef.current;
        for (let i = hits.length - 1; i >= 0; i--) {
          const h = hits[i];
          if (sx >= h.left && sx <= h.right && sy >= h.top && sy <= h.bottom) {
            return h.citizen;
          }
        }
        return null;
      };

      mount.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-mayor-ui]')) return;

        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        pointerMoved = false;
        pointerDownDidHitEntity = false;
        pointerDownDidHitCitizen = null;

        // Citizen click takes precedence over panning and entity drag.
        const citizenHit = hitTestCitizen(e.clientX, e.clientY);
        if (citizenHit) {
          pointerDownDidHitCitizen = citizenHit;
          mount.style.cursor = 'pointer';
          return;
        }

        if (editableRef.current && selectedEntityRef.current) {
          const sel = selectedEntityRef.current;
          const cell = screenToGrid(e.clientX, e.clientY, world.x, world.y, world.scale.x);
          if (cell) {
            const hit = entityAt(cityRef.current, cell.gx, cell.gy);
            if (hit && hit.data === sel.data) {
              pointerDownDidHitEntity = true;
              entityDragging = true;
              entityDragRef.current = {
                sel,
                originalPos: { ...sel.data.position },
                valid: true,
                isNew: false,
              };
              mount.style.cursor = 'grabbing';
              scheduleRender();
              return;
            }
          }
        }

        panning = true;
        panLastX = e.clientX;
        panLastY = e.clientY;
        mount.style.cursor = 'grabbing';
      });

      mount.addEventListener('pointermove', (e) => {
        if (!pointerMoved) {
          const dx = e.clientX - pointerStartX;
          const dy = e.clientY - pointerStartY;
          if (dx * dx + dy * dy > CLICK_PIXEL_THRESHOLD * CLICK_PIXEL_THRESHOLD) {
            pointerMoved = true;
          }
        }

        if (panning) {
          world.x += e.clientX - panLastX;
          world.y += e.clientY - panLastY;
          panLastX = e.clientX;
          panLastY = e.clientY;
          return;
        }

        if (entityDragging && entityDragRef.current) {
          const drag = entityDragRef.current;
          const cell = screenToGrid(e.clientX, e.clientY, world.x, world.y, world.scale.x);
          if (!cell) return;
          const newPos = { x: cell.gx, y: cell.gy };
          if (drag.sel.data.position.x === newPos.x && drag.sel.data.position.y === newPos.y) return;
          drag.sel.data.position = newPos;
          drag.valid = isPlacementValid(cityRef.current, drag.sel, newPos);
          scheduleRender();
          return;
        }

        if (editableRef.current && e.buttons === 0) {
          const cell = screenToGrid(e.clientX, e.clientY, world.x, world.y, world.scale.x);
          const hit = cell ? entityAt(cityRef.current, cell.gx, cell.gy) : null;
          const prev = hoveredEntityRef.current;
          if ((prev?.data ?? null) !== (hit?.data ?? null)) {
            hoveredEntityRef.current = hit;
            mount.style.cursor = hit ? 'pointer' : 'grab';
            scheduleRender();
          }
        }
      });

      const finishPointer = (e: PointerEvent) => {
        if (entityDragRef.current?.isNew) return;

        // Citizen-click resolution: a no-drag pointerdown+up on a citizen
        // toggles their selection. Movement halts (handled by useSimulation
        // reading selectedCitizenRef on each tick).
        if (pointerDownDidHitCitizen && !pointerMoved) {
          const c = pointerDownDidHitCitizen;
          const prev = selectedCitizenRef.current;
          // Clear any prior selection's frozen visual position.
          if (prev && prev !== c && prev.visual_position) prev.visual_position = undefined;
          if (prev === c) {
            // Toggling off — citizen resumes normal lerp from current_location.
            c.visual_position = undefined;
            setSelectedCitizen(null);
          } else {
            // Selecting — capture the citizen's current mid-lerp position so
            // they freeze in place rather than snapping to current_location.
            const cPrev = c.prev_location ?? c.current_location;
            const cCur = c.current_location;
            const tickStarted = tickStartedAtRef.current;
            const elapsed = tickStarted > 0 ? Date.now() - tickStarted : Number.POSITIVE_INFINITY;
            const captureProgress = Math.max(0, Math.min(1, elapsed / SIMULATION.tick_interval_ms));
            c.visual_position = {
              x: cPrev.x + (cCur.x - cPrev.x) * captureProgress,
              y: cPrev.y + (cCur.y - cPrev.y) * captureProgress,
            };
            setSelectedCitizen(c);
          }
          // Also clear any property selection so popups don't double up.
          if (selectedEntityRef.current) setSelectedEntity(null);
          pointerDownDidHitCitizen = null;
          mount.style.cursor = 'grab';
          scheduleRender();
          return;
        }
        pointerDownDidHitCitizen = null;

        if (entityDragging && entityDragRef.current) {
          const drag = entityDragRef.current;
          if (!drag.valid) {
            drag.sel.data.position = drag.originalPos;
          } else {
            const moved =
              drag.originalPos.x !== drag.sel.data.position.x ||
              drag.originalPos.y !== drag.sel.data.position.y;
            if (moved) onCityChangeRef.current?.(cityRef.current);
          }
          entityDragRef.current = null;
          entityDragging = false;
          scheduleRender();
        }

        if (panning) {
          panning = false;
        }

        // Click-to-select runs in any mode so the property info popup works
        // outside edit mode too. Drag-to-move and the delete button remain
        // edit-mode-only (gated above and in the parent JSX).
        if (!pointerMoved && !pointerDownDidHitEntity) {
          const cell = screenToGrid(e.clientX, e.clientY, world.x, world.y, world.scale.x);
          const hit = cell ? entityAt(cityRef.current, cell.gx, cell.gy) : null;
          if (hit) {
            const sel = selectedEntityRef.current;
            if (sel?.data === hit.data) {
              setSelectedEntity(null);
            } else {
              setSelectedEntity(hit);
              // Clear any selected citizen so two popups never coexist.
              if (selectedCitizenRef.current) setSelectedCitizen(null);
            }
          } else {
            setSelectedEntity(null);
          }
          scheduleRender();
        }

        mount.style.cursor = 'grab';
      };

      window.addEventListener('pointerup', finishPointer);
      cleanupFns.push(() => window.removeEventListener('pointerup', finishPointer));
      mount.style.cursor = 'grab';

      // Position the HTML delete-button overlay each frame so it tracks pan/zoom.
      const repositionDeleteBtn = () => {
        const btn = deleteBtnRef.current;
        if (!btn) return;
        const sel = selectedEntityRef.current;
        if (!sel || entityDragRef.current) {
          if (btn.style.display !== 'none') btn.style.display = 'none';
          return;
        }
        const pos = sel.data.position;
        const w = sel.kind === 'property' ? sel.data.width  : 1;
        const h = sel.kind === 'property' ? sel.data.height : 1;
        const lastCellX = pos.x + w - 1;
        const lastCellY = pos.y + h - 1;
        const grid = gridToScreen(lastCellX, lastCellY);
        const sx = grid.x * world.scale.x + world.x;
        const sy = (grid.y + TILE_H) * world.scale.x + world.y;
        btn.style.display = 'flex';
        btn.style.left = `${sx}px`;
        btn.style.top = `${sy + 8}px`;
      };
      app.ticker.add(repositionDeleteBtn);
      cleanupFns.push(() => app.ticker.remove(repositionDeleteBtn));

      // Drive a per-frame repaint while citizens are alive — they need smooth
      // sub-tick interpolation AND the global walking-frame index advances
      // every CITIZEN_FRAME_DURATION_MS. Idle (no citizens) costs nothing.
      const animateCitizensTick = () => {
        if (cityRef.current.all_citizens.length > 0) {
          scheduleRender();
        }
      };
      app.ticker.add(animateCitizensTick);
      cleanupFns.push(() => app.ticker.remove(animateCitizensTick));

      // Zoom toward cursor.
      mount.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.max(0.2, Math.min(5, world.scale.x * factor));
        const mx = e.clientX; const my = e.clientY;
        const wx = (mx - world.x) / world.scale.x;
        const wy = (my - world.y) / world.scale.y;
        world.scale.set(newScale);
        world.x = mx - wx * newScale;
        world.y = my - wy * newScale;
      }, { passive: false });
    }

    init();

    return () => {
      destroyed = true;
      if (rafHandleRef.current != null) cancelAnimationFrame(rafHandleRef.current);
      for (const fn of cleanupFns) {
        try { fn(); } catch { /* ignore */ }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { scheduleRender, worldRef };
}
