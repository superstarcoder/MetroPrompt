'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { CODE_TO_TILE, TILE_META } from '@/lib/all_types';
import type { City, Nature, Property } from '@/lib/all_types';
import { PROP_RENDER, TILE_RENDER } from '@/lib/renderConfig';
import { GRID_SIZE, TILE_H, TILE_W, gridToScreen } from './constants';
import {
  ALL_NATURE_IMAGES,
  ALL_PROP_IMAGES,
  ALL_TILE_IMAGES,
  renderKey,
} from './imageHelpers';
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
};

type Result = {
  scheduleRender: () => void;
  // Exposed so palette drag can read world.x/y/scale for screen↔grid math.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worldRef: RefObject<any>;
};

// Owns the Pixi.js scene: app/world/layers, texture preload, the painter loop
// (`scheduleRender`), pan/zoom, edit-mode hover/click/drag pointer plumbing,
// and the floating delete-button anchor. Knows nothing about the agent SSE
// stream or the chat panel — citizens / simulation will plug in here later.
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
}: Args): Result {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pixiModRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worldRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spritesLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const highlightLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tileTexRef = useRef<Record<string, any>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const propTexRef = useRef<Record<string, any>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const natureTexRef = useRef<Record<string, any>>({});
  const texturesReadyRef = useRef(false);
  const rafHandleRef = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gridLinesRef = useRef<any>(null);

  const doRender = useCallback(() => {
    const mod = pixiModRef.current;
    const spritesLayer = spritesLayerRef.current;
    const highlightLayer = highlightLayerRef.current;
    if (!mod || !spritesLayer || !texturesReadyRef.current) return;
    const { Sprite } = mod;
    const city = cityRef.current;
    const tileTex = tileTexRef.current;
    const propTex = propTexRef.current;
    const natureTex = natureTexRef.current;
    const drag = entityDragRef.current;
    const dragEntity = drag?.sel.data ?? null;
    const hovered = hoveredEntityRef.current;
    const selected = selectedEntityRef.current;

    spritesLayer.removeChildren();
    if (highlightLayer) highlightLayer.removeChildren();

    // Spawn a tinted copy of `srcSprite` into the topmost highlight layer.
    // Uses screen blend so the underlying sprite shows through with a wash.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addHighlightCopy = (srcSprite: any, tex: any, color: number, alpha: number) => {
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
      if (drag) return null; // suppressed during drag — green/red tint on the sprite handles it
      if (selected && selected.data === entity) return { color: 0xffff00, alpha: 0.55 }; // yellow
      if (hovered && hovered.data === entity && hovered.data !== selected?.data) {
        return { color: 0xffffff, alpha: 0.4 }; // soft white
      }
      return null;
    };

    // Pass 1 — tiles (ground layer).
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sprite.scale.set((TILE_W / (tex as any).width) * cfg.scale);
        sprite.x = x + cfg.offsetX;
        sprite.y = y + cfg.offsetY;
        spritesLayer.addChild(sprite);
      }
    }

    // Pass 2 — nature + properties, painter-sorted by (x + y) of anchor.
    type Drawable = { kind: 'nature'; data: Nature } | { kind: 'property'; data: Property };
    const drawables: Drawable[] = [
      ...city.all_nature.map<Drawable>(n => ({ kind: 'nature', data: n })),
      ...city.all_properties.map<Drawable>(p => ({ kind: 'property', data: p })),
    ];
    drawables.sort((a, b) =>
      (a.data.position.x + a.data.position.y) - (b.data.position.x + b.data.position.y)
    );
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
      }
      if (d.kind === 'nature') {
        const n = d.data;
        const tex = natureTex[n.image];
        if (!tex) continue;
        const { x, y } = gridToScreen(n.position.x, n.position.y);
        const cfg = TILE_RENDER[renderKey(n.image)] ?? { offsetX: 0, offsetY: 0, scale: 1 };
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5, 0);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sprite.scale.set((TILE_W / (tex as any).width) * cfg.scale);
        sprite.x = x + cfg.offsetX;
        sprite.y = y + cfg.offsetY;
        if (dragEntity === n) {
          sprite.tint = drag!.valid ? 0x88ff88 : 0xff8888;
          sprite.alpha = 0.85;
        }
        spritesLayer.addChild(sprite);
        const hl = highlightFor(n);
        if (hl) addHighlightCopy(sprite, tex, hl.color, hl.alpha);
      }
    }
  }, [cityRef, entityDragRef, hoveredEntityRef, selectedEntityRef]);

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

      // Preload every possible texture upfront.
      await Promise.all([
        ...ALL_TILE_IMAGES.map(async p => { tileTexRef.current[p] = await Assets.load(p); }),
        ...ALL_PROP_IMAGES.map(async p => { propTexRef.current[p] = await Assets.load(p); }),
        ...ALL_NATURE_IMAGES.map(async p => { natureTexRef.current[p] = await Assets.load(p); }),
      ]);
      if (destroyed) { app.destroy(true); return; }
      texturesReadyRef.current = true;

      // world > spritesLayer (cleared on re-render) + gridLines (persistent) + highlightLayer (topmost, tinted sprite copies)
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

      // Highlight layer — topmost so hover/selected tints overlay everything else.
      const highlightLayer = new Container();
      world.addChild(highlightLayer);
      highlightLayerRef.current = highlightLayer;

      // Initial render (empty grass at this point).
      doRender();

      // Pointer state. Two mutually exclusive gestures: panning (world drag)
      // and entityDragging (move a selected property/nature). Edit-mode hover
      // also runs in pointermove when no buttons are held.
      let panning = false;
      let entityDragging = false;
      let pointerStartX = 0, pointerStartY = 0;
      let panLastX = 0, panLastY = 0;
      let pointerDownDidHitEntity = false;
      let pointerMoved = false;
      const CLICK_PIXEL_THRESHOLD = 4;

      mount.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-mayor-ui]')) return;

        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        pointerMoved = false;
        pointerDownDidHitEntity = false;

        // Edit mode: if pointerdown lands on the currently-selected entity,
        // start a drag-to-move instead of panning. A click that doesn't move
        // (no drag distance) is treated as a no-op (still selected).
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

        // Hover (no buttons pressed) — only meaningful in edit mode.
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
        // Palette drags handle their own cleanup with a dedicated window listener.
        if (entityDragRef.current?.isNew) return;
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

        // Treat a no-drag pointerdown+up as a click — toggle selection.
        if (editableRef.current && !pointerMoved && !pointerDownDidHitEntity) {
          const cell = screenToGrid(e.clientX, e.clientY, world.x, world.y, world.scale.x);
          const hit = cell ? entityAt(cityRef.current, cell.gx, cell.gy) : null;
          if (hit) {
            // Toggle off if clicking the same selected entity.
            const sel = selectedEntityRef.current;
            if (sel?.data === hit.data) {
              setSelectedEntity(null);
            } else {
              setSelectedEntity(hit);
            }
          } else {
            setSelectedEntity(null);
          }
          scheduleRender();
        }

        mount.style.cursor = 'grab';
      };

      // Use window-level pointerup so dropping outside the canvas still completes
      // the gesture cleanly (otherwise drag/pan can get stuck).
      window.addEventListener('pointerup', finishPointer);
      cleanupFns.push(() => window.removeEventListener('pointerup', finishPointer));
      mount.style.cursor = 'grab';

      // Position the HTML delete-button overlay each frame so it tracks pan/zoom.
      const repositionDeleteBtn = () => {
        const btn = deleteBtnRef.current;
        if (!btn) return;
        const sel = selectedEntityRef.current;
        // Hide while dragging or when nothing is selected.
        if (!sel || entityDragRef.current) {
          if (btn.style.display !== 'none') btn.style.display = 'none';
          return;
        }
        const pos = sel.data.position;
        const w = sel.kind === 'property' ? sel.data.width  : 1;
        const h = sel.kind === 'property' ? sel.data.height : 1;
        // South vertex of the back-most cell of the footprint = visually below the entity.
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
