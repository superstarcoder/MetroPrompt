'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TILE_RENDER, PROP_RENDER } from '@/lib/renderConfig';
import {
  PROPERTY_DEFAULTS,
  HOUSE_IMAGES,
  APARTMENT_IMAGES,
  OFFICE_IMAGES,
  TREE_IMAGES,
  FLOWER_PATCH_IMAGES,
  BUSH_IMAGES,
  TILE_META,
  CODE_TO_TILE,
  initCity,
  placeProperty,
  placeTileRect,
  placeNature,
  deletePropertyAt,
  deleteNatureAt,
} from '@/lib/all_types';
import type { City, Nature, NatureName, Property, PropertyName, TileName } from '@/lib/all_types';
import { saveCity } from '@/lib/cityStore';
import type { Position } from '@/lib/all_types';

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

function pickNatureImage(name: NatureName): string {
  const arr =
    name === 'tree'         ? TREE_IMAGES :
    name === 'flower_patch' ? FLOWER_PATCH_IMAGES :
                              BUSH_IMAGES;
  return arr[Math.floor(Math.random() * arr.length)];
}

// Preload every image the Mayor might need, so `tool_applied` events render immediately.
const ALL_TILE_IMAGES = [...new Set(Object.values(TILE_META).map(m => m.image))];
const ALL_PROP_IMAGES = [...new Set([
  ...Object.values(PROPERTY_DEFAULTS).map(d => d.image),
  ...HOUSE_IMAGES,
  ...APARTMENT_IMAGES,
  ...OFFICE_IMAGES,
])];
const ALL_NATURE_IMAGES = [...new Set([
  ...TREE_IMAGES,
  ...FLOWER_PATCH_IMAGES,
  ...BUSH_IMAGES,
])];

// ============================================================
// EDIT-MODE HELPERS (hit testing, drag validation)
// ============================================================

// Inverse of gridToScreen. Converts a screen-space point (relative to the canvas
// element) into a grid cell, accounting for world pan/zoom. Returns null if outside
// the GRID_SIZE × GRID_SIZE bounds.
function screenToGrid(
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

type SelectedEntity =
  | { kind: 'property'; data: Property }
  | { kind: 'nature'; data: Nature };

// Returns the entity occupying (gx, gy), or null. Nature is checked first because
// it can't legally overlap properties at placement time, but if data did get out
// of sync we'd still prefer the smaller selectable target.
function entityAt(city: City, gx: number, gy: number): SelectedEntity | null {
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
function isPlacementValid(city: City, sel: SelectedEntity, newPos: Position): boolean {
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

// ============================================================
// SSE EVENT SHAPES (mirror MayorStreamEvent in lib/agent/mayor.ts)
// ============================================================

type ToolAppliedEvent = {
  kind: 'tool_applied';
  tool_use_id: string;
  name: string;
  input: Record<string, unknown>;
  result: { ok: true } | { ok: false; error: string };
  source?: 'mayor' | 'zone';
};
type AnthropicEvent = {
  kind: 'anthropic_event';
  // discriminated by event.type — narrow at use site
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any;
};
type DoneEvent = { kind: 'done'; reason: string };
type ZoneMessageEvent = { kind: 'zone_message'; text: string };
type MayorEvent = ToolAppliedEvent | AnthropicEvent | DoneEvent | ZoneMessageEvent;

type AgentSource = 'mayor' | 'zone';

type ToolItem = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  error?: string;
};

type FeedItem =
  | { kind: 'message'; id: number; author: AgentSource; text: string }
  | {
      kind: 'tool_batch';
      id: number;
      batchId: string;
      name: string;
      source: AgentSource;
      items: ToolItem[];
    };

type Status = 'idle' | 'running' | 'paused' | 'done';

// Pixel-glyph + accent color per tool type. Static class names so Tailwind picks them up.
type ToolStyle = {
  glyph: string;
  label: string;
  textCls: string;
  borderCls: string;
  bgCls: string;
  dotCls: string;
};

function toolStyle(name: string): ToolStyle {
  switch (name) {
    case 'place_property':
    case 'place_properties':
      return { glyph: '▣', label: 'BUILD', textCls: 'text-fuchsia-300', borderCls: 'border-fuchsia-400/70', bgCls: 'bg-fuchsia-500/15', dotCls: 'bg-fuchsia-400' };
    case 'place_tile_rect':
    case 'place_tile_rects':
      return { glyph: '▭', label: 'TILE', textCls: 'text-amber-300', borderCls: 'border-amber-400/70', bgCls: 'bg-amber-500/15', dotCls: 'bg-amber-400' };
    case 'place_nature':
    case 'place_natures':
      return { glyph: '✿', label: 'NATURE', textCls: 'text-emerald-300', borderCls: 'border-emerald-400/70', bgCls: 'bg-emerald-500/15', dotCls: 'bg-emerald-400' };
    case 'delete_property':
    case 'delete_properties':
    case 'delete_tile_rect':
    case 'delete_tile_rects':
    case 'delete_nature':
    case 'delete_natures':
      return { glyph: '✕', label: 'REMOVE', textCls: 'text-rose-300', borderCls: 'border-rose-400/70', bgCls: 'bg-rose-500/15', dotCls: 'bg-rose-400' };
    case 'finish':
      return { glyph: '✓', label: 'FINISH', textCls: 'text-sky-300', borderCls: 'border-sky-400/70', bgCls: 'bg-sky-500/15', dotCls: 'bg-sky-400' };
    default:
      return { glyph: '◆', label: name.toUpperCase(), textCls: 'text-white/80', borderCls: 'border-white/40', bgCls: 'bg-white/5', dotCls: 'bg-white/60' };
  }
}

function formatToolInput(name: string, input: Record<string, unknown>): string {
  const i = input as Record<string, unknown>;
  switch (name) {
    case 'place_property':
      return `${String(i.property)} @ (${i.x},${i.y})`;
    case 'place_tile_rect':
      return `${String(i.tile)} (${i.x1},${i.y1})→(${i.x2},${i.y2})`;
    case 'place_nature':
      return `${String(i.nature)} @ (${i.x},${i.y})`;
    case 'delete_property':
    case 'delete_nature':
      return `@ (${i.x},${i.y})`;
    case 'delete_tile_rect':
      return `(${i.x1},${i.y1})→(${i.x2},${i.y2}) → grass`;
    case 'finish':
      return String(i.reason ?? '');
    default:
      return JSON.stringify(input);
  }
}

// ============================================================

export type CityRendererProps = {
  // When true, the chat panel + composer are hidden and no SSE stream is opened.
  // Used by /cities/[id] to display a saved city as a static scene.
  readOnly?: boolean;
  // Seed the city instead of starting from empty grass. Used in readOnly mode.
  initialCity?: City;
  // Header label shown in readOnly mode (e.g. saved city name).
  cityName?: string;
  // Enable hover/click/drag editing of properties + nature. Pairs with onCityChange.
  editable?: boolean;
  // Called after every mutation (delete, drag-drop) so callers can persist.
  onCityChange?: (city: City) => void;
};

export default function CityRenderer({
  readOnly = false,
  initialCity,
  cityName,
  editable = false,
  onCityChange,
}: CityRendererProps = {}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gridLinesRef = useRef<any>(null);
  const [showGrid, setShowGrid] = useState(false);

  // City held in a ref so SSE callbacks can mutate it without triggering React
  // re-renders. Pixi re-render is driven by scheduleRender().
  const cityRef = useRef<City>(initialCity ?? initCity(GRID_SIZE));

  // Pixi refs used by the render loop.
  const pixiModRef = useRef<any>(null);
  const worldRef = useRef<any>(null);
  const spritesLayerRef = useRef<any>(null);
  const highlightLayerRef = useRef<any>(null);
  const appRef = useRef<any>(null);
  const tileTexRef = useRef<Record<string, any>>({});
  const propTexRef = useRef<Record<string, any>>({});
  const natureTexRef = useRef<Record<string, any>>({});
  const texturesReadyRef = useRef(false);
  const rafHandleRef = useRef<number | null>(null);

  // Edit-mode state. Refs are read by Pixi event handlers (which capture stale
  // closures); state mirrors are used in JSX.
  const [selectedEntity, setSelectedEntityState] = useState<SelectedEntity | null>(null);
  const hoveredEntityRef = useRef<SelectedEntity | null>(null);
  const selectedEntityRef = useRef<SelectedEntity | null>(null);
  const entityDragRef = useRef<{
    sel: SelectedEntity;
    originalPos: Position;
    valid: boolean;
  } | null>(null);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);
  const editableRef = useRef(editable);
  useEffect(() => { editableRef.current = editable; }, [editable]);
  const onCityChangeRef = useRef(onCityChange);
  useEffect(() => { onCityChangeRef.current = onCityChange; }, [onCityChange]);

  const setSelectedEntity = useCallback((e: SelectedEntity | null) => {
    selectedEntityRef.current = e;
    setSelectedEntityState(e);
  }, []);

  // UI state.
  const [status, setStatus] = useState<Status>('idle');
  const [goal, setGoal] = useState(
    'Build a small mixed-use city: a central road grid, a park, a hospital, residential blocks, and a small commercial strip. Then call finish.'
  );
  const [followupText, setFollowupText] = useState('');
  const [redirectText, setRedirectText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedIdRef = useRef(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Save-city UI (only shown in the post-build `done` dock)
  const [saveName, setSaveName] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [originalGoal, setOriginalGoal] = useState<string>('');

  // Chat panel — draggable + minimizable.
  const PANEL_WIDTH_PX = 26 * 16; // matches w-[26rem]
  const [panelPos, setPanelPos] = useState<{ x: number; y: number }>({ x: 16, y: 16 });
  const [minimized, setMinimized] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Park the panel at top-right on first mount.
  useEffect(() => {
    setPanelPos({ x: Math.max(16, window.innerWidth - PANEL_WIDTH_PX - 16), y: 16 });
  }, []);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    // Skip drag if click was on a button inside the header.
    if ((e.target as HTMLElement).closest('button')) return;
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: panelPos.x,
      origY: panelPos.y,
    };
    e.preventDefault();
  }, [panelPos.x, panelPos.y]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragStateRef.current;
      if (!d) return;
      const w = panelRef.current?.offsetWidth ?? PANEL_WIDTH_PX;
      const h = panelRef.current?.offsetHeight ?? 100;
      const nextX = Math.min(Math.max(0, d.origX + (e.clientX - d.startX)), window.innerWidth - w);
      const nextY = Math.min(Math.max(0, d.origY + (e.clientY - d.startY)), window.innerHeight - 32);
      setPanelPos({ x: nextX, y: nextY });
      // Note: we let the panel header (32px tall) stay reachable even if dragged near bottom edge.
      void h;
    };
    const onUp = () => { dragStateRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const pushMessage = useCallback((author: AgentSource, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setFeed(prev => [
      ...prev,
      { kind: 'message', id: ++feedIdRef.current, author, text: trimmed },
    ]);
  }, []);

  const pushToolApplied = useCallback((e: ToolAppliedEvent) => {
    const source: AgentSource = e.source === 'zone' ? 'zone' : 'mayor';
    const batchId = e.tool_use_id.split('#')[0];
    const item: ToolItem = {
      toolUseId: e.tool_use_id,
      name: e.name,
      input: e.input,
      ok: e.result.ok,
      error: e.result.ok ? undefined : e.result.error,
    };
    setFeed(prev => {
      const last = prev[prev.length - 1];
      if (
        last &&
        last.kind === 'tool_batch' &&
        last.batchId === batchId &&
        last.name === e.name &&
        last.source === source
      ) {
        const merged: FeedItem = { ...last, items: [...last.items, item] };
        return [...prev.slice(0, -1), merged];
      }
      return [
        ...prev,
        {
          kind: 'tool_batch',
          id: ++feedIdRef.current,
          batchId,
          name: e.name,
          source,
          items: [item],
        },
      ];
    });
  }, []);

  // Auto-scroll the feed as new entries arrive.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed]);

  // ------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------

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

    if (payload.kind === 'tool_applied') {
      pushToolApplied(payload);
      if (!payload.result.ok) return;
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
      } else if (payload.name === 'place_nature') {
        const input = payload.input as { nature: NatureName; x: number; y: number };
        try {
          placeNature(city, {
            name: input.nature,
            position: { x: input.x, y: input.y },
            image: pickNatureImage(input.nature),
          });
        } catch {
          // server already validated
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
      } else if (payload.name === 'delete_property') {
        const input = payload.input as { x: number; y: number };
        deletePropertyAt(city, { x: input.x, y: input.y });
      } else if (payload.name === 'delete_nature') {
        const input = payload.input as { x: number; y: number };
        deleteNatureAt(city, { x: input.x, y: input.y });
      } else if (payload.name === 'delete_tile_rect') {
        const input = payload.input as { x1: number; y1: number; x2: number; y2: number };
        try {
          placeTileRect(city, input.x1, input.y1, input.x2, input.y2, 'grass');
        } catch {
          // server already validated
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
          if (typeof text === 'string') pushMessage('mayor', text);
          break;
        }
      }
      return;
    }

    if (payload.kind === 'zone_message') {
      pushMessage('zone', payload.text);
      return;
    }

    if (payload.kind === 'done') {
      setStatus('done');
      // Close the EventSource so the browser doesn't auto-reconnect and spawn
      // a zombie runMayorLoop on the server. A follow-up will open a new one.
      esRef.current?.close();
      esRef.current = null;
      return;
    }
  }, [scheduleRender, pushMessage, pushToolApplied]);

  // ------------------------------------------------------------
  // User actions
  // ------------------------------------------------------------

  const onBuild = useCallback(async () => {
    if (!goal.trim()) return;
    // Clean slate.
    cityRef.current = initCity(GRID_SIZE);
    scheduleRender();
    setFeed([]);
    setStatus('running');
    setOriginalGoal(goal.trim());
    setSaveName('');
    setSaveState('idle');

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

  const onFollowup = useCallback(async () => {
    if (!sessionId || !followupText.trim()) return;
    const goalText = followupText.trim();
    setFollowupText('');
    setStatus('running');
    try {
      const resp = await fetch(`/api/mayor/${sessionId}/followup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: goalText }),
      });
      const body = await resp.json();
      if (!resp.ok) {
        console.error('[followup]', body);
        setStatus('done');
        return;
      }
      // Reopen stream — keeps the city + feed intact.
      esRef.current?.close();
      const es = new EventSource(`/api/mayor/${sessionId}/stream`);
      es.addEventListener('mayor', handleMayorEvent as (e: Event) => void);
      es.onerror = () => { /* EventSource auto-reconnects; ignore */ };
      esRef.current = es;
    } catch (e) {
      console.error('[followup]', e);
      setStatus('done');
    }
  }, [sessionId, followupText, handleMayorEvent]);

  const onPause = useCallback(async () => {
    if (!sessionId) return;
    try {
      await fetch(`/api/mayor/${sessionId}/interrupt`, { method: 'POST' });
    } catch (e) {
      console.error('[pause]', e);
    }
  }, [sessionId]);

  const onDeleteSelected = useCallback(() => {
    const sel = selectedEntityRef.current;
    if (!sel) return;
    const city = cityRef.current;
    if (sel.kind === 'property') {
      const idx = city.all_properties.indexOf(sel.data);
      if (idx >= 0) city.all_properties.splice(idx, 1);
    } else {
      const idx = city.all_nature.indexOf(sel.data);
      if (idx >= 0) city.all_nature.splice(idx, 1);
    }
    setSelectedEntity(null);
    hoveredEntityRef.current = null;
    onCityChangeRef.current?.(city);
    scheduleRender();
  }, [setSelectedEntity, scheduleRender]);

  const onSaveCity = useCallback(() => {
    const name = saveName.trim();
    if (!name) return;
    setSaveState('saving');
    try {
      saveCity({
        name,
        originalGoal,
        city: cityRef.current,
      });
      setSaveState('saved');
    } catch (e) {
      console.error('[save]', e);
      setSaveState('idle');
    }
  }, [saveName, originalGoal]);

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
      esRef.current?.close();
      if (rafHandleRef.current != null) cancelAnimationFrame(rafHandleRef.current);
      for (const fn of cleanupFns) {
        try { fn(); } catch { /* ignore */ }
      }
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

      {/* Floating delete button — positioned each frame by the Pixi ticker */}
      {editable && selectedEntity && (
        <button
          data-mayor-ui
          ref={deleteBtnRef}
          onClick={(e) => { e.stopPropagation(); onDeleteSelected(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Delete this item"
          className="absolute z-10 w-6 h-6 flex items-center justify-center bg-rose-500 hover:bg-rose-400 text-white text-sm font-bold border-2 border-white/90 rounded-full leading-none transition-colors"
          style={{
            left: 0,
            top: 0,
            display: 'none',
            transform: 'translate(-50%, 0)',
            boxShadow: '2px 2px 0 0 rgba(0,0,0,0.85)',
            imageRendering: 'pixelated',
          }}
        >
          ✕
        </button>
      )}

      {/* Read-only header for saved-city viewer */}
      {readOnly && (
        <div
          data-mayor-ui
          className="absolute top-4 left-4 flex items-center gap-3 px-4 py-2 bg-[#0b1220] text-white border-2 border-white/90 font-mono text-[11px] uppercase tracking-[0.2em]"
          style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
        >
          <Link href="/cities" className="text-white/70 hover:text-white">← My Cities</Link>
          <span className="opacity-40">|</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 bg-fuchsia-400" />
            <span className="text-fuchsia-300">{cityName ?? 'Saved City'}</span>
          </span>
        </div>
      )}

      {/* Unified chat panel — draggable + minimizable, pixel themed */}
      {!readOnly && (
      <div
        data-mayor-ui
        ref={panelRef}
        className={`absolute w-[26rem] flex flex-col bg-[#0b1220] text-white font-mono border-2 border-white/90 ${minimized ? '' : 'h-[75vh]'}`}
        style={{
          left: panelPos.x,
          top: panelPos.y,
          imageRendering: 'pixelated',
          boxShadow: '4px 4px 0 0 rgba(0,0,0,0.85), inset 0 0 0 2px #1a2540',
        }}
      >
        {/* Header — drag handle */}
        <div
          onMouseDown={onHeaderMouseDown}
          className="cursor-move select-none flex justify-between items-center px-3 py-2 bg-[#1a2540] border-b-2 border-white/90 uppercase tracking-[0.2em] text-[10px] shrink-0"
        >
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 bg-cyan-400" />
            <span className="opacity-60">⠿</span>
            MetroPrompt · Mayor
          </span>
          <span className="flex items-center gap-2">
            {statusBadge}
            <button
              onClick={() => setMinimized(m => !m)}
              className="px-1.5 py-[1px] text-[10px] leading-none border border-white/40 hover:bg-white/10 hover:border-white/70 transition-colors"
              title={minimized ? 'restore' : 'minimize'}
            >
              {minimized ? '▢' : '_'}
            </button>
          </span>
        </div>

        {!minimized && (<>


        {/* Feed */}
        <div
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto p-3 space-y-2 text-[11px]"
        >
          {feed.length === 0 && (
            <div className="text-white/40 text-center pt-8 uppercase tracking-wider text-[10px] leading-relaxed">
              ▒▒ no transmissions ▒▒
              <br />
              <span className="opacity-60">describe a city below to start</span>
            </div>
          )}
          {feed.map((entry) => {
            if (entry.kind === 'message') {
              const isMayor = entry.author === 'mayor';
              const label = isMayor ? 'MAYOR' : 'ZONE';
              const dot = isMayor ? 'bg-cyan-400' : 'bg-emerald-400';
              const labelText = isMayor ? 'text-cyan-300' : 'text-emerald-300';
              const headBg = isMayor ? 'bg-cyan-500/15' : 'bg-emerald-500/15';
              const headBorder = isMayor ? 'border-cyan-400/70' : 'border-emerald-400/70';
              return (
                <div
                  key={entry.id}
                  className={`border-2 ${headBorder} bg-black/40`}
                  style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.7)' }}
                >
                  <div className={`flex items-center gap-1.5 px-2 py-1 ${headBg} border-b-2 ${headBorder} uppercase tracking-[0.2em] text-[9px]`}>
                    <span className={`inline-block w-2 h-2 ${dot}`} />
                    <span className={labelText}>{label}</span>
                  </div>
                  <div className="px-3 py-2 leading-relaxed chat-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {entry.text}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            }
            // tool_batch
            const ts = toolStyle(entry.name);
            const total = entry.items.length;
            const okCount = entry.items.filter(it => it.ok).length;
            const failCount = total - okCount;
            const sourceTag = entry.source === 'zone' ? 'ZONE' : 'MAYOR';
            const sourceTagCls = entry.source === 'zone' ? 'text-emerald-300' : 'text-cyan-300';
            const previewCount = 6;
            const previewItems = entry.items.slice(0, previewCount);
            const remaining = total - previewItems.length;
            return (
              <div
                key={entry.id}
                className={`border-2 ${ts.borderCls} bg-black/30`}
                style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.7)' }}
              >
                <div className={`flex items-center justify-between px-2 py-1 ${ts.bgCls} border-b-2 ${ts.borderCls} uppercase tracking-[0.18em] text-[9px]`}>
                  <span className="flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 ${ts.dotCls}`} />
                    <span className={sourceTagCls}>{sourceTag}</span>
                    <span className="opacity-50">·</span>
                    <span className={ts.textCls}>{ts.glyph} {entry.name}</span>
                    {total > 1 && <span className="opacity-70">×{total}</span>}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {failCount > 0 && (
                      <span className="text-rose-300">✗{failCount}</span>
                    )}
                    {okCount > 0 && (
                      <span className="text-emerald-300">✓{okCount}</span>
                    )}
                  </span>
                </div>
                <div className="px-2 py-1.5 text-[10px] leading-snug font-mono space-y-0.5">
                  {previewItems.map(it => (
                    <div
                      key={it.toolUseId}
                      className={`flex items-start gap-1.5 ${it.ok ? 'text-white/85' : 'text-rose-300/90'}`}
                    >
                      <span className={it.ok ? 'opacity-60' : ''}>
                        {it.ok ? '›' : '✗'}
                      </span>
                      <span className="break-all">
                        {formatToolInput(it.name, it.input)}
                        {!it.ok && it.error && (
                          <span className="opacity-70"> — {it.error}</span>
                        )}
                      </span>
                    </div>
                  ))}
                  {remaining > 0 && (
                    <div className="text-white/40 italic">+ {remaining} more…</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Composer (controls dock) */}
        <div className="border-t-2 border-white/90 bg-[#0d1424] p-3 space-y-2 shrink-0">
          {status === 'paused' ? (
            <>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-300">
                <span className="inline-block w-2 h-2 bg-amber-400 animate-pulse" />
                Mayor paused — send a nudge to resume
              </div>
              <textarea
                value={redirectText}
                onChange={(e) => setRedirectText(e.target.value)}
                rows={2}
                className="w-full p-2 bg-black/60 text-white text-xs border-2 border-white/40 focus:border-emerald-400 outline-none resize-none"
                placeholder="e.g. focus on downtown, more parks…"
              />
              <button
                onClick={onRedirect}
                disabled={!redirectText.trim()}
                className="w-full py-2 bg-emerald-400 hover:bg-emerald-300 disabled:bg-white/10 disabled:text-white/40 text-black text-xs font-bold uppercase tracking-wider border-2 border-white/90 transition-colors"
                style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
              >
                ▶ Resume with nudge
              </button>
            </>
          ) : status === 'done' && sessionId ? (
            <>
              {/* Save card */}
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-lime-300">
                <span className="inline-block w-2 h-2 bg-lime-400" />
                Save this city locally
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => { setSaveName(e.target.value); if (saveState === 'saved') setSaveState('idle'); }}
                  placeholder="name your city…"
                  className="flex-1 min-w-0 px-2 py-1.5 bg-black/60 text-white text-xs border-2 border-white/40 focus:border-lime-400 outline-none"
                />
                <button
                  onClick={onSaveCity}
                  disabled={!saveName.trim() || saveState === 'saving'}
                  className="shrink-0 px-3 py-1.5 bg-lime-400 hover:bg-lime-300 disabled:bg-white/10 disabled:text-white/40 text-black text-[10px] font-bold uppercase tracking-wider border-2 border-white/90 transition-colors"
                  style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
                >
                  {saveState === 'saved' ? '✓ saved' : saveState === 'saving' ? '…' : '💾 save'}
                </button>
              </div>
              {saveState === 'saved' && (
                <div className="text-[10px] text-lime-300/90">
                  Saved · <Link href="/cities" className="underline hover:text-lime-200">view My Cities →</Link>
                </div>
              )}

              <div className="border-t border-white/15 my-1" />

              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sky-300">
                <span className="inline-block w-2 h-2 bg-sky-400" />
                Build complete — send a follow-up to edit the city
              </div>
              <textarea
                value={followupText}
                onChange={(e) => setFollowupText(e.target.value)}
                rows={3}
                className="w-full p-2 bg-black/60 text-white text-xs border-2 border-white/40 focus:border-fuchsia-400 outline-none resize-none"
                placeholder="e.g. remove the hospital and put a park there, add more trees along the main road…"
              />
              <button
                onClick={onFollowup}
                disabled={!followupText.trim()}
                className="w-full py-2 bg-fuchsia-400 hover:bg-fuchsia-300 disabled:bg-white/10 disabled:text-white/40 text-black text-xs font-bold uppercase tracking-wider border-2 border-white/90 transition-colors"
                style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
              >
                ✎ Send follow-up
              </button>
              <button
                onClick={onBuild}
                disabled={!goal.trim()}
                className="w-full py-1.5 bg-transparent hover:bg-white/5 disabled:opacity-40 text-white/60 hover:text-white text-[10px] uppercase tracking-wider border border-white/30"
                title="Discard the current city and start a brand-new build with the goal above"
              >
                ↺ start over with new goal
              </button>
            </>
          ) : (
            <>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                disabled={isBuilding}
                rows={3}
                className="w-full p-2 bg-black/60 text-white text-xs border-2 border-white/40 focus:border-cyan-400 outline-none resize-none disabled:opacity-50"
                placeholder="Describe the city you want the Mayor to build…"
              />
              {status === 'running' ? (
                <button
                  onClick={onPause}
                  className="w-full py-2 bg-amber-400 hover:bg-amber-300 text-black text-xs font-bold uppercase tracking-wider border-2 border-white/90 transition-colors"
                  style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
                >
                  ❚❚ Pause Mayor
                </button>
              ) : (
                <button
                  onClick={onBuild}
                  disabled={!goal.trim()}
                  className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-white/10 disabled:text-white/40 text-black text-xs font-bold uppercase tracking-wider border-2 border-white/90 transition-colors"
                  style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
                >
                  ▶ Build
                </button>
              )}
            </>
          )}
        </div>
        </>)}
      </div>
      )}

      {/* Grid toggle — pixel themed */}
      <button
        data-mayor-ui
        onClick={() => setShowGrid(g => !g)}
        className="absolute bottom-4 left-4 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider bg-[#0b1220] text-white border-2 border-white/90 hover:bg-[#1a2540] transition-colors"
        style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
      >
        {showGrid ? '▣ hide grid' : '▢ show grid'}
      </button>
    </div>
  );
}
