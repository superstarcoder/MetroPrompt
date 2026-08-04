'use client';

import type { CitizenVoice } from './useCitizenVoice';

// Voice-chat control + output visualizer, sits under the citizen chat input.
// Purely presentational — all state comes from useCitizenVoice.

const STATUS_LABEL: Record<CitizenVoice['status'], string> = {
  idle: 'Voice chat',
  connecting: 'Connecting…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  error: 'Voice error',
};

const STATUS_COLOR: Record<CitizenVoice['status'], string> = {
  idle: 'text-white/50',
  connecting: 'text-amber-300',
  listening: 'text-emerald-300',
  thinking: 'text-amber-300',
  speaking: 'text-fuchsia-300',
  error: 'text-red-400',
};

export function VoiceChatBar({ voice }: { voice: CitizenVoice }) {
  const live = voice.status !== 'idle' && voice.status !== 'error';
  const speaking = voice.status === 'speaking';
  // While muted the mic sends nothing, so "Listening…" would be a lie.
  const statusLabel = voice.muted && live ? 'Muted' : STATUS_LABEL[voice.status];
  const statusColor = voice.muted && live ? 'text-white/40' : STATUS_COLOR[voice.status];

  return (
    <div className="pt-2 mt-2 border-t border-white/20">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={live ? voice.stop : voice.start}
          disabled={voice.status === 'connecting'}
          className={[
            'px-2 py-1 text-[10px] uppercase tracking-wider transition-colors',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            live
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white',
          ].join(' ')}
        >
          {live ? '■ Hang up' : '● Voice chat'}
        </button>

        {/* Mute only exists mid-call — there's no mic to gate otherwise. */}
        {live && (
          <button
            type="button"
            onClick={voice.toggleMute}
            aria-pressed={voice.muted}
            title={voice.muted ? 'Unmute your mic' : 'Mute your mic'}
            className={[
              'px-2 py-1 text-[10px] uppercase tracking-wider transition-colors',
              voice.muted
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-white/10 hover:bg-white/20 text-white/80',
            ].join(' ')}
          >
            {voice.muted ? '🔇 Muted' : '🎤 Mute'}
          </button>
        )}

        <span className={`text-[10px] ${statusColor}`}>
          {statusLabel}
        </span>

        {/* Mic-live dot — the only cue that the browser is holding the mic.
            Goes still and grey when muted, so "am I being heard?" is
            answerable at a glance rather than by reading the button. */}
        {live && (
          <span className="ml-auto flex items-center gap-1 text-[9px] text-white/40">
            <span
              className={[
                'w-1.5 h-1.5 rounded-full',
                voice.muted ? 'bg-white/30' : 'bg-red-500 animate-pulse',
              ].join(' ')}
            />
            MIC
          </span>
        )}
      </div>

      {/* Visualizer row. Bars are driven by an AnalyserNode on the agent's
          playback path, so they move only when the citizen is actually
          speaking — silence reads as a flat line rather than idle noise. */}
      <div className="flex items-end gap-[2px] h-6 mt-1.5" aria-hidden="true">
        {voice.levels.map((level, i) => {
          // Floor of 8% keeps a visible baseline so the row doesn't collapse.
          const pct = Math.max(8, level * 100);
          return (
            <span
              key={i}
              className={[
                'flex-1 transition-[height] duration-75',
                speaking ? 'bg-fuchsia-400' : 'bg-white/15',
              ].join(' ')}
              style={{ height: `${pct}%` }}
            />
          );
        })}
      </div>

      {voice.error && (
        <div className="text-[10px] text-red-400 mt-1 leading-snug">⚠ {voice.error}</div>
      )}
    </div>
  );
}
