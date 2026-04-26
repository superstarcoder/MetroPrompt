'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { initCity } from '@/lib/all_types';
import type { City, Person } from '@/lib/all_types';
import type { FireTruck } from './city/useSimulation';
import { saveCity } from '@/lib/cityStore';
import { GRID_SIZE } from './city/constants';
import { useCityScene } from './city/useCityScene';
import { useCityEditor } from './city/useCityEditor';
import { useMayorSession } from './city/useMayorSession';
import { useSimulation } from './city/useSimulation';
import { ChatPanel, type SaveState } from './city/ChatPanel';
import { Palette } from './city/Palette';
import { CitizenStatsPopup } from './city/CitizenStatsPopup';
import { CitizenSpeechBubble } from './city/CitizenSpeechBubble';
import { PropertyInfoPopup } from './city/PropertyInfoPopup';
import { ResponseTimePopup } from './city/ResponseTimePopup';
import { sendCitizenChat, initialChatState, type ChatState } from './city/citizenChat';


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

  // Citizen-selection state lives in CityRenderer so both useCityScene
  // (clicks + render-side freeze) and useSimulation (skip movement on the
  // selected citizen) can share it without a hook-order cycle.
  const [selectedCitizen, setSelectedCitizen] = useState<Person | null>(null);
  const selectedCitizenRef = useRef<Person | null>(null);
  useEffect(() => { selectedCitizenRef.current = selectedCitizen; }, [selectedCitizen]);

  // Whenever the selected citizen changes (or clears), drop any stale frozen
  // visual_position from citizens that are no longer selected. The Pixi click
  // handler clears the prior selection's visual_position when toggling
  // directly between citizens; this catches the cases where setSelectedCitizen
  // is called externally (popup ✕ button, sim stop, building click).
  useEffect(() => {
    for (const c of cityRef.current.all_citizens) {
      if (c !== selectedCitizen && c.visual_position) c.visual_position = undefined;
    }
  }, [selectedCitizen]);

  // Citizen chat state — continuous within one selection. The history grows
  // as the user asks follow-up questions; the API receives the full
  // alternating user/assistant stream so the citizen has memory of prior
  // turns. Reset whenever the selection changes.
  const [chatState, setChatState] = useState<ChatState>(initialChatState);
  const chatStateRef = useRef<ChatState>(initialChatState);
  useEffect(() => { chatStateRef.current = chatState; }, [chatState]);
  const chatAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setChatState(initialChatState);
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
  }, [selectedCitizen]);

  const onSendChat = useCallback(async (question: string) => {
    if (!selectedCitizen) return;
    const trimmed = question.trim();
    if (!trimmed) return;

    chatAbortRef.current?.abort();
    const ctrl = new AbortController();
    chatAbortRef.current = ctrl;

    // Snapshot history BEFORE mutating state — we send these prior turns to
    // the API and only commit the new turn to history on success.
    const priorHistory = chatStateRef.current.history;
    setChatState(s => ({ ...s, pending: true, error: null }));

    try {
      const reply = await sendCitizenChat(selectedCitizen, priorHistory, trimmed, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setChatState(s => ({
        history: [...s.history, { question: trimmed, reply }],
        pending: false,
        error: null,
      }));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      setChatState(s => ({ ...s, pending: false, error: msg }));
    }
  }, [selectedCitizen]);

  // Wall-clock timestamp of the last sim tick. useSimulation writes it each
  // tick; useCityScene reads it for visual lerp.
  const tickStartedAtRef = useRef<number>(0);

  // Active fire truck. Lifted here (not owned by useSimulation) because
  // useCityScene runs first and needs the ref at hook-call time. useSimulation
  // mutates it; useCityScene reads it each render.
  const activeFireTruckRef = useRef<FireTruck | null>(null);

  // Pixi scene: owns app/world/layers, texture preload, painter loop, pan/zoom,
  // click/drag/hover plumbing, the floating delete-button anchor, and citizen
  // rendering (painter-sorted with properties + nature).
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
    selectedCitizenRef,
    setSelectedCitizen,
    tickStartedAtRef,
    activeFireTruckRef,
  });

  // Hand scheduleRender + worldRef back to the editor so its callbacks can use them.
  useEffect(() => {
    editor.bindScene({ scheduleRender, worldRef });
  }, [editor, scheduleRender, worldRef]);

  // Citizen simulation. The hook drives a 5s tick loop while `running`,
  // applying jittered need-decay per citizen + decision-making + movement.
  // `tick` is consumed indirectly: calling useSimulation here subscribes
  // CityRenderer to its internal state, which re-renders the stats popup
  // with the latest values each tick.
  const {
    simState,
    day,
    hour,
    startSim,
    stopSim,
    pauseSim,
    resumeSim,
    fireTruckActive,
    dispatchFireTruck,
    responseReport,
    dismissResponseReport,
  } = useSimulation({
    cityRef,
    scheduleRender,
    selectedCitizenRef,
    setSelectedCitizen,
    tickStartedAtRef,
    activeFireTruckRef,
  });

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

      {/* Day / hour HUD — only while sim is active */}
      {simState !== 'idle' && (
        <div
          data-mayor-ui
          className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-[#0b1220] text-white border-2 border-white/90 font-mono text-[11px] uppercase tracking-[0.2em] flex items-center gap-3"
          style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
        >
          <span>Day <span className="text-fuchsia-300">{day}</span>/7</span>
          <span className="opacity-40">·</span>
          <span>Hour <span className="text-fuchsia-300">{hour}</span>/24</span>
          {simState === 'paused' && <span className="ml-2 text-amber-300">▮▮ paused</span>}
          {simState === 'done'   && <span className="ml-2 text-emerald-300">✓ complete</span>}
        </div>
      )}

      {/* Simulation controls — pixel themed */}
      <div data-mayor-ui className="absolute bottom-4 right-4 flex gap-2">
        {(simState === 'running' || simState === 'paused') && (
          <button
            onClick={stopSim}
            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider bg-[#0b1220] text-white border-2 border-white/90 hover:bg-[#1a2540] transition-colors"
            style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
          >
            ■ stop
          </button>
        )}
        <button
          onClick={
            simState === 'idle'    ? startSim  :
            simState === 'running' ? pauseSim  :
            simState === 'paused'  ? resumeSim :
            startSim
          }
          className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider bg-[#0b1220] text-white border-2 border-white/90 hover:bg-[#1a2540] transition-colors"
          style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
        >
          {simState === 'idle'    && '▶ start simulation'}
          {simState === 'running' && '⏸ pause'}
          {simState === 'paused'  && '▶ resume'}
          {simState === 'done'    && '↻ restart'}
        </button>
      </div>

      {/* Stats popup for the selected citizen — citizens themselves are now
          rendered inside the Pixi scene (painter-sorted with properties). */}
      {selectedCitizen && (
        <>
          <CitizenStatsPopup
            citizen={selectedCitizen}
            worldRef={worldRef}
            onClose={() => setSelectedCitizen(null)}
            chatState={chatState}
            onSendChat={onSendChat}
          />
          <CitizenSpeechBubble
            citizen={selectedCitizen}
            worldRef={worldRef}
            chatState={chatState}
          />
        </>
      )}

      {/* Info popup for the selected property — shows live occupant list.
          Available in any mode (the click-to-select gate was lifted in
          useCityScene; only drag-to-move + delete remain edit-only). */}
      {editor.selectedEntity?.kind === 'property' && (
        <PropertyInfoPopup
          property={editor.selectedEntity.data}
          cityRef={cityRef}
          worldRef={worldRef}
          onClose={() => editor.setSelectedEntity(null)}
          canDispatchFire={
            simState === 'running' &&
            !fireTruckActive &&
            editor.selectedEntity.data.name !== 'fire_station'
          }
          onDispatchFire={() => {
            const sel = editor.selectedEntity;
            if (sel?.kind !== 'property') return;
            const result = dispatchFireTruck(sel.data);
            if (!result.ok) {
              // Surface the failure inline. (No UI element for this yet —
              // alert is the cheapest path.)
              alert(`🚒 ${result.reason}`);
            }
          }}
        />
      )}

      {/* Response time report — appears when a truck arrives at the scene. */}
      {responseReport && (
        <ResponseTimePopup
          elapsedMs={responseReport.elapsedMs}
          targetName={responseReport.targetName}
          onClose={dismissResponseReport}
        />
      )}
    </div>
  );
}
