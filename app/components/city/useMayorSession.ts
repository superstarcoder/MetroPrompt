'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import {
  PROPERTY_DEFAULTS,
  deleteNatureAt,
  deletePropertyAt,
  initCity,
  placeNature,
  placeProperty,
  placeTileRect,
} from '@/lib/all_types';
import type { City, NatureName, PropertyName, TileName } from '@/lib/all_types';
import { GRID_SIZE } from './constants';
import { pickNatureImage, pickPropertyImage } from './imageHelpers';
import type {
  AgentSource,
  FeedItem,
  MayorEvent,
  Status,
  ToolAppliedEvent,
  ToolItem,
} from './streamTypes';

const DEFAULT_GOAL =
  'Build a small mixed-use city: a central road grid, a park, a hospital, residential blocks, and a small commercial strip. Then call finish.';

type Args = {
  cityRef: RefObject<City>;
  scheduleRender: () => void;
  // Fired at the start of onBuild so the parent can clear save-related state.
  onBuildReset?: () => void;
};

type Result = {
  // Live stream state
  status: Status;
  sessionId: string | null;
  feed: FeedItem[];
  originalGoal: string;
  chatScrollRef: RefObject<HTMLDivElement | null>;

  // Composer state (mirrored into ChatPanel inputs)
  goal: string;
  setGoal: Dispatch<SetStateAction<string>>;
  followupText: string;
  setFollowupText: Dispatch<SetStateAction<string>>;
  redirectText: string;
  setRedirectText: Dispatch<SetStateAction<string>>;

  // Actions
  onBuild: () => void;
  onFollowup: () => void;
  onPause: () => void;
  onRedirect: () => void;
};

// Owns the Mayor SSE stream lifecycle: status/sessionId/feed state, the
// `tool_applied` → city mutation handler, and the build/followup/pause/redirect
// actions. Mutates `cityRef` in place and calls `scheduleRender` after each
// mutation. Knows nothing about Pixi or the chat-panel UI.
export function useMayorSession({ cityRef, scheduleRender, onBuildReset }: Args): Result {
  const [status, setStatus] = useState<Status>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [originalGoal, setOriginalGoal] = useState<string>('');
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [followupText, setFollowupText] = useState('');
  const [redirectText, setRedirectText] = useState('');

  const esRef = useRef<EventSource | null>(null);
  const feedIdRef = useRef(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);

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
  }, [cityRef, scheduleRender, pushMessage, pushToolApplied]);

  const onBuild = useCallback(async () => {
    if (!goal.trim()) return;
    // Clean slate.
    cityRef.current = initCity(GRID_SIZE);
    scheduleRender();
    setFeed([]);
    setStatus('running');
    setOriginalGoal(goal.trim());
    onBuildReset?.();

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
  }, [goal, cityRef, scheduleRender, handleMayorEvent, onBuildReset]);

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

  // Close any open Mayor stream on unmount.
  useEffect(() => () => { esRef.current?.close(); }, []);

  return {
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
  };
}
