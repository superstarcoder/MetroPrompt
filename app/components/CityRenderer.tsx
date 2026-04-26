'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { initCity } from '@/lib/all_types';
import type { City } from '@/lib/all_types';
import { saveCity } from '@/lib/cityStore';
import { GRID_SIZE } from './city/constants';
import { useCityScene } from './city/useCityScene';
import { useCityEditor } from './city/useCityEditor';
import { useMayorSession } from './city/useMayorSession';
import { ChatPanel, type SaveState } from './city/ChatPanel';
import { Palette } from './city/Palette';


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
  const [showGrid, setShowGrid] = useState(false);

  // City held in a ref so SSE callbacks can mutate it without triggering React
  // re-renders. Pixi re-render is driven by scheduleRender().
  const cityRef = useRef<City>(initialCity ?? initCity(GRID_SIZE));

  // Edit-mode state + actions: hover/select/drag refs, drag-from-palette, delete.
  const editor = useCityEditor({ cityRef, editable, onCityChange });
  const deleteBtnRef = useRef<HTMLButtonElement>(null);

  // Pixi scene: owns app/world/layers, texture preload, painter loop, pan/zoom,
  // click/drag/hover plumbing, and the floating delete-button anchor.
  const { scheduleRender, worldRef } = useCityScene({
    mountRef,
    cityRef,
    deleteBtnRef,
    showGrid,
    editableRef: editor.editableRef,
    hoveredEntityRef: editor.hoveredEntityRef,
    selectedEntityRef: editor.selectedEntityRef,
    entityDragRef: editor.entityDragRef,
    onCityChangeRef: editor.onCityChangeRef,
    setSelectedEntity: editor.setSelectedEntity,
  });

  // Hand scheduleRender + worldRef back to the editor so its callbacks can use them.
  useEffect(() => {
    editor.bindScene({ scheduleRender, worldRef });
  }, [editor, scheduleRender, worldRef]);

  // Save-city UI (only shown in the post-build `done` dock)
  const [saveName, setSaveName] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Mayor session: SSE stream lifecycle, build/followup/pause/redirect actions,
  // status/feed state, the tool_applied → city-mutation handler.
  const {
    status,
    sessionId,
    feed,
    originalGoal,
    chatScrollRef,
    goal,
    setGoal,
    followupText,
    setFollowupText,
    redirectText,
    setRedirectText,
    onBuild,
    onFollowup,
    onPause,
    onRedirect,
  } = useMayorSession({
    cityRef,
    scheduleRender,
    onBuildReset: useCallback(() => {
      setSaveName('');
      setSaveState('idle');
    }, []),
  });

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

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full" />

      {/* Floating delete button — positioned each frame by the Pixi ticker */}
      {editable && editor.selectedEntity && (
        <button
          data-mayor-ui
          ref={deleteBtnRef}
          onClick={(e) => { e.stopPropagation(); editor.onDeleteSelected(); }}
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

      {/* Palette sidebar — only when editing a saved city. Drag a thumbnail onto the canvas to place. */}
      {editable && <Palette onPalettePointerDown={editor.onPalettePointerDown} />}

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
        <ChatPanel
          panelRef={panelRef}
          panelPos={panelPos}
          minimized={minimized}
          setMinimized={setMinimized}
          onHeaderMouseDown={onHeaderMouseDown}
          status={status}
          sessionId={sessionId}
          feed={feed}
          chatScrollRef={chatScrollRef}
          goal={goal}
          setGoal={setGoal}
          redirectText={redirectText}
          setRedirectText={setRedirectText}
          followupText={followupText}
          setFollowupText={setFollowupText}
          saveName={saveName}
          setSaveName={setSaveName}
          saveState={saveState}
          setSaveState={setSaveState}
          onBuild={onBuild}
          onPause={onPause}
          onRedirect={onRedirect}
          onFollowup={onFollowup}
          onSaveCity={onSaveCity}
        />
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
