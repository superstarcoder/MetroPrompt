'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Person } from '@/lib/all_types';
import { gridToScreen } from './constants';
import { PROPERTY_LABELS, formatPropertyLabel } from './propertyLabels';
import type { ChatState } from './citizenChat';

type Props = {
  citizen: Person;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worldRef: RefObject<any>;
  onClose: () => void;
  chatState: ChatState;
  onSendChat: (question: string) => void;
};

const NeedRow = ({ label, value, rate, color }: { label: string; value: number; rate: number; color: string }) => (
  <div className="flex items-center gap-2">
    <span className="w-16 text-white/70">{label}</span>
    <div className="flex-1 h-2 bg-white/15 relative">
      <div
        className="absolute inset-y-0 left-0"
        style={{ width: `${Math.min(100, Math.max(0, (value / 10) * 100))}%`, background: color }}
      />
    </div>
    <span className="w-8 text-right tabular-nums">{value.toFixed(1)}</span>
    <span className="w-14 text-right tabular-nums text-white/50">+{rate.toFixed(2)}/h</span>
  </div>
);

export function CitizenStatsPopup({ citizen, worldRef, onClose, chatState, onSendChat }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [chatInput, setChatInput] = useState('');

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const world = worldRef.current;
      const el = ref.current;
      if (world && el) {
        const wx = world.x;
        const wy = world.y;
        const ws = world.scale.x;
        // Use the frozen mid-lerp position if set (the renderer does the same)
        // so the popup stays anchored exactly above the sprite.
        const visPos = citizen.visual_position ?? citizen.current_location;
        const { x, y } = gridToScreen(visPos.x, visPos.y);
        const sx = x * ws + wx;
        // Lift the popup above the full sprite height (man_front is taller than
        // it is wide). Offset scales with world zoom so it stays visually consistent.
        const sy = y * ws + wy - 25 * ws;
        el.style.left = `${sx}px`;
        el.style.top = `${sy}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [citizen, worldRef]);

  // Clear the input field once a reply lands (history grew + not pending +
  // no error), so the user can immediately type a follow-up. Errors leave
  // the input intact.
  const historyLen = chatState.history.length;
  useEffect(() => {
    if (!chatState.pending && !chatState.error && historyLen > 0) {
      setChatInput('');
    }
  }, [historyLen, chatState.pending, chatState.error]);

  const submit = () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatState.pending) return;
    onSendChat(trimmed);
  };

  return (
    <div
      data-mayor-ui
      ref={ref}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-20 bg-[#0b1220] text-white border-2 border-white/90 px-4 py-3 font-mono text-[12px] leading-tight"
      style={{
        left: 0,
        top: 0,
        transform: 'translate(-50%, -100%)',
        boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)',
        minWidth: '288px',
      }}
    >
      <div className="flex justify-between items-center mb-2 pb-1 border-b border-white/20">
        <span className="text-fuchsia-300 uppercase tracking-wider">{citizen.name}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-white/60 hover:text-white px-1 leading-none"
          aria-label="Close stats"
        >
          ✕
        </button>
      </div>
      <div className="space-y-0.5 mb-2">
        <div className="flex justify-between"><span className="text-white/60">Age</span><span>{citizen.age_group}</span></div>
        <div className="flex justify-between"><span className="text-white/60">Job</span><span>{citizen.job ? `Engineer @ ${citizen.job}` : 'Unemployed'}</span></div>
        <div className="flex justify-between"><span className="text-white/60">Home</span><span>{PROPERTY_LABELS[citizen.home.name] ?? citizen.home.name}</span></div>
        <div className="flex justify-between gap-2"><span className="text-white/60">Going to</span><span className="truncate">{formatPropertyLabel(citizen.current_destination)}</span></div>
      </div>
      <div className="space-y-1 mb-3">
        <NeedRow label="Hunger"    value={citizen.hunger}    rate={citizen.hunger_rate}    color="#f59e0b" />
        <NeedRow label="Boredom"   value={citizen.boredom}   rate={citizen.boredom_rate}   color="#a78bfa" />
        <NeedRow label="Tiredness" value={citizen.tiredness} rate={citizen.tiredness_rate} color="#60a5fa" />
      </div>

      {/* Chat input */}
      <div className="pt-2 border-t border-white/20 flex gap-1">
        <input
          ref={inputRef}
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask me anything…"
          disabled={chatState.pending}
          maxLength={500}
          className="flex-1 bg-[#1a2540] border border-white/30 px-2 py-1 text-[11px] focus:outline-none focus:border-fuchsia-400 disabled:opacity-50 placeholder:text-white/30"
        />
        <button
          type="button"
          onClick={submit}
          disabled={chatState.pending || !chatInput.trim()}
          className="px-3 py-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-[10px] uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
