'use client';

import { PROPERTY_LABELS } from './propertyLabels';
import type { PropertyName } from '@/lib/all_types';

type Props = {
  elapsedMs: number;
  targetName: string; // PropertyName, but typed loosely so callers don't need to cast
  onClose: () => void;
};

// Real-world response time, rated against a 0–15 minute scale. Thresholds are
// hackathon-flavored, not from any real fire-service standard.
const SCALE_MAX_MS = 15 * 60 * 1000;

type Rating = { label: string; color: string; bgColor: string };

function rateResponse(elapsedMs: number): Rating {
  const seconds = elapsedMs / 1000;
  if (seconds <=   60) return { label: 'Excellent',     color: '#10b981', bgColor: '#064e3b' };
  if (seconds <=  180) return { label: 'Good',          color: '#22c55e', bgColor: '#14532d' };
  if (seconds <=  360) return { label: 'Satisfactory',  color: '#eab308', bgColor: '#713f12' };
  if (seconds <=  600) return { label: 'Poor',          color: '#f97316', bgColor: '#7c2d12' };
  return                       { label: 'Catastrophic', color: '#ef4444', bgColor: '#7f1d1d' };
}

function formatElapsed(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(1)}s`;
}

export function ResponseTimePopup({ elapsedMs, targetName, onClose }: Props) {
  const rating = rateResponse(elapsedMs);
  const fillPct = Math.min(100, Math.max(0, (elapsedMs / SCALE_MAX_MS) * 100));
  const label = PROPERTY_LABELS[targetName as PropertyName] ?? targetName;

  // Tick marks at 0, 5, 10, 15 min on the scale.
  const TICKS = [0, 5, 10, 15];

  return (
    <div
      data-mayor-ui
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-30 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0b1220] text-white border-2 border-white/90 px-6 py-5 font-mono text-[12px] leading-tight"
      style={{
        boxShadow: '4px 4px 0 0 rgba(0,0,0,0.85)',
        minWidth: '420px',
        maxWidth: '480px',
      }}
    >
      <div className="flex justify-between items-start mb-3 pb-2 border-b border-white/20 gap-3">
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-rose-300 uppercase tracking-wider text-[10px]">🚒 Fire Response</span>
          <span className="text-white truncate text-[11px] mt-0.5">at {label}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-white/60 hover:text-white px-1 leading-none shrink-0"
          aria-label="Close report"
        >
          ✕
        </button>
      </div>

      {/* Big numeric readout */}
      <div className="flex items-baseline justify-center gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-white/50">Response time</span>
      </div>
      <div className="flex items-baseline justify-center gap-2 mb-4">
        <span
          className="text-[36px] tabular-nums font-bold leading-none"
          style={{ color: rating.color }}
        >
          {formatElapsed(elapsedMs)}
        </span>
      </div>

      {/* 0–15 min scale */}
      <div className="mb-1">
        <div className="flex justify-between text-[9px] text-white/40 uppercase tracking-wider mb-1">
          <span>0 min</span>
          <span>5 min</span>
          <span>10 min</span>
          <span>15+ min</span>
        </div>
        <div className="relative h-3 bg-white/10 border border-white/30">
          {/* Background gradient — green→yellow→orange→red across the bar */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to right, #10b981 0%, #22c55e 20%, #eab308 40%, #f97316 65%, #ef4444 100%)',
              opacity: 0.3,
            }}
          />
          {/* Tick marks */}
          {TICKS.map((m) => (
            <div
              key={m}
              className="absolute top-0 bottom-0 w-px bg-white/40"
              style={{ left: `${(m / 15) * 100}%` }}
            />
          ))}
          {/* Filled portion (with the rating color) */}
          <div
            className="absolute inset-y-0 left-0 transition-all duration-500"
            style={{ width: `${fillPct}%`, background: rating.color, opacity: 0.85 }}
          />
          {/* Marker — the elapsed-time arrow */}
          <div
            className="absolute -top-1 -bottom-1 w-0.5"
            style={{
              left: `${fillPct}%`,
              background: rating.color,
              boxShadow: `0 0 4px ${rating.color}`,
            }}
          />
        </div>
      </div>

      {/* Rating adjective */}
      <div className="mt-4 flex items-center justify-center">
        <span
          className="px-4 py-1.5 text-[14px] uppercase tracking-[0.25em] font-bold border-2"
          style={{
            color: rating.color,
            borderColor: rating.color,
            backgroundColor: rating.bgColor,
            boxShadow: `2px 2px 0 0 rgba(0,0,0,0.5)`,
          }}
        >
          {rating.label}
        </span>
      </div>
    </div>
  );
}
