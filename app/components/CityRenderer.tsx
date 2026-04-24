'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TILE_RENDER, PROP_RENDER } from '@/lib/renderConfig';
import {
  PROPERTY_DEFAULTS,
  HOUSE_IMAGES,
  APARTMENT_IMAGES,
  OFFICE_IMAGES,
  TILE_META,
  CODE_TO_TILE,
  initCity,
  placeProperty,
  placeTileRect,
} from '@/lib/all_types';
import type { City, Nature, Property, PropertyName, TileName } from '@/lib/all_types';

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
// '/assets/apartment_v1_3_3.png' → 'apartment_v1'; '/assets/tree_v3_1_1.png' → 'tree_v3'.
function renderKey(imagePath: string): string {
  const filename = imagePath.split('/').pop()!.replace('.png', '');
  return filename.replace(/_\d+_\d+$/, '');
}

// Client picks variants at placement time. Purely cosmetic — server's city uses
// PROPERTY_DEFAULTS images; the client mixes it up for visual variety.
function pickPropertyImage(name: PropertyName): string {
  if (name === 'house')     return HOUSE_IMAGES[Math.floor(Math.random() * HOUSE_IMAGES.length)];
  if (name === 'apartment') return APARTMENT_IMAGES[Math.floor(Math.random() * APARTMENT_IMAGES.length)];
  if (name === 'office')    return OFFICE_IMAGES[Math.floor(Math.random() * OFFICE_IMAGES.length)];
  return PROPERTY_DEFAULTS[name].image;
}

// Preload every image the Mayor might need, so `tool_applied` events render immediately.
const ALL_TILE_IMAGES = [...new Set(Object.values(TILE_META).map(m => m.image))];
const ALL_PROP_IMAGES = [...new Set([
  ...Object.values(PROPERTY_DEFAULTS).map(d => d.image),
  ...HOUSE_IMAGES,
  ...APARTMENT_IMAGES,
  ...OFFICE_IMAGES,
])];

// ============================================================
// SSE EVENT SHAPES (mirror MayorStreamEvent in lib/agent/mayor.ts)
// ============================================================

type ToolAppliedEvent = {
  kind: 'tool_applied';
  tool_use_id: string;
  name: string;
  input: Record<string, unknown>;
  result: { ok: true } | { ok: false; error: string };
};
type AnthropicEvent = {
  kind: 'anthropic_event';
  // discriminated by event.type — narrow at use site
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any;
};
type DoneEvent = { kind: 'done'; reason: string };
type MayorEvent = ToolAppliedEvent | AnthropicEvent | DoneEvent;

type Status = 'idle' | 'running' | 'paused' | 'done';

// ============================================================

export default function CityRenderer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gridLinesRef = useRef<any>(null);
  const [showGrid, setShowGrid] = useState(false);

  // City held in a ref so SSE callbacks can mutate it without triggering React
  // re-renders. Pixi re-render is driven by scheduleRender().
  const cityRef = useRef<City>(initCity(GRID_SIZE));

  // Pixi refs used by the render loop.
  const pixiModRef = useRef<any>(null);
  const worldRef = useRef<any>(null);
  const spritesLayerRef = useRef<any>(null);
  const tileTexRef = useRef<Record<string, any>>({});
  const propTexRef = useRef<Record<string, any>>({});
  const texturesReadyRef = useRef(false);
  const rafHandleRef = useRef<number | null>(null);

  // UI state.
  const [status, setStatus] = useState<Status>('idle');
  const [goal, setGoal] = useState(
    'Build a small mixed-use city: a central road grid, a park, a hospital, residential blocks, and a small commercial strip. Then call finish.'
  );
  const [redirectText, setRedirectText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const [thoughts, setThoughts] = useState<string[]>([]);

  // ------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------

  const doRender = useCallback(() => {
    const mod = pixiModRef.current;
    const spritesLayer = spritesLayerRef.current;
    if (!mod || !spritesLayer || !texturesReadyRef.current) return;
    const { Sprite } = mod;
    const city = cityRef.current;
    const tileTex = tileTexRef.current;
    const propTex = propTexRef.current;

    spritesLayer.removeChildren();

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
        spritesLayer.addChild(sprite);
      }
      // nature is not placed by the Mayor (deferred to Step 4 polish)
    }
  }, []);

  const scheduleRender = useCallback(() => {
    if (rafHandleRef.current != null) return;
    rafHandleRef.current = requestAnimationFrame(() => {
      rafHandleRef.current = null;
      doRender();
    });
  }, [doRender]);

  // ------------------------------------------------------------
  // SSE event handler
  // ------------------------------------------------------------

  const handleMayorEvent = useCallback((raw: MessageEvent) => {
    let payload: MayorEvent;
    try {
      payload = JSON.parse(raw.data) as MayorEvent;
    } catch {
      return;
    }

    if (payload.kind === 'tool_applied' && payload.result.ok) {
      const city = cityRef.current;
      if (payload.name === 'place_property') {
        const input = payload.input as { property: PropertyName; x: number; y: number };
        const def = PROPERTY_DEFAULTS[input.property];
        if (def) {
          try {
            placeProperty(city, {
              ...def,
              image: pickPropertyImage(input.property),
              position: { x: input.x, y: input.y },
              current_occupants: [],
            });
          } catch {
            // Server already validated — this shouldn't happen. Swallow defensively.
          }
        }
      } else if (payload.name === 'place_tile_rect') {
        const input = payload.input as {
          tile: TileName; x1: number; y1: number; x2: number; y2: number;
        };
        try {
          placeTileRect(city, input.x1, input.y1, input.x2, input.y2, input.tile);
        } catch {
          // same as above
        }
      }
      // 'finish' → no local mutation; 'done' event will flip status
      scheduleRender();
      return;
    }

    if (payload.kind === 'anthropic_event') {
      const ev = payload.event;
      switch (ev?.type) {
        case 'session.status_running':
          setStatus('running');
          break;
        case 'session.status_idle': {
          const reason = ev.stop_reason?.type;
          if (reason === 'requires_action') setStatus('running');
          else if (reason === 'end_turn')   setStatus('paused');
          else                              setStatus('done');
          break;
        }
        case 'session.status_terminated':
          setStatus('done');
          break;
        case 'agent.message': {
          const text = ev.content?.[0]?.text ?? '';
          if (typeof text === 'string' && text.trim()) {
            // Keep the last 5 thought snippets.
            setThoughts(prev => [...prev.slice(-4), text]);
          }
          break;
        }
      }
      return;
    }

    if (payload.kind === 'done') {
      setStatus('done');
      return;
    }
  }, [scheduleRender]);

  // ------------------------------------------------------------
  // User actions
  // ------------------------------------------------------------

  const onBuild = useCallback(async () => {
    if (!goal.trim()) return;
    // Clean slate.
    cityRef.current = initCity(GRID_SIZE);
    scheduleRender();
    setThoughts([]);
    setStatus('running');

    try {
      const resp = await fetch('/api/mayor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim() }),
      });
      const body = await resp.json();
      if (!resp.ok || !body.sessionId) {
        console.error('[build] POST /api/mayor failed:', body);
        setStatus('idle');
        return;
      }
      setSessionId(body.sessionId);

      // Close any prior stream, then open a new one.
      esRef.current?.close();
      const es = new EventSource(`/api/mayor/${body.sessionId}/stream`);
      es.addEventListener('mayor', handleMayorEvent as (e: Event) => void);
      es.onerror = () => { /* EventSource auto-reconnects; ignore */ };
      esRef.current = es;
    } catch (e) {
      console.error('[build]', e);
      setStatus('idle');
    }
  }, [goal, handleMayorEvent, scheduleRender]);

  const onPause = useCallback(async () => {
    if (!sessionId) return;
    try {
      await fetch(`/api/mayor/${sessionId}/interrupt`, { method: 'POST' });
    } catch (e) {
      console.error('[pause]', e);
    }
  }, [sessionId]);

  const onRedirect = useCallback(async () => {
    if (!sessionId || !redirectText.trim()) return;
    try {
      await fetch(`/api/mayor/${sessionId}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: redirectText.trim() }),
      });
      setRedirectText('');
      setStatus('running');
    } catch (e) {
      console.error('[redirect]', e);
    }
  }, [sessionId, redirectText]);

  // ------------------------------------------------------------
  // Pixi init (runs once)
  // ------------------------------------------------------------

  useEffect(() => {
    if (gridLinesRef.current) gridLinesRef.current.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    let destroyed = false;

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

      // Preload every possible texture upfront.
      await Promise.all([
        ...ALL_TILE_IMAGES.map(async p => { tileTexRef.current[p] = await Assets.load(p); }),
        ...ALL_PROP_IMAGES.map(async p => { propTexRef.current[p] = await Assets.load(p); }),
      ]);
      if (destroyed) { app.destroy(true); return; }
      texturesReadyRef.current = true;

      // world > spritesLayer (cleared on re-render) + gridLines (persistent)
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

      // Initial render (empty grass at this point).
      doRender();

      // Pan — ignore clicks that started over the UI panel.
      let dragging = false; let lastX = 0; let lastY = 0;
      mount.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-mayor-ui]')) return;
        dragging = true; lastX = e.clientX; lastY = e.clientY; mount.style.cursor = 'grabbing';
      });
      mount.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        world.x += e.clientX - lastX; world.y += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
      });
      const stopDrag = () => { dragging = false; mount.style.cursor = 'grab'; };
      mount.addEventListener('pointerup', stopDrag);
      mount.addEventListener('pointerleave', stopDrag);
      mount.style.cursor = 'grab';

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
      esRef.current?.close();
      if (rafHandleRef.current != null) cancelAnimationFrame(rafHandleRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------

  const statusBadge = useMemo(() => {
    const color =
      status === 'running' ? 'text-emerald-400' :
      status === 'paused'  ? 'text-amber-400' :
      status === 'done'    ? 'text-sky-400' :
                             'text-white/60';
    return <span className={`uppercase ${color}`}>{status}</span>;
  }, [status]);

  const isBuilding = status === 'running' || status === 'paused';

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full" />

      {/* Mayor control panel */}
      <div
        data-mayor-ui
        className="absolute top-4 left-4 w-80 bg-black/75 text-white p-4 rounded-lg border border-white/20 font-mono text-xs space-y-2 backdrop-blur-sm"
      >
        <div className="flex justify-between items-center text-[10px] opacity-70">
          <span>MAYOR</span>
          <span>{statusBadge}</span>
        </div>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          disabled={isBuilding}
          rows={4}
          className="w-full p-2 bg-white/10 rounded resize-none disabled:opacity-50"
          placeholder="Describe the city you want the Mayor to build..."
        />
        <button
          onClick={onBuild}
          disabled={!goal.trim() || isBuilding}
          className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-white/10 disabled:text-white/40 rounded font-semibold transition-colors"
        >
          {isBuilding ? 'Building…' : 'Build'}
        </button>
        {status === 'running' && (
          <button
            onClick={onPause}
            className="w-full py-2 bg-amber-600 hover:bg-amber-500 rounded font-semibold transition-colors"
          >
            Pause Mayor
          </button>
        )}
        {status === 'paused' && (
          <div className="space-y-2 pt-1">
            <div className="text-[10px] opacity-70">Mayor paused. Send a nudge to resume:</div>
            <textarea
              value={redirectText}
              onChange={(e) => setRedirectText(e.target.value)}
              rows={2}
              className="w-full p-2 bg-white/10 rounded resize-none"
              placeholder="e.g. focus on downtown, more parks, replace offices with housing..."
            />
            <button
              onClick={onRedirect}
              disabled={!redirectText.trim()}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/10 disabled:text-white/40 rounded font-semibold transition-colors"
            >
              Resume with nudge
            </button>
          </div>
        )}
        {thoughts.length > 0 && (
          <div className="pt-2 border-t border-white/10 text-[10px] opacity-70 max-h-32 overflow-y-auto space-y-1">
            <div className="uppercase opacity-60">Mayor's thoughts</div>
            {thoughts.map((t, i) => (
              <div key={i} className="whitespace-pre-wrap">{t}</div>
            ))}
          </div>
        )}
      </div>

      {/* Grid toggle */}
      <button
        data-mayor-ui
        onClick={() => setShowGrid(g => !g)}
        className="absolute top-4 right-4 px-3 py-1.5 rounded text-xs font-mono bg-black/60 text-white border border-white/20 hover:bg-black/80 transition-colors"
      >
        {showGrid ? 'hide grid' : 'show grid'}
      </button>
    </div>
  );
}
