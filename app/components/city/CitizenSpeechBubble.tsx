'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Person } from '@/lib/all_types';
import { gridToScreen } from './constants';
import type { ChatState } from './citizenChat';

type Props = {
  citizen: Person;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worldRef: RefObject<any>;
  chatState: ChatState;
};

// Pixel-themed speech bubble that floats to the RIGHT of the citizen sprite
// (independent of the stats popup, which is anchored above the head). The
// bubble's left-pointing tail visually attaches it to the citizen.
export function CitizenSpeechBubble({ citizen, worldRef, chatState }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const lastReply = chatState.history.length > 0
    ? chatState.history[chatState.history.length - 1].reply
    : null;
  const showThinking = chatState.pending;
  const showError = !chatState.pending && chatState.error !== null;
  const showReply = !chatState.pending && !chatState.error && lastReply !== null;
  const visible = showThinking || showError || showReply;

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const tick = () => {
      const world = worldRef.current;
      const el = ref.current;
      if (world && el) {
        const wx = world.x;
        const wy = world.y;
        const ws = world.scale.x;
        // Same source-of-truth as the popup + renderer: prefer the frozen
        // mid-lerp position when the citizen is selected.
        const visPos = citizen.visual_position ?? citizen.current_location;
        const { x, y } = gridToScreen(visPos.x, visPos.y);
        const sx = x * ws + wx;
        const sy = y * ws + wy;
        // Bubble's LEFT edge sits just past the citizen sprite's right edge
        // (sprite is ~32 * ws wide, anchored at its top-center). Vertical
        // anchor at the sprite's vertical middle. Both offsets scale with
        // world zoom so the bubble stays in the same relative spot.
        el.style.left = `${sx + 24 * ws - 67}px`;
        el.style.top = `${sy + 18 * ws - 90}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [citizen, worldRef, visible]);

  if (!visible) return null;

  return (
    <div
      data-mayor-ui
      ref={ref}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-20 px-3 py-2 bg-white text-black border-2 border-black font-mono text-[11px] leading-snug"
      style={{
        left: 0,
        top: 0,
        // Bubble's left edge at anchor x; vertically centered on anchor y.
        transform: 'translate(0, -50%)',
        boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)',
        minWidth: '180px',
        maxWidth: '300px',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
      }}
    >
      {/* leftward-pointing tail at the bubble's left edge, vertically centered */}
      <span
        className="absolute"
        style={{
          right: '100%',
          top: '50%',
          transform: 'translate(0, -50%)',
          width: 0,
          height: 0,
          borderTop: '8px solid transparent',
          borderBottom: '8px solid transparent',
          borderRight: '10px solid black',
        }}
      />
      <span
        className="absolute"
        style={{
          right: 'calc(100% - 2px)',
          top: '50%',
          transform: 'translate(0, -50%)',
          width: 0,
          height: 0,
          borderTop: '6px solid transparent',
          borderBottom: '6px solid transparent',
          borderRight: '8px solid white',
        }}
      />

      {showThinking && (
        <span className="flex items-center gap-1 text-black/70 italic">
          <span className="animate-bounce [animation-delay:0ms]">•</span>
          <span className="animate-bounce [animation-delay:150ms]">•</span>
          <span className="animate-bounce [animation-delay:300ms]">•</span>
        </span>
      )}
      {showError && chatState.error && (
        <span className="text-red-700">⚠ {chatState.error}</span>
      )}
      {showReply && lastReply && (
        <span>{lastReply}</span>
      )}
    </div>
  );
}
